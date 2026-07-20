function hashTeamName(name: string) {
  let hash = 2_166_136_261;

  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  let letters = '';
  let value = hash >>> 0;

  for (let index = 0; index < 4; index += 1) {
    letters += String.fromCharCode(65 + (value % 26));
    value = Math.floor(value / 26);
  }

  return letters;
}

export function createTeamKey(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return '';
  }

  const words = trimmedName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z]+/g);

  if (!words?.length) {
    return `T${hashTeamName(trimmedName)}`;
  }

  if (words.length === 1) {
    const [word] = words;
    const key = word?.slice(0, 5).toUpperCase() ?? '';
    return key.length < 2 ? `${key}TEAM`.slice(0, 5) : key;
  }

  return words
    .map((word) => word[0])
    .join('')
    .slice(0, 5)
    .toUpperCase();
}

export function normalizeTeamKey(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 5);
}
