import {
  CSV_IMPORT_MAX_BYTES,
  CSV_IMPORT_MAX_COLUMNS,
  CSV_IMPORT_MAX_ROWS,
  isFormulaCell,
  parseCsvImportFile,
} from './csv-import.parser';

function file(
  contents: Buffer | string,
  overrides: Partial<{ mimetype: string; originalname: string }> = {},
) {
  const buffer = typeof contents === 'string' ? Buffer.from(contents) : contents;
  return {
    buffer,
    mimetype: overrides.mimetype ?? 'text/csv',
    originalname: overrides.originalname ?? 'issues.csv',
    size: buffer.length,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe('CSV import parser', () => {
  it('parses UTF-8 BOM, CRLF, escaped quotes, and quoted newlines', () => {
    const result = parseCsvImportFile(
      file('\uFEFFid,title,description\r\nA-1,"따옴표 ""제목""","두 줄\n설명"\r\n'),
    );

    expect(result.columns).toEqual(['id', 'title', 'description']);
    expect(result.rows).toEqual([
      { description: '두 줄\n설명', id: 'A-1', title: '따옴표 "제목"' },
    ]);
    expect(result.structureErrors).toEqual([]);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ['', 'IMPORT_FILE_EMPTY'],
    ['id,title\n', 'IMPORT_FILE_EMPTY'],
    ['id,id\n1,2\n', 'IMPORT_HEADER_INVALID'],
    ['id,\n1,2\n', 'IMPORT_HEADER_INVALID'],
    ['id,title\n1,"열린 따옴표\n', 'IMPORT_CSV_INVALID'],
  ])('rejects an invalid file with %s', (contents, code) => {
    expectCode(() => parseCsvImportFile(file(contents)), code);
  });

  it('rejects non-UTF-8 and UTF-16 byte sequences', () => {
    expectCode(
      () => parseCsvImportFile(file(Buffer.from([0x69, 0x64, 0x0a, 0xc3, 0x28]))),
      'IMPORT_ENCODING_INVALID',
    );
    expectCode(
      () => parseCsvImportFile(file(Buffer.from([0xff, 0xfe, 0x69, 0x00]))),
      'IMPORT_ENCODING_INVALID',
    );
  });

  it('returns row-level errors when a row has the wrong number of columns', () => {
    expect(parseCsvImportFile(file('id,title\nA-1,첫째\nA-2\n')).structureErrors).toEqual([
      { code: 'IMPORT_ROW_COLUMN_COUNT_INVALID', rowNumber: 3 },
    ]);
  });

  it('accepts the row and byte boundaries and rejects one over the boundaries', () => {
    const boundaryRows = `id\n${Array.from({ length: CSV_IMPORT_MAX_ROWS }, (_, index) => index).join('\n')}\n`;
    expect(parseCsvImportFile(file(boundaryRows)).rows).toHaveLength(CSV_IMPORT_MAX_ROWS);
    expectCode(
      () => parseCsvImportFile(file(`${boundaryRows}${CSV_IMPORT_MAX_ROWS}\n`)),
      'IMPORT_ROW_LIMIT_EXCEEDED',
    );

    const prefix = Buffer.from('id\n');
    const boundary = Buffer.concat([
      prefix,
      Buffer.alloc(CSV_IMPORT_MAX_BYTES - prefix.length - 1, 0x61),
      Buffer.from('\n'),
    ]);
    expect(parseCsvImportFile(file(boundary)).rows).toHaveLength(1);
    expectCode(
      () => parseCsvImportFile(file(Buffer.concat([boundary, Buffer.from('a')]))),
      'IMPORT_FILE_TOO_LARGE',
    );
  });

  it('accepts the column boundary and rejects one over the boundary', () => {
    const columns = Array.from({ length: CSV_IMPORT_MAX_COLUMNS }, (_, index) => `column_${index}`);
    const values = columns.map((_, index) => String(index));
    expect(
      parseCsvImportFile(file(`${columns.join(',')}\n${values.join(',')}\n`)).columns,
    ).toHaveLength(CSV_IMPORT_MAX_COLUMNS);

    const extraColumns = [...columns, 'column_over_limit'];
    expectCode(
      () => parseCsvImportFile(file(`${extraColumns.join(',')}\n${values.join(',')},over\n`)),
      'IMPORT_COLUMN_LIMIT_EXCEEDED',
    );
  });

  it('rejects wrong extensions and media types', () => {
    expectCode(
      () => parseCsvImportFile(file('id\n1\n', { originalname: 'issues.xlsx' })),
      'IMPORT_FILE_TYPE_INVALID',
    );
    expectCode(
      () => parseCsvImportFile(file('id\n1\n', { mimetype: 'application/json' })),
      'IMPORT_FILE_TYPE_INVALID',
    );
  });

  it.each(['=1+1', ' +SUM(A1:A2)', '-2+3', '@cmd', '\t=1'])(
    'detects formula injection in %s',
    (value) => expect(isFormulaCell(value)).toBe(true),
  );

  it('does not treat ordinary text as a formula', () => {
    expect(isFormulaCell('완료')).toBe(false);
  });
});
