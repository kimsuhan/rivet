export function countUnicodeCodePoints(value: string): number {
  return [...value].length;
}

export function normalizePasswordInput(value: string): string {
  return value.normalize('NFC');
}
