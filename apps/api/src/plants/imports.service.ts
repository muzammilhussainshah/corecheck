import { HttpException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import {
  type ApiError,
  type createPlantSchema,
  type CustomValue,
  ImportRowStatus,
  OWNERSHIP_COMPANY_KIND,
  type PlantImportDetail,
  type PlantImportRow,
  type PlantImportSummary,
  PLANT_IMPORT_COLUMNS,
  PLANT_IMPORT_MAX_BYTES,
  PLANT_IMPORT_MAX_ROWS,
  type PlantOwnership,
} from '@corecheck/shared';
import type { z } from 'zod';
import { AuditService, userActor } from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import {
  AreaEntity,
  PlantCategoryEntity,
  PlantCompanyEntity,
  PlantCustomFieldEntity,
  PlantEntity,
  PlantImportEntity,
  PlantImportRowEntity,
  PlantTypeEntity,
  SiteEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { csvCell, type FileOutput } from './plant-output.service.js';
import { PlantsService } from './plants.service.js';

type CreateInput = z.output<typeof createPlantSchema>;
type RowData = Record<string, string>;
type Upload =
  { buffer: Buffer; size: number; originalname?: string } | undefined;

const normal = (text: string) => text.trim().toLowerCase();

/** One CSV document to rows of text, quotes and newlines in cells included. */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/** A spreadsheet cell as text; dates become YYYY-MM-DD. */
const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('richText' in value)
      return value.richText.map((part) => part.text).join('');
    return '';
  }
  return String(value);
};

interface Lookups {
  types: PlantTypeEntity[];
  categories: PlantCategoryEntity[];
  companies: PlantCompanyEntity[];
  sites: SiteEntity[];
  areas: AreaEntity[];
  fields: PlantCustomFieldEntity[];
}

interface Checked {
  status: ImportRowStatus;
  problems: string[];
  warnings: string[];
  existingPlantId: string | null;
  input: CreateInput | null;
}

