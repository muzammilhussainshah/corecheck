import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type CustomValue,
  type exportPlantsQuerySchema,
  PLANT_OWNERSHIP_LABELS,
  PLANT_STATUS_LABELS,
  type PlantSummary,
  type plantQrLabelsQuerySchema,
  RESTRICTION_REASON_LABELS,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { fieldError, forbidden } from '../common/errors.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { PlantCustomFieldEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { PlantsService } from './plants.service.js';

type ExportQuery = z.output<typeof exportPlantsQuerySchema>;
type LabelsQuery = z.output<typeof plantQrLabelsQuerySchema>;

export interface FileOutput {
  body: Buffer;
  filename: string;
  contentType: string;
}

/** The most rows one export or label sheet holds. */
const EXPORT_LIMIT = 10_000;
const LABEL_LIMIT = 500;

/**
 * Text a spreadsheet would run as a formula is prefixed with an apostrophe,
 * so an exported value can never execute in Excel (CSV injection).
 */
const safeCell = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const csvCell = (value: string): string => {
  const safe = safeCell(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const statusLabel = (plant: PlantSummary): string =>
  plant.archivedAt
    ? PLANT_STATUS_LABELS.archived
    : PLANT_STATUS_LABELS[plant.status];

/** Text cut to fit one line of the given width, ending "…" when cut. */
const fitLine = (
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
): string => {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && doc.widthOfString(`${cut}…`) > width)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};

/** Text wrapped on words into at most `max` lines, the last cut to fit. */
const fitLines = (
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  max: number,
): string[] => {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest && lines.length < max - 1) {
    const words = rest.split(/\s+/);
    let line = words.shift()!;
    while (words.length && doc.widthOfString(`${line} ${words[0]}`) <= width)
      line = `${line} ${words.shift()}`;
    if (doc.widthOfString(line) > width) break;
    lines.push(line);
    rest = words.join(' ');
  }
  if (rest) lines.push(fitLine(doc, rest, width));
  return lines;
};

/** A4 sheet of 3 × 7 labels, 63.5 × 38.1 mm (a common label stock). */
const MM = 72 / 25.4;
const LABEL = {
  columns: 3,
  rows: 7,
  width: 63.5 * MM,
  height: 38.1 * MM,
  left: 7.2 * MM,
  top: 15.1 * MM,
  gap: 2.5 * MM,
  padding: 3 * MM,
};

/**
 * Files made from the Plant Register: the Excel or CSV export (PLR-004) and
 * printable QR labels (PLT-008). Both cover only plant the user may see.
 */
