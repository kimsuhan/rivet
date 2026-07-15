import { createHash } from 'node:crypto';

export const CSV_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 10_000;
export const CSV_IMPORT_MAX_COLUMNS = 50;
export const CSV_IMPORT_MAX_DISTINCT_VALUES = 200;

const ALLOWED_MIME_TYPES = new Set([
  'application/csv',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
]);

export type CsvStructureError = {
  code: 'IMPORT_ROW_COLUMN_COUNT_INVALID';
  rowNumber: number;
};

export type ParsedCsvImport = {
  columns: string[];
  fingerprint: string;
  rows: Array<Record<string, string>>;
  structureErrors: CsvStructureError[];
};

export type CsvImportUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export class CsvImportParseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = CsvImportParseError.name;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    throw new CsvImportParseError('IMPORT_ENCODING_INVALID');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/u, '')
      .normalize('NFC');
  } catch {
    throw new CsvImportParseError('IMPORT_ENCODING_INVALID');
  }
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = '';
  let quoted = false;
  let quoteClosed = false;

  const pushValue = (): void => {
    record.push(value);
    value = '';
    quoteClosed = false;
  };
  const pushRecord = (): void => {
    pushValue();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') {
        value += character;
        continue;
      }
      if (text[index + 1] === '"') {
        value += '"';
        index += 1;
        continue;
      }
      quoted = false;
      quoteClosed = true;
      continue;
    }

    if (character === '"') {
      if (value.length > 0 || quoteClosed) throw new CsvImportParseError('IMPORT_CSV_INVALID');
      quoted = true;
      continue;
    }
    if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n') {
      throw new CsvImportParseError('IMPORT_CSV_INVALID');
    }
    if (character === ',') {
      pushValue();
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRecord();
      continue;
    }
    value += character;
  }

  if (quoted) throw new CsvImportParseError('IMPORT_CSV_INVALID');
  if (value.length > 0 || record.length > 0 || quoteClosed) pushRecord();
  return records;
}

export function parseCsvImportFile(file: CsvImportUpload | undefined): ParsedCsvImport {
  if (!file) throw new CsvImportParseError('IMPORT_FILE_REQUIRED');
  if (file.size < 1 || file.buffer.length < 1) throw new CsvImportParseError('IMPORT_FILE_EMPTY');
  if (file.size > CSV_IMPORT_MAX_BYTES || file.buffer.length > CSV_IMPORT_MAX_BYTES) {
    throw new CsvImportParseError('IMPORT_FILE_TOO_LARGE');
  }
  if (!file.originalname.toLocaleLowerCase('en-US').endsWith('.csv')) {
    throw new CsvImportParseError('IMPORT_FILE_TYPE_INVALID');
  }
  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype.toLocaleLowerCase('en-US'))) {
    throw new CsvImportParseError('IMPORT_FILE_TYPE_INVALID');
  }

  const text = decodeUtf8(file.buffer);
  if (text.includes('\u0000')) throw new CsvImportParseError('IMPORT_ENCODING_INVALID');
  if (text.trim().length === 0) throw new CsvImportParseError('IMPORT_FILE_EMPTY');
  const records = parseRecords(text);
  if (records.length < 2) throw new CsvImportParseError('IMPORT_FILE_EMPTY');

  const rawColumns = records[0]!;
  if (rawColumns.length > CSV_IMPORT_MAX_COLUMNS) {
    throw new CsvImportParseError('IMPORT_COLUMN_LIMIT_EXCEEDED');
  }
  const columns = rawColumns.map((column) => column.normalize('NFC').trim());
  if (columns.some((column) => column.length === 0) || new Set(columns).size !== columns.length) {
    throw new CsvImportParseError('IMPORT_HEADER_INVALID');
  }

  const dataRecords = records.slice(1).filter((row) => row.some((cell) => cell.length > 0));
  if (dataRecords.length === 0) throw new CsvImportParseError('IMPORT_FILE_EMPTY');
  if (dataRecords.length > CSV_IMPORT_MAX_ROWS) {
    throw new CsvImportParseError('IMPORT_ROW_LIMIT_EXCEEDED');
  }

  const structureErrors: CsvStructureError[] = [];
  const rows = dataRecords.map((record, index) => {
    if (record.length !== columns.length) {
      structureErrors.push({ code: 'IMPORT_ROW_COLUMN_COUNT_INVALID', rowNumber: index + 2 });
    }
    return Object.fromEntries(
      columns.map((column, columnIndex) => [column, record[columnIndex]?.normalize('NFC') ?? '']),
    );
  });

  return {
    columns,
    fingerprint: createHash('sha256').update(file.buffer).digest('hex'),
    rows,
    structureErrors,
  };
}

export function isFormulaCell(value: string): boolean {
  return /^[\t\r]/u.test(value) || /^[=+\-@]/u.test(value.trimStart());
}

export function splitLabelValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[;|]/u)
        .map((item) => item.normalize('NFC').trim())
        .filter(Boolean),
    ),
  ];
}
