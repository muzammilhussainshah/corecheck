import ExcelJS from 'exceljs';
import { fieldError } from './errors.js';

/** One CSV document to rows of text, quotes and newlines in cells included. */
export const parseCsv = (text: string): string[][] => {
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
export const cellText = (value: ExcelJS.CellValue): string => {
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

/**
 * The first sheet of an Excel file, or a CSV file, as rows of text. Anything
 * else is refused with a message for the file field.
 */
export const readTable = async (
  buffer: Buffer,
  name: string,
): Promise<string[][]> => {
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
};
