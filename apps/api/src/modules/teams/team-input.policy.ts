export function normalizeTeamResourceName(value: string): {
  name: string;
  normalizedName: string;
} {
  const name = value.normalize('NFC').trim();
  return { name, normalizedName: name.toLowerCase() };
}