@Injectable()
export class PlantOutputService {
  constructor(
    private readonly plants: PlantsService,
    private readonly tenantDb: TenantDb,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async export(auth: CustomerAuth, query: ExportQuery): Promise<FileOutput> {
    if (!auth.permissions.has('plant.export')) throw forbidden();
    const plants = await this.plants.listAll(auth, query, EXPORT_LIMIT);
    const fields = (
      await this.db.find(PlantCustomFieldEntity, {
        order: { sortOrder: 'ASC', label: 'ASC' },
      })
    ).filter((field) => !field.archivedAt);
    const extras = await this.extras(plants.map((plant) => plant.id));

    const header = [
      'System Asset ID',
      'Plant Number',
      'Serial Number',
      'Equipment name',
      'Plant type',
      'Category',
      'Make',
      'Model',
      'Ownership',
      'Owner / hire company',
      'Site',
      'Area',
      'Disciplines',
      'Status',
      'Restriction reason',
      ...fields.map((field) => field.label),
    ];
    const rows = plants.map((plant) => {
      const extra = extras.get(plant.id);
      return [
        plant.assetId,
        plant.plantNumber ?? '',
        plant.serialNumber ?? '',
        plant.name,
        plant.plantType.name,
        plant.category?.name ?? '',
        plant.make ?? '',
        plant.model ?? '',
        PLANT_OWNERSHIP_LABELS[plant.ownership],
        plant.company.name,
        plant.site.name,
        plant.area?.name ?? '',
        extra?.disciplines.join(', ') ?? '',
        statusLabel(plant),
        plant.restrictionReason
          ? RESTRICTION_REASON_LABELS[plant.restrictionReason]
          : '',
        ...fields.map((field) => String(extra?.customValues[field.id] ?? '')),
      ];
    });

    await this.plants.recordExport(auth, query.format, plants.length);
    const stamp = dateInTimeZone(this.clock.now(), auth.org.timeZone);
    const filename = `plant-register-${stamp}.${query.format}`;

    if (query.format === 'csv') {
      const lines = [header, ...rows].map((cells) =>
        cells.map(csvCell).join(','),
      );
      // The byte-order mark makes Excel read the file as UTF-8.
      return {
        body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
        filename,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CoreCheck';
    const sheet = workbook.addWorksheet('Plant register', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(header).font = { bold: true };
    for (const row of rows) sheet.addRow(row.map(safeCell));
    sheet.columns.forEach((column, index) => {
      const longest = Math.max(
        header[index]!.length,
        ...rows.map((row) => row[index]!.length),
      );
      column.width = Math.min(Math.max(longest + 2, 10), 50);
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };
    return {
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** A PDF of QR labels for chosen plant, or for a filtered register. */
  async labels(auth: CustomerAuth, query: LabelsQuery): Promise<FileOutput> {
    if (!auth.permissions.has('plant.qr')) throw forbidden();
    const plants = await this.plants.listAll(
      auth,
      query,
      LABEL_LIMIT,
      query.ids,
    );
    if (plants.length === 0)
      throw fieldError('ids', 'There is no plant to print labels for.');
    const tokens = new Map(
      (
        (await this.db.query(
          'select id, qr_token as "qrToken" from corecheck.plants where id = any($1::uuid[])',
          [plants.map((plant) => plant.id)],
        )) as Array<{ id: string; qrToken: string }>
      ).map((row) => [row.id, row.qrToken]),
    );

    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on('end', resolve));

    const perPage = LABEL.columns * LABEL.rows;
    for (const [index, plant] of plants.entries()) {
      if (index % perPage === 0) doc.addPage();
      const slot = index % perPage;
      const x = LABEL.left + (slot % LABEL.columns) * (LABEL.width + LABEL.gap);
      const y = LABEL.top + Math.floor(slot / LABEL.columns) * LABEL.height;
      const qrSize = LABEL.height - 2 * LABEL.padding;
      const qr = await QRCode.toBuffer(
        `${this.config.WEB_APP_URL}/q/${tokens.get(plant.id)}`,
        { margin: 0, width: 300, errorCorrectionLevel: 'M' },
      );
      doc.image(qr, x + LABEL.padding, y + LABEL.padding, {
        width: qrSize,
        height: qrSize,
      });
      const textX = x + LABEL.padding * 2 + qrSize;
      const textWidth = LABEL.width - (textX - x) - LABEL.padding;
      const top = y + LABEL.padding;
      const bottom = y + LABEL.height - LABEL.padding;
      // Each line is cut to the label's width so nothing spills onto the
      // next label; the name may take two lines.
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(fitLine(doc, plant.assetId, textWidth), textX, top + 1, {
        lineBreak: false,
      });
      doc.font('Helvetica').fontSize(8);
      for (const [line, text] of fitLines(
        doc,
        plant.name,
        textWidth,
        2,
      ).entries())
        doc.text(text, textX, top + 15 + line * 10, { lineBreak: false });
      doc.fillColor('#555555').fontSize(7);
      doc.text(fitLine(doc, plant.site.name, textWidth), textX, bottom - 17, {
        lineBreak: false,
      });
      doc.text(fitLine(doc, auth.org.name, textWidth), textX, bottom - 8, {
        lineBreak: false,
      });
      doc.fillColor('black');
    }
    doc.end();
    await done;
    return {
      body: Buffer.concat(chunks),
      filename: `plant-qr-labels-${dateInTimeZone(this.clock.now(), auth.org.timeZone)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  /** Disciplines and custom values, which the register rows leave out. */
  private async extras(
    ids: string[],
  ): Promise<
    Map<
      string,
      { disciplines: string[]; customValues: Record<string, CustomValue> }
    >
  > {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `select p.id, p.custom_values as "customValues",
              coalesce(array_agg(d.name order by lower(d.name))
                         filter (where d.id is not null), '{}') as disciplines
         from corecheck.plants p
         left join corecheck.plant_disciplines pd on pd.plant_id = p.id
         left join corecheck.disciplines d on d.id = pd.discipline_id
        where p.id = any($1::uuid[])
        group by p.id`,
      [ids],
    )) as Array<{
      id: string;
      customValues: Record<string, CustomValue>;
      disciplines: string[];
    }>;
    return new Map(rows.map((row) => [row.id, row]));
  }
}
