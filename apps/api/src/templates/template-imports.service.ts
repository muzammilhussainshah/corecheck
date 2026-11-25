import { HttpException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import {
  type ApiError,
  type ApprovalMode,
  DEFECT_SEVERITIES,
  EVIDENCE_RULES,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionType,
  saveTemplateDraftSchema,
  TEMPLATE_IMPORT_COLUMNS,
  TEMPLATE_IMPORT_MAX_ROWS,
  TEMPLATE_LEVEL_COLUMNS,
  TEMPLATE_PURPOSE_LABELS,
  TEMPLATE_PURPOSES,
  type TemplateImportDetail,
  type TemplateImportGroup,
  type TemplateImportRowStatus,
  type TemplateImportSummary,
  type TemplatePurpose,
  type TemplateQuestion,
  templateQuestionSchema,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import { readTable } from '../common/spreadsheet.js';
import {
  CheckTemplateEntity,
  DisciplineEntity,
  MeterTypeEntity,
  PlantTypeEntity,
  TemplateImportEntity,
  TemplateImportRowEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { TemplatesService } from './templates.service.js';

type RowData = Record<string, string>;
type Upload =
  | { buffer: Buffer; size: number; originalname?: string }
  | undefined;

const MAX_BYTES = 5 * 1024 * 1024;
const normal = (text: string) => text.trim().toLowerCase();
const labelOf = (key: string) =>
  TEMPLATE_IMPORT_COLUMNS.find((column) => column.key === key)?.label ?? key;
/** "a; b" or "a | b" to a list. */
const splitChoices = (text: string | undefined) =>
  (text ?? '')
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
/** "a, b" to a list. */
const splitNames = (text: string | undefined) =>
  (text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const TYPE_WORDS: Record<string, QuestionType> = {
  ...Object.fromEntries(QUESTION_TYPES.map((type) => [type, type])),
  ...Object.fromEntries(
    QUESTION_TYPES.map((type) => [normal(QUESTION_TYPE_LABELS[type]), type]),
  ),
  'pass/fail': 'pass_fail',
  'yes/no': 'yes_no',
  'single selection': 'single_select',
  choice: 'single_select',
  number: 'number',
  measurement: 'number',
  photo: 'photo',
  file: 'photo',
  meter: 'meter',
  'meter reading': 'meter',
};
const EVIDENCE_WORDS: Record<string, (typeof EVIDENCE_RULES)[number]> = {
  '': 'never',
  never: 'never',
  optional: 'never',
  no: 'never',
  'on fail': 'on_fail',
  on_fail: 'on_fail',
  'required on a fail': 'on_fail',
  'required on fail': 'on_fail',
  always: 'always',
  'always required': 'always',
  required: 'always',
  yes: 'always',
};
const PURPOSE_WORDS: Record<string, TemplatePurpose> = {
  ...Object.fromEntries(TEMPLATE_PURPOSES.map((purpose) => [purpose, purpose])),
  ...Object.fromEntries(
    TEMPLATE_PURPOSES.map((purpose) => [
      normal(TEMPLATE_PURPOSE_LABELS[purpose]),
      purpose,
    ]),
  ),
  verification: 'defect_verification',
};
const APPROVAL_WORDS: Record<string, ApprovalMode> = {
  automatic: 'automatic',
  'complete on submission': 'automatic',
  none: 'automatic',
  no: 'automatic',
  manual: 'manual',
  'separate approval': 'manual',
  approval: 'manual',
  yes: 'manual',
};

interface Lookups {
  plantTypes: PlantTypeEntity[];
  disciplines: DisciplineEntity[];
  meters: MeterTypeEntity[];
  existingNames: Set<string>;
}

interface CheckedGroup {
  name: string;
  rows: TemplateImportRowEntity[];
  problems: Map<string, string[]>;
  purpose: TemplatePurpose | null;
  approvalMode: ApprovalMode;
  questions: TemplateQuestion[];
  plantTypeIds: string[];
  disciplineIds: string[];
}

/**
 * Check template import (FRD 19.4). A file is kept as rows and creates
 * nothing until committed (IMP-004). Every row is checked as a question:
 * type, mandatory rule, evidence settings, triggers and follow-up, and the
 * plant types, disciplines and meters it names (ITM-002). A template is
 * created only when all its rows are ready, always as a Draft for Admin to
 * review and publish (ITM-001); rows that need correcting are fixed in the
 * app without uploading again (IMP-005). Scheduled or completed checks are
 * never imported (ITM-003).
 */
@Injectable()
export class TemplateImportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private require(auth: CustomerAuth): void {
    if (
      !auth.permissions.has('templates.manage') ||
      !auth.permissions.has('templates.configure_questions')
    )
      throw forbidden();
  }

  /** The import spreadsheet, with an example and the accepted values. */
  async template(auth: CustomerAuth) {
    this.require(auth);
    const lookups = await this.lookups();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CoreCheck';
    const sheet = workbook.addWorksheet('Questions', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const header = TEMPLATE_IMPORT_COLUMNS.map((column) =>
      column.required ? `${column.label} *` : column.label,
    );
    sheet.addRow(header).font = { bold: true };
    const example = (values: Partial<Record<string, string>>) =>
      sheet.addRow(TEMPLATE_IMPORT_COLUMNS.map((column) => values[column.key] ?? ''));
    example({
      template: 'Daily pre-use check',
      purpose: 'Operational',
      approval: 'Automatic',
      question: 'Tyres in good condition',
      type: 'Pass / fail',
      mandatory: 'Yes',
      comment: 'Required on a fail',
      severity: 'Minor',
    });
    example({
      template: 'Daily pre-use check',
      question: 'Hydraulic hoses free of leaks',
      type: 'Pass / fail',
      comment: 'Required on a fail',
      photo: 'Required on a fail',
      offline: 'Yes',
      severity: 'Major',
    });
    example({
      template: 'Daily pre-use check',
      question: 'Where is the leak?',
      type: 'Text',
      followUpOf: '2',
      askedWhen: 'Fails',
    });
    example({
      template: 'Daily pre-use check',
      question: 'Fuel level',
      type: 'Single selection',
      choices: 'Full; Half; Low',
      failChoices: 'Low',
    });
    sheet.columns.forEach((column, index) => {
      column.width = Math.max(header[index]!.length + 2, 18);
    });

    const help = workbook.addWorksheet('How to fill in');
    const notes: Array<[string, string]> = [
      ['Template Name', 'Rows with the same name make one template, questions in row order. The name must not already be used.'],
      ['Purpose', TEMPLATE_PURPOSES.map((p) => TEMPLATE_PURPOSE_LABELS[p]).join(', ') + '. First row of each template.'],
      ['Approval', 'Automatic (complete on submission) or Manual (separate approval). Default: Manual for reception and Defect verification, otherwise Automatic.'],
      ['Applicable Plant Types', 'Comma separated; empty means every plant type.'],
      ['Eligible Disciplines', 'Comma separated; empty means anyone.'],
      ['Answer Type', QUESTION_TYPES.map((t) => QUESTION_TYPE_LABELS[t]).join(', ')],
      ['Mandatory', 'Yes or No (default Yes).'],
      ['Fail Answer', 'Yes / no questions: the answer that fails, Yes or No.'],
      ['Choices', 'Single selection: the choices separated by ; (at least two).'],
      ['Failing Choices', 'Single selection: choices that fail, separated by ;'],
      ['Lowest / Highest Allowed', 'Number questions: values outside fail.'],
      ['Meter Type', 'Meter reading questions: the meter type name.'],
      ['Comment / Photo', 'Optional, Required on a fail, or Always required.'],
      ['Fail Takes Plant Offline', 'Yes or No.'],
      ['Defect Severity', 'Minor, Major or Critical: a fail raises a Defect. Empty: no Defect.'],
      ['Follow-up Of Question', 'The number of an earlier question in the same template (1 = its first question).'],
      ['Asked When', 'Fails, Passes, or the answers that ask it separated by ;'],
    ];
    help.addRow(['Column', 'What to enter']).font = { bold: true };
    for (const note of notes) help.addRow(note);
    help.getColumn(1).width = 28;
    help.getColumn(2).width = 110;

    const values = workbook.addWorksheet('Allowed values');
    const lists: Array<[string, string[]]> = [
      ['Plant types', lookups.plantTypes.filter((t) => !t.archivedAt).map((t) => t.name)],
      ['Disciplines', lookups.disciplines.filter((d) => !d.archivedAt).map((d) => d.name)],
      ['Meter types', lookups.meters.filter((m) => !m.archivedAt).map((m) => m.name)],
    ];
    values.addRow(lists.map(([title]) => title)).font = { bold: true };
    const longest = Math.max(...lists.map(([, list]) => list.length), 0);
    for (let row = 0; row < longest; row += 1)
      values.addRow(lists.map(([, list]) => list[row] ?? ''));
    values.columns.forEach((column) => {
      column.width = 30;
    });
    return {
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: 'template-import.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async list(auth: CustomerAuth): Promise<TemplateImportSummary[]> {
    this.require(auth);
    const imports = await this.db.find(TemplateImportEntity, {
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return this.summaries(imports);
  }

  async get(auth: CustomerAuth, id: string): Promise<TemplateImportDetail> {
    this.require(auth);
    const record = await this.load(id);
    const [summary] = await this.summaries([record]);
    const rows = await this.rowsOf(id);
    const templateIds = [
      ...new Set(rows.flatMap((row) => (row.templateId ? [row.templateId] : []))),
    ];
    const created = templateIds.length
      ? await this.db.findBy(CheckTemplateEntity, { id: In(templateIds) })
      : [];
    const groups = new Map<string, TemplateImportRowEntity[]>();
    for (const row of rows) {
      const key = normal(row.data.template ?? '') || `row-${row.rowNumber}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return {
      ...summary!,
      columns: TEMPLATE_IMPORT_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        required: column.required,
      })),
      rows: rows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        data: row.data,
        status: row.status,
        problems: row.problems,
      })),
      groups: [...groups.values()].map((list): TemplateImportGroup => {
        const status: TemplateImportRowStatus = list.every(
          (row) => row.status === 'imported',
        )
          ? 'imported'
          : list.every((row) => row.status === 'valid')
            ? 'valid'
            : 'invalid';
        const template = created.find((t) => t.id === list[0]!.templateId);
        return {
          name: list[0]!.data.template ?? '',
          status,
          rowNumbers: list.map((row) => row.rowNumber),
          questions: list.length,
          template: template ? { id: template.id, name: template.name } : null,
        };
      }),
    };
  }

  async upload(auth: CustomerAuth, file: Upload): Promise<TemplateImportDetail> {
    this.require(auth);
    if (!file || file.size === 0)
      throw fieldError('file', 'Choose a file to import.');
    if (file.size > MAX_BYTES)
      throw fieldError('file', 'The file is larger than 5 MB.');
    const name = (file.originalname ?? 'import').replace(/^.*[\\/]/, '');
    const [headerRow, ...body] = await readTable(file.buffer, name);
    if (!headerRow) throw fieldError('file', 'The file is empty.');
    const rows = body.filter((cells) => cells.some((cell) => cell.trim()));
    if (rows.length === 0)
      throw fieldError('file', 'The file has no question rows.');
    if (rows.length > TEMPLATE_IMPORT_MAX_ROWS)
      throw fieldError(
        'file',
        `Import up to ${TEMPLATE_IMPORT_MAX_ROWS} rows at a time.`,
      );
    const byHeader = new Map<string, string>(
      TEMPLATE_IMPORT_COLUMNS.map((column) => [normal(column.label), column.key]),
    );
    const keys = headerRow.map((cell) =>
      byHeader.get(normal(cell.replace(/\*\s*$/, ''))),
    );
    const missing = TEMPLATE_IMPORT_COLUMNS.filter(
      (column) => column.required && !keys.includes(column.key),
    );
    if (missing.length)
      throw fieldError(
        'file',
        `The file has no ${missing.map((c) => c.label).join(', ')} column. Use the template.`,
      );
    const inserted = await this.db.insert(TemplateImportEntity, {
      orgId: this.tenantDb.orgId,
      fileName: name.slice(0, 200),
      createdBy: auth.userId,
    });
    const id = (inserted.identifiers[0] as { id: string }).id;
    for (const [index, cells] of rows.entries()) {
      const data: RowData = {};
      keys.forEach((key, column) => {
        const value = (cells[column] ?? '').trim();
        if (key && value) data[key] = value;
      });
      await this.db.insert(TemplateImportRowEntity, {
        orgId: this.tenantDb.orgId,
        importId: id,
        rowNumber: index + 2, // The spreadsheet row, after the heading.
        data,
        status: 'invalid',
        problems: [],
        templateId: null,
      });
    }
    await this.recheck(id);
    return this.get(auth, id);
  }

  /** Corrects a row in the app and checks the file again (IMP-005). */
  async updateRow(
    auth: CustomerAuth,
    importId: string,
    rowId: string,
    data: RowData,
  ): Promise<TemplateImportDetail> {
    this.require(auth);
    await this.load(importId);
    const row = await this.db.findOneBy(TemplateImportRowEntity, {
      id: rowId,
      importId,
    });
    if (!row) throw notFound('Row');
    if (row.status === 'imported')
      throw conflict('CONFLICT', 'This row has already been imported.');
    const allowed = new Set<string>(TEMPLATE_IMPORT_COLUMNS.map((c) => c.key));
    await this.db.update(
      TemplateImportRowEntity,
      { id: rowId },
      {
        data: Object.fromEntries(
          Object.entries(data)
            .filter(([key]) => allowed.has(key))
            .map(([key, value]): [string, string] => [key, value.trim()])
            .filter(([, value]) => value),
        ),
      },
    );
    await this.recheck(importId);
    return this.get(auth, importId);
  }

  /**
   * Creates a Draft template from every group whose rows are all ready
   * (ITM-001). Each goes through the same path as one made by hand.
   */
  async commit(auth: CustomerAuth, id: string): Promise<TemplateImportDetail> {
    this.require(auth);
    const record = await this.load(id);
    // A second click or tab waits here, then finds the rows already imported.
    await this.db.query(
      'select id from corecheck.template_import_rows where import_id = $1 for update',
      [id],
    );
    const groups = await this.recheck(id);
    const created: string[] = [];
    for (const group of groups) {
      if (group.rows.some((row) => row.status !== 'valid') || !group.purpose)
        continue;
      try {
        const template = await this.templates.create(auth, {
          name: group.name,
          purpose: group.purpose,
          approvalMode: group.approvalMode,
          description: `Imported from ${record.fileName}`,
        });
        await this.templates.saveDraft(auth, template.id, {
          questions: group.questions,
          eligibility: {
            plantTypeIds: group.plantTypeIds,
            categoryIds: [],
            disciplineIds: group.disciplineIds,
            teamIds: [],
            userIds: [],
          },
        });
        await this.db.update(
          TemplateImportRowEntity,
          { id: In(group.rows.map((row) => row.id)) },
          { status: 'imported', problems: [], templateId: template.id },
        );
        created.push(group.name);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const response = error.getResponse() as ApiError;
        const message =
          response.fieldErrors?.map((item) => item.message).join(' ') ??
          response.message ??
          error.message;
        await this.db.update(
          TemplateImportRowEntity,
          { id: In(group.rows.map((row) => row.id)) },
          { status: 'invalid', problems: [message] },
        );
      }
    }
    if (created.length)
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: auth.orgId,
        actor: userActor(auth),
        action: 'template.imported',
        entityType: 'template_import',
        entityId: id,
        summary: `Imported ${created.length} template${created.length === 1 ? '' : 's'} as Draft from ${record.fileName}: ${created.join(', ')}`,
        metadata: { fileName: record.fileName, templates: created },
      });
    return this.get(auth, id);
  }

  /** Rows not yet imported, with what is wrong, as CSV (IMP-004). */
  async report(auth: CustomerAuth, id: string) {
    const detail = await this.get(auth, id);
    const cell = (value: string) =>
      /^[=+\-@\t\r]/.test(value)
        ? `"'${value.replace(/"/g, '""')}"`
        : /[",\r\n]/.test(value)
          ? `"${value.replace(/"/g, '""')}"`
          : value;
    const lines = [
      ['Row', ...detail.columns.map((c) => c.label), 'Status', 'Problems'],
      ...detail.rows
        .filter((row) => row.status !== 'imported')
        .map((row) => [
          String(row.rowNumber),
          ...detail.columns.map((c) => row.data[c.key] ?? ''),
          row.status,
          row.problems.join('; '),
        ]),
    ].map((cells) => cells.map(cell).join(','));
    const stamp = dateInTimeZone(this.clock.now(), auth.org.timeZone);
    return {
      body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
      filename: `template-import-report-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  // ---------------------------------------------------------------- checks

  /** Checks every row not yet imported and saves the outcome. */
  private async recheck(importId: string): Promise<CheckedGroup[]> {
    const rows = (await this.rowsOf(importId)).filter(
      (row) => row.status !== 'imported',
    );
    const lookups = await this.lookups();
    const groups = new Map<string, TemplateImportRowEntity[]>();
    for (const row of rows) {
      const key = normal(row.data.template ?? '') || `row-${row.rowNumber}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const checked: CheckedGroup[] = [];
    for (const list of groups.values()) {
      const group = this.checkGroup(list, lookups);
      for (const row of list) {
        const problems = group.problems.get(row.id) ?? [];
        const status: TemplateImportRowStatus = problems.length
          ? 'invalid'
          : 'valid';
        row.status = status;
        row.problems = problems;
        await this.db.update(
          TemplateImportRowEntity,
          { id: row.id },
          { status, problems },
        );
      }
      checked.push(group);
    }
    return checked;
  }

  private checkGroup(
    rows: TemplateImportRowEntity[],
    lookups: Lookups,
  ): CheckedGroup {
    const problems = new Map<string, string[]>();
    const add = (row: TemplateImportRowEntity, message: string) =>
      problems.set(row.id, [...(problems.get(row.id) ?? []), message]);
    const first = rows[0]!;
    const name = (first.data.template ?? '').trim();

    // Template-wide values come from the first row.
    if (!name) for (const row of rows) add(row, 'Template Name is required.');
    else if (name.length > 120)
      add(first, 'Template Name must be 120 characters or fewer.');
    else if (lookups.existingNames.has(normal(name)))
      for (const row of rows)
        add(row, `A template called "${name}" already exists. Use another name.`);
    for (const row of rows.slice(1))
      for (const key of TEMPLATE_LEVEL_COLUMNS) {
        const value = row.data[key];
        if (value && normal(value) !== normal(first.data[key] ?? ''))
          add(
            row,
            `${labelOf(key)} differs from the first row of "${name}" (row ${first.rowNumber}); leave it empty or make them the same.`,
          );
      }
    const purpose = first.data.purpose
      ? (PURPOSE_WORDS[normal(first.data.purpose)] ?? null)
      : null;
    if (!first.data.purpose) add(first, 'Purpose is required.');
    else if (!purpose)
      add(
        first,
        `Purpose "${first.data.purpose}" is not one of: ${TEMPLATE_PURPOSES.map((p) => TEMPLATE_PURPOSE_LABELS[p]).join(', ')}.`,
      );
    let approvalMode: ApprovalMode =
      purpose === 'reception' || purpose === 'defect_verification'
        ? 'manual'
        : 'automatic';
    if (first.data.approval) {
      const mode = APPROVAL_WORDS[normal(first.data.approval)];
      if (mode) approvalMode = mode;
      else add(first, 'Approval must be Automatic or Manual.');
    }
    const resolve = <T extends { id: string; name: string; archivedAt: Date | null }>(
      key: string,
      list: T[],
      what: string,
    ) =>
      splitNames(first.data[key]).flatMap((item) => {
        const found = list.find((entry) => normal(entry.name) === normal(item));
        if (!found || found.archivedAt) {
          add(first, `${what} "${item}" not found.`);
          return [];
        }
        return [found.id];
      });
    const plantTypeIds = resolve('plantTypes', lookups.plantTypes, 'Plant type');
    const disciplineIds = resolve(
      'disciplines',
      lookups.disciplines,
      'Discipline',
    );
    if (rows.length > 100)
      for (const row of rows.slice(100))
        add(row, 'A template can have up to 100 questions.');

    // Each row as a question.
    const questions: TemplateQuestion[] = [];
    rows.forEach((row, index) => {
      const draft = this.questionOf(row.data, index, rows, lookups, (message) =>
        add(row, message),
      );
      const parsed = templateQuestionSchema.safeParse(draft);
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          add(row, `${this.fieldLabel(String(issue.path[0] ?? ''))}: ${issue.message}`);
        return;
      }
      questions.push(parsed.data as TemplateQuestion);
    });

    // Rules across questions: follow-ups follow earlier questions (TMP-009).
    if (questions.length === rows.length) {
      const whole = saveTemplateDraftSchema.safeParse({ questions });
      if (!whole.success)
        for (const issue of whole.error.issues) {
          const at = Number(issue.path[1]);
          add(rows[Number.isInteger(at) ? at : 0]!, `${this.fieldLabel(String(issue.path[2] ?? ''))}: ${issue.message}`);
        }
    }
    return {
      name,
      rows,
      problems,
      purpose,
      approvalMode,
      questions,
      plantTypeIds,
      disciplineIds,
    };
  }

  /** One row's values as the fields of a template question. */
  private questionOf(
    data: RowData,
    index: number,
    rows: TemplateImportRowEntity[],
    lookups: Lookups,
    problem: (message: string) => void,
  ): Record<string, unknown> {
    const yesNo = (key: string, fallback: boolean) => {
      const value = normal(data[key] ?? '');
      if (!value) return fallback;
      if (['yes', 'y', 'true', '1'].includes(value)) return true;
      if (['no', 'n', 'false', '0'].includes(value)) return false;
      problem(`${labelOf(key)} must be Yes or No.`);
      return fallback;
    };
    const number = (key: string) => {
      if (!data[key]) return null;
      const value = Number(data[key]);
      if (!Number.isFinite(value)) {
        problem(`${labelOf(key)} must be a number.`);
        return null;
      }
      return value;
    };
    const evidence = (key: string) => {
      const rule = EVIDENCE_WORDS[normal(data[key] ?? '')];
      if (!rule) {
        problem(`${labelOf(key)} must be Optional, Required on a fail or Always required.`);
        return 'never';
      }
      return rule;
    };
    const type = data.type ? TYPE_WORDS[normal(data.type)] : undefined;
    if (data.type && !type)
      problem(
        `Answer Type "${data.type}" is not one of: ${QUESTION_TYPES.map((t) => QUESTION_TYPE_LABELS[t]).join(', ')}.`,
      );
    let meterTypeId: string | null = null;
    if (type === 'meter') {
      const meter = lookups.meters.find(
        (item) => normal(item.name) === normal(data.meter ?? ''),
      );
      if (!data.meter) problem('Meter Type is required for a meter reading.');
      else if (!meter || meter.archivedAt)
        problem(`Meter type "${data.meter}" not found.`);
      else meterTypeId = meter.id;
    }
    const failAnswer = normal(data.failAnswer ?? '');
    if (failAnswer && !['yes', 'no'].includes(failAnswer))
      problem('Fail Answer must be Yes or No.');
    const severity = normal(data.severity ?? '');
    if (severity && !(DEFECT_SEVERITIES as readonly string[]).includes(severity))
      problem('Defect Severity must be Minor, Major or Critical.');
    const options = splitChoices(data.choices);
    const canonical = (value: string) =>
      options.find((option) => normal(option) === normal(value)) ?? value;

    let showIf: Record<string, unknown> | null = null;
    if (data.followUpOf) {
      const parentAt = Number(data.followUpOf) - 1;
      const parent = rows[parentAt];
      if (!Number.isInteger(parentAt) || !parent || parentAt >= index)
        problem(
          `Follow-up Of Question must be the number of an earlier question in this template (1 to ${index}).`,
        );
      else {
        const when = normal(data.askedWhen ?? '');
        const parentType = parent.data.type
          ? TYPE_WORDS[normal(parent.data.type)]
          : undefined;
        const parentChoices = splitChoices(parent.data.choices);
        if (!when) problem('Asked When is required for a follow-up.');
        else if (['fail', 'fails', 'failed'].includes(when))
          showIf = { questionId: `q${parentAt + 1}`, when: 'fail', values: [] };
        else if (['pass', 'passes', 'passed'].includes(when))
          showIf = { questionId: `q${parentAt + 1}`, when: 'pass', values: [] };
        else
          showIf = {
            questionId: `q${parentAt + 1}`,
            when: 'values',
            values: splitChoices(data.askedWhen).map((value) =>
              parentType === 'single_select'
                ? (parentChoices.find((c) => normal(c) === normal(value)) ?? value)
                : normal(value),
            ),
          };
      }
    } else if (data.askedWhen)
      problem('Asked When needs Follow-up Of Question.');

    return {
      id: `q${index + 1}`,
      text: data.question ?? '',
      type: type ?? data.type ?? '',
      mandatory: yesNo('mandatory', true),
      failAnswer: failAnswer === 'yes' || failAnswer === 'no' ? failAnswer : null,
      min: number('min'),
      max: number('max'),
      meterTypeId,
      requireComment: evidence('comment'),
      requirePhoto: evidence('photo'),
      options,
      failOptions: splitChoices(data.failChoices).map(canonical),
      offlineOnFail: yesNo('offline', false),
      defectSeverity: severity && (DEFECT_SEVERITIES as readonly string[]).includes(severity)
        ? severity
        : null,
      showIf,
    };
  }

  /** A question field's column, for messages. */
  private fieldLabel(field: string): string {
    const columns: Record<string, string> = {
      text: 'Question',
      type: 'Answer Type',
      mandatory: 'Mandatory',
      failAnswer: 'Fail Answer',
      min: 'Lowest Allowed',
      max: 'Highest Allowed',
      meterTypeId: 'Meter Type',
      requireComment: 'Comment',
      requirePhoto: 'Photo',
      options: 'Choices',
      failOptions: 'Failing Choices',
      offlineOnFail: 'Fail Takes Plant Offline',
      defectSeverity: 'Defect Severity',
      showIf: 'Follow-up',
    };
    return columns[field] ?? 'Question';
  }

  // ---------------------------------------------------------------- shared

  private async load(id: string): Promise<TemplateImportEntity> {
    const record = await this.db.findOneBy(TemplateImportEntity, { id });
    if (!record) throw notFound('Import');
    return record;
  }

  private rowsOf(importId: string) {
    return this.db.find(TemplateImportRowEntity, {
      where: { importId },
      order: { rowNumber: 'ASC' },
    });
  }

  private async lookups(): Promise<Lookups> {
    return {
      plantTypes: await this.db.find(PlantTypeEntity),
      disciplines: await this.db.find(DisciplineEntity),
      meters: await this.db.find(MeterTypeEntity),
      existingNames: new Set(
        (await this.db.find(CheckTemplateEntity)).map((t) => normal(t.name)),
      ),
    };
  }

  private async summaries(
    imports: TemplateImportEntity[],
  ): Promise<TemplateImportSummary[]> {
    if (imports.length === 0) return [];
    const rows = await this.db.findBy(TemplateImportRowEntity, {
      importId: In(imports.map((item) => item.id)),
    });
    const users = await this.db.findBy(UserEntity, {
      id: In([...new Set(imports.map((item) => item.createdBy))]),
    });
    return imports.map((item) => {
      const own = rows.filter((row) => row.importId === item.id);
      const names = new Set(own.map((row) => normal(row.data.template ?? '')));
      const created = new Set(
        own.flatMap((row) => (row.templateId ? [row.templateId] : [])),
      );
      const user = users.find((u) => u.id === item.createdBy);
      return {
        id: item.id,
        fileName: item.fileName,
        createdBy: user ? fullName(user) : 'Unknown',
        createdAt: item.createdAt.toISOString(),
        counts: {
          valid: own.filter((row) => row.status === 'valid').length,
          invalid: own.filter((row) => row.status === 'invalid').length,
          imported: own.filter((row) => row.status === 'imported').length,
        },
        templates: names.size,
        imported: created.size,
      };
    });
  }
}