/**
 * Plant import (FRD 19): upload, row-level preview, correction in the app,
 * then import of the rows that are ready. New records only; existing plant
 * is never updated or merged (IPL-001, IPL-006).
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private require(auth: CustomerAuth): void {
    if (!auth.permissions.has('plant.import')) throw forbidden();
  }

  /** The template, with the values each column accepts (IMP-002). */
  async template(auth: CustomerAuth): Promise<FileOutput> {
    this.require(auth);
    const lookups = await this.lookups();
    const active = <T extends { archivedAt: Date | null }>(items: T[]) =>
      items.filter((item) => !item.archivedAt);
    const fields = active(lookups.fields);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CoreCheck';
    const sheet = workbook.addWorksheet('Plant', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const header = [
      ...PLANT_IMPORT_COLUMNS.map((column) =>
        column.required ? `${column.label} *` : column.label,
      ),
      ...fields.map((field) =>
        field.required ? `${field.label} *` : field.label,
      ),
    ];
    sheet.addRow(header).font = { bold: true };
    sheet.columns.forEach((column, index) => {
      column.width = Math.max(header[index]!.length + 2, 16);
    });

    const values = workbook.addWorksheet('Allowed values');
    const siteName = (id: string) =>
      lookups.sites.find((site) => site.id === id)?.name ?? '';
    const lists: Array<[string, string[]]> = [
      ['Plant Type', active(lookups.types).map((item) => item.name)],
      ['Ownership Type', ['Owned', 'Hired']],
      [
        'Owners (owned plant)',
        active(lookups.companies)
          .filter((item) => item.kind === 'owner')
          .map((item) => item.name),
      ],
      [
        'Hire companies (hired plant)',
        active(lookups.companies)
          .filter((item) => item.kind === 'hire_company')
          .map((item) => item.name),
      ],
      [
        'Site',
        active(lookups.sites)
          .filter((site) => this.plants.inScope(auth, site.id))
          .map((item) => item.name),
      ],
      [
        'Area (Site: Area)',
        active(lookups.areas).map(
          (item) => `${siteName(item.siteId)}: ${item.name}`,
        ),
      ],
      ['Category', active(lookups.categories).map((item) => item.name)],
      ...fields
        .filter((field) => field.fieldType === 'select')
        .map((field): [string, string[]] => [field.label, field.options]),
    ];
    values.addRow(lists.map(([title]) => title)).font = { bold: true };
    const longest = Math.max(...lists.map(([, list]) => list.length), 0);
    for (let row = 0; row < longest; row += 1)
      values.addRow(lists.map(([, list]) => list[row] ?? ''));
    values.columns.forEach((column) => {
      column.width = 28;
    });
    return {
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: 'plant-import-template.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async list(auth: CustomerAuth): Promise<PlantImportSummary[]> {
    this.require(auth);
    const imports = await this.db.find(PlantImportEntity, {
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return this.summaries(imports);
  }

  async get(auth: CustomerAuth, id: string): Promise<PlantImportDetail> {
    this.require(auth);
    const record = await this.load(id);
    const [summary] = await this.summaries([record]);
    const rows = await this.db.find(PlantImportRowEntity, {
      where: { importId: id },
      order: { rowNumber: 'ASC' },
    });
    const plantIds = rows.flatMap((row) =>
      [row.plantId, row.existingPlantId].filter((v): v is string => !!v),
    );
    const plants = plantIds.length
      ? await this.db.findBy(PlantEntity, { id: In(plantIds) })
      : [];
    const brief = (plantId: string | null) => {
      const plant = plants.find((item) => item.id === plantId);
      // Link only to plant this user may open.
      return plant && this.plants.inScope(auth, plant.siteId)
        ? { id: plant.id, assetId: plant.assetId, name: plant.name }
        : null;
    };
    return {
      ...summary!,
      columns: await this.columns(),
      rows: rows.map((row): PlantImportRow => ({
        id: row.id,
        rowNumber: row.rowNumber,
        data: row.data,
        status: row.status,
        problems: row.problems,
        warnings: row.warnings,
        confirmed: row.confirmed,
        existingPlant: brief(row.existingPlantId),
        plant: brief(row.plantId),
      })),
    };
  }

  /** Reads a file into rows and checks each one; nothing is created yet. */
  async upload(auth: CustomerAuth, file: Upload): Promise<PlantImportDetail> {
    this.require(auth);
    if (!file || file.size === 0)
      throw fieldError('file', 'Choose a file to import.');
    if (file.size > PLANT_IMPORT_MAX_BYTES)
      throw fieldError('file', 'The file is larger than 5 MB.');
    const name = (file.originalname ?? 'import').replace(/^.*[\\/]/, '');
    const table = await this.readTable(file.buffer, name);
    const [headerRow, ...body] = table;
    if (!headerRow) throw fieldError('file', 'The file is empty.');
    const rows = body.filter((cells) => cells.some((cell) => cell.trim()));
    if (rows.length === 0)
      throw fieldError('file', 'The file has no plant rows.');
    if (rows.length > PLANT_IMPORT_MAX_ROWS)
      throw fieldError(
        'file',
        `Import up to ${PLANT_IMPORT_MAX_ROWS} rows at a time.`,
      );

    const columns = await this.columns();
    const byHeader = new Map(
      columns.map((column) => [normal(column.label), column.key]),
    );
    const keys = headerRow.map((cell) =>
      byHeader.get(normal(cell.replace(/\*\s*$/, ''))),
    );
    const missing = columns.filter(
      (column) => column.required && !keys.includes(column.key),
    );
    if (missing.length)
      throw fieldError(
        'file',
        `The file has no ${missing.map((c) => c.label).join(', ')} column. Use the template.`,
      );

    const inserted = await this.db.insert(PlantImportEntity, {
      orgId: this.tenantDb.orgId,
      fileName: name.slice(0, 200),
      createdBy: auth.userId,
    });
    const id = (inserted.identifiers[0] as { id: string }).id;
    const lookups = await this.lookups();
    const datas = rows.map((cells) => {
      const data: RowData = {};
      keys.forEach((key, index) => {
        const value = (cells[index] ?? '').trim();
        if (key && value) data[key] = value;
      });
      return data;
    });
    for (const [index, data] of datas.entries()) {
      const checked = await this.check(
        auth,
        data,
        lookups,
        false,
        datas,
        index,
      );
      await this.db.insert(PlantImportRowEntity, {
        orgId: this.tenantDb.orgId,
        importId: id,
        rowNumber: index + 2, // The spreadsheet row, after the heading.
        data,
        status: checked.status,
        problems: checked.problems,
        warnings: checked.warnings,
        confirmed: false,
        existingPlantId: checked.existingPlantId,
        plantId: null,
      });
    }
    return this.get(auth, id);
  }

  /** Corrects a row in the app and checks it again (IMP-005, IPL-007). */
  async updateRow(
    auth: CustomerAuth,
    importId: string,
    rowId: string,
    input: { data?: RowData; confirmed?: boolean },
  ): Promise<PlantImportDetail> {
    this.require(auth);
    await this.load(importId);
    const row = await this.db.findOneBy(PlantImportRowEntity, {
      id: rowId,
      importId,
    });
    if (!row) throw notFound('Row');
    if (row.status === 'imported')
      throw conflict('CONFLICT', 'This row has already been imported.');
    const data = input.data
      ? Object.fromEntries(
          Object.entries(input.data)
            .map(([key, value]): [string, string] => [key, value.trim()])
            .filter(([, value]) => value),
        )
      : row.data;
    const confirmed = input.confirmed ?? row.confirmed;
    const others = await this.rowsAbove(importId, row.rowNumber);
    const checked = await this.check(
      auth,
      data,
      await this.lookups(),
      confirmed,
      [...others, data],
      others.length,
    );
    await this.db.update(
      PlantImportRowEntity,
      { id: rowId },
      {
        data,
        confirmed,
        status: checked.status,
        problems: checked.problems,
        warnings: checked.warnings,
        existingPlantId: checked.existingPlantId,
      },
    );
    return this.get(auth, importId);
  }

  /**
   * Creates plant from every row that is ready; rows with possible
   * duplicates need confirming and invalid rows wait (IMP-004).
   */
  async commit(auth: CustomerAuth, id: string): Promise<PlantImportDetail> {
    this.require(auth);
    if (!auth.permissions.has('plant.create')) throw forbidden();
    const record = await this.load(id);
    const rows = await this.db.find(PlantImportRowEntity, {
      where: { importId: id },
      order: { rowNumber: 'ASC' },
    });
    const lookups = await this.lookups();
    let imported = 0;
    for (const row of rows) {
      if (row.status === 'imported') continue;
      const others = await this.rowsAbove(id, row.rowNumber);
      const checked = await this.check(
        auth,
        row.data,
        lookups,
        row.confirmed,
        [...others, row.data],
        others.length,
      );
      let { status, problems } = checked;
      let plantId: string | null = null;
      if (status === 'valid' && checked.input) {
        try {
          plantId = (await this.plants.create(auth, checked.input)).plant.id;
          status = 'imported';
          imported += 1;
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          status = 'invalid';
          problems = [
            (error.getResponse() as ApiError).message ?? error.message,
          ];
        }
      }
      await this.db.update(
        PlantImportRowEntity,
        { id: row.id },
        {
          status,
          problems,
          warnings: checked.warnings,
          existingPlantId: checked.existingPlantId,
          plantId,
        },
      );
    }
    if (imported > 0)
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: auth.orgId,
        actor: userActor(auth),
        action: 'plant.imported',
        entityType: 'plant_import',
        entityId: id,
        summary: `Imported ${imported} plant from ${record.fileName}`,
        metadata: { fileName: record.fileName, imported },
      });
    return this.get(auth, id);
  }

  /** Rows that did not go in, with what is wrong, as CSV (IMP-004). */
  async report(auth: CustomerAuth, id: string): Promise<FileOutput> {
    const detail = await this.get(auth, id);
    const rows = detail.rows.filter((row) => row.status !== 'imported');
    const header = [
      'Row',
      ...detail.columns.map((column) => column.label),
      'Status',
      'Problems',
    ];
    const lines = [
      header,
      ...rows.map((row) => [
        String(row.rowNumber),
        ...detail.columns.map((column) => row.data[column.key] ?? ''),
        row.status,
        [...row.problems, ...row.warnings].join('; '),
      ]),
    ].map((cells) => cells.map(csvCell).join(','));
    const stamp = dateInTimeZone(this.clock.now(), auth.org.timeZone);
    return {
      body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
      filename: `plant-import-report-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  // ---------------------------------------------------------------- shared

  private async load(id: string): Promise<PlantImportEntity> {
    const record = await this.db.findOneBy(PlantImportEntity, { id });
    if (!record) throw notFound('Import');
    return record;
  }

  private async columns() {
    const fields = await this.db.find(PlantCustomFieldEntity, {
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    return [
      ...PLANT_IMPORT_COLUMNS.map((column) => ({
        key: column.key as string,
        label: column.label as string,
        required: column.required as boolean,
      })),
      ...fields
        .filter((field) => !field.archivedAt)
        .map((field) => ({
          key: `custom:${field.id}`,
          label: field.label,
          required: field.required,
        })),
    ];
  }

  private async lookups(): Promise<Lookups> {
    return {
      types: await this.db.find(PlantTypeEntity),
      categories: await this.db.find(PlantCategoryEntity),
      companies: await this.db.find(PlantCompanyEntity),
      sites: await this.db.find(SiteEntity),
      areas: await this.db.find(AreaEntity),
      fields: await this.db.find(PlantCustomFieldEntity),
    };
  }

  private async readTable(buffer: Buffer, name: string): Promise<string[][]> {
    if (/\.csv$/i.test(name))
      return parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
    if (!/\.xlsx$/i.test(name))
      throw fieldError('file', 'Upload an Excel (.xlsx) or CSV file.');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw fieldError('file', 'The Excel file could not be read.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw fieldError('file', 'The file is empty.');
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column += 1)
        cells.push(cellText(row.getCell(column).value));
      table.push(cells);
    });
    return table;
  }

  /** Rows above this one that are still waiting, in file order. */
  private async rowsAbove(importId: string, rowNumber: number) {
    const rows = await this.db.find(PlantImportRowEntity, {
      where: { importId },
      order: { rowNumber: 'ASC' },
    });
    return rows
      .filter((row) => row.rowNumber < rowNumber && row.status !== 'imported')
      .map((row) => row.data);
  }

  /** Checks one row against the configuration and the register. */
  private async check(
    auth: CustomerAuth,
    data: RowData,
    lookups: Lookups,
    confirmed: boolean,
    allRows: RowData[],
    index: number,
  ): Promise<Checked> {
    const problems: string[] = [];
    const warnings: string[] = [];
    const find = <T extends { archivedAt: Date | null }>(
      items: T[],
      name: (item: T) => string,
      value: string,
      label: string,
    ): T | undefined => {
      const item = items.find((c) => normal(name(c)) === normal(value));
      if (!item) problems.push(`${label} "${value}" was not found.`);
      else if (item.archivedAt) {
        problems.push(`${label} "${value}" is archived.`);
        return undefined;
      }
      return item;
    };
    for (const column of PLANT_IMPORT_COLUMNS)
      if (column.required && !data[column.key])
        problems.push(`${column.label} is required.`);

    const type = data.plantType
      ? find(lookups.types, (i) => i.name, data.plantType, 'Plant type')
      : undefined;
    const category = data.category
      ? find(lookups.categories, (i) => i.name, data.category, 'Category')
      : undefined;
    const ownership = (
      { owned: 'owned', hired: 'hired' } as Record<string, PlantOwnership>
    )[normal(data.ownership ?? '')];
    if (data.ownership && !ownership)
      problems.push('Ownership Type must be Owned or Hired.');
    const company =
      data.company && ownership
        ? find(
            lookups.companies.filter(
              (item) => item.kind === OWNERSHIP_COMPANY_KIND[ownership],
            ),
            (i) => i.name,
            data.company,
            ownership === 'owned' ? 'Owner' : 'Hire company',
          )
        : undefined;
    const site = data.site
      ? find(lookups.sites, (i) => i.name, data.site, 'Site')
      : undefined;
    if (site && !this.plants.inScope(auth, site.id))
      problems.push(
        `Site "${data.site}" is outside the sites you are assigned to.`,
      );
    const area =
      data.area && site
        ? find(
            lookups.areas.filter((item) => item.siteId === site.id),
            (i) => i.name,
            data.area,
            'Area',
          )
        : undefined;

    const customValues: Record<string, CustomValue> = {};
    for (const field of lookups.fields) {
      if (field.archivedAt) continue;
      const value = data[`custom:${field.id}`];
      if (!value) {
        if (field.required) problems.push(`${field.label} is required.`);
        continue;
      }
      if (field.fieldType === 'number' && Number.isNaN(Number(value)))
        problems.push(`${field.label} must be a number.`);
      else if (
        field.fieldType === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
      )
        problems.push(`${field.label} must be a date as YYYY-MM-DD.`);
      else if (field.fieldType === 'select' && !field.options.includes(value))
        problems.push(`${field.label} must be one of its choices.`);
      else
        customValues[field.id] =
          field.fieldType === 'number' ? Number(value) : value;
    }

    // Asset IDs are unique: an existing one rejects the row (IPL-004).
    let existingPlantId: string | null = null;
    if (data.assetId) {
      const [existing] = (await this.db.query(
        'select id from corecheck.plants where lower(asset_id) = lower($1)',
        [data.assetId],
      )) as Array<{ id: string }>;
      if (existing) {
        existingPlantId = existing.id;
        problems.push(`System Asset ID ${data.assetId} already exists.`);
      }
      const earlier = allRows
        .slice(0, index)
        .some((row) => normal(row.assetId ?? '') === normal(data.assetId!));
      if (earlier)
        problems.push(
          `System Asset ID ${data.assetId} is repeated in this file.`,
        );
    }

    // Matching numbers warn and need confirming, but do not block (IPL-005).
    const above = allRows.slice(0, index);
    if (
      data.plantNumber &&
      above.some(
        (r) => normal(r.plantNumber ?? '') === normal(data.plantNumber!),
      )
    )
      warnings.push(
        `Plant Number ${data.plantNumber} is repeated in this file.`,
      );
    if (
      data.serialNumber &&
      above.some(
        (r) => normal(r.serialNumber ?? '') === normal(data.serialNumber!),
      )
    )
      warnings.push(
        `Serial Number ${data.serialNumber} is repeated in this file.`,
      );
    const matches = await this.plants.duplicates(auth, {
      plantNumber: data.plantNumber,
      serialNumber: data.serialNumber,
    });
    for (const plant of [...matches.plantNumber, ...matches.serialNumber]) {
      const text = `Matches ${plant.assetId} ${plant.name}.`;
      if (!warnings.includes(text)) warnings.push(text);
    }
    if (matches.outsideScope > 0)
      warnings.push(
        `Matches ${matches.outsideScope} plant at sites you are not assigned to.`,
      );
    existingPlantId ??=
      matches.plantNumber[0]?.id ?? matches.serialNumber[0]?.id ?? null;

    const status: ImportRowStatus = problems.length
      ? 'invalid'
      : warnings.length && !confirmed
        ? 'warning'
        : 'valid';
    return {
      status,
      problems,
      warnings,
      existingPlantId,
      input:
        status === 'valid' && type && company && site && ownership
          ? {
              name: data.name!,
              assetId: data.assetId,
              plantNumber: data.plantNumber,
              serialNumber: data.serialNumber,
              plantTypeId: type.id,
              categoryId: category?.id,
              make: data.make,
              model: data.model,
              ownership,
              companyId: company.id,
              siteId: site.id,
              areaId: area?.id,
              disciplineIds: [],
              customValues,
            }
          : null,
    };
  }

  private async summaries(
    imports: PlantImportEntity[],
  ): Promise<PlantImportSummary[]> {
    if (imports.length === 0) return [];
    const counts = (await this.db.query(
      `select import_id as "importId", status, count(*)::int as count
         from corecheck.plant_import_rows
        where import_id = any($1::uuid[])
        group by import_id, status`,
      [imports.map((item) => item.id)],
    )) as Array<{ importId: string; status: ImportRowStatus; count: number }>;
    const users = await this.db.findBy(UserEntity, {
      id: In([...new Set(imports.map((item) => item.createdBy))]),
    });
    return imports.map((item) => {
      const count = (status: ImportRowStatus) =>
        counts.find((c) => c.importId === item.id && c.status === status)
          ?.count ?? 0;
      const user = users.find((candidate) => candidate.id === item.createdBy);
      return {
        id: item.id,
        fileName: item.fileName,
        createdBy: user ? fullName(user) : 'Unknown',
        createdAt: item.createdAt.toISOString(),
        counts: {
          valid: count('valid'),
          warning: count('warning'),
          invalid: count('invalid'),
          imported: count('imported'),
        },
      };
    });
  }
}
