import type { CsvImportMappingOptionsResponseDto } from '@rivet/api-client';

export type CsvImportColumnMapping = {
  assignee?: string;
  description?: string;
  labels?: string;
  priority?: string;
  project: string;
  sourceKey: string;
  status: string;
  team: string;
  title: string;
};

export type CsvImportValueContexts = {
  labels: string[];
  members: Array<{ source: string; teamSource: string }>;
  priorities: string[];
  projects: string[];
  states: Array<{ source: string; teamSource: string }>;
  teams: string[];
};

export type CsvImportValueSelections = {
  labels: Record<string, string>;
  members: Record<string, string>;
  priorities: Record<string, string>;
  projects: Record<string, string>;
  states: Record<string, string>;
  teams: Record<string, string>;
};

export const EXCLUDE = '__EXCLUDE__';
export const CREATE = '__CREATE__';
export const IGNORE = '__IGNORE__';
export const NONE = '__NONE__';

const COLUMN_ALIASES: Record<keyof CsvImportColumnMapping, string[]> = {
  assignee: ['assignee', '담당자', 'owner'],
  description: ['description', '설명', 'body', '본문'],
  labels: ['labels', 'label', '라벨', '태그'],
  priority: ['priority', '우선순위'],
  project: ['project', '프로젝트'],
  sourceKey: ['sourcekey', 'sourceid', 'externalid', 'id', 'key', '원본키', '외부키'],
  status: ['status', 'state', '상태'],
  team: ['team', '팀'],
  title: ['title', 'summary', '제목', '요약'],
};

function normalized(value: string): string {
  return value.normalize('NFC').trim();
}

function comparable(value: string): string {
  return normalized(value)
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]/gu, '');
}

export function contextKey(source: string, teamSource?: string): string {
  return `${teamSource ?? ''}\u0000${source}`;
}

export function guessColumnMapping(columns: string[]): Partial<CsvImportColumnMapping> {
  return Object.fromEntries(
    Object.entries(COLUMN_ALIASES).flatMap(([field, aliases]) => {
      const match = columns.find((column) => aliases.includes(comparable(column)));
      return match ? [[field, match]] : [];
    }),
  );
}

export function hasRequiredColumns(
  mapping: Partial<CsvImportColumnMapping>,
): mapping is CsvImportColumnMapping {
  return ['sourceKey', 'title', 'team', 'status', 'project'].every((field) =>
    Boolean(mapping[field as keyof CsvImportColumnMapping]),
  );
}

export function parseLocalCsv(text: string): {
  columns: string[];
  rows: Array<Record<string, string>>;
} {
  const records: string[][] = [];
  let record: string[] = [];
  let value = '';
  let quoted = false;
  let quoteClosed = false;
  const source = text.replace(/^\uFEFF/u, '').normalize('NFC');

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

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character !== '"') {
        value += character;
      } else if (source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = false;
        quoteClosed = true;
      }
      continue;
    }
    if (character === '"') {
      if (value.length > 0 || quoteClosed) throw new Error('IMPORT_CSV_INVALID');
      quoted = true;
    } else if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('IMPORT_CSV_INVALID');
    } else if (character === ',') {
      pushValue();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      pushRecord();
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('IMPORT_CSV_INVALID');
  if (value.length > 0 || record.length > 0 || quoteClosed) pushRecord();

  const columns = (records[0] ?? []).map(normalized);
  return {
    columns,
    rows: records
      .slice(1)
      .filter((row) => row.some((cell) => cell.length > 0))
      .map((row) =>
        Object.fromEntries(
          columns.map((column, index) => [column, row[index]?.normalize('NFC') ?? '']),
        ),
      ),
  };
}

export function deriveValueContexts(
  rows: Array<Record<string, string>>,
  columns: CsvImportColumnMapping,
): CsvImportValueContexts {
  const teams = new Set<string>();
  const states = new Map<string, { source: string; teamSource: string }>();
  const members = new Map<string, { source: string; teamSource: string }>();
  const projects = new Set<string>();
  const priorities = new Set<string>();
  const labels = new Set<string>();

  for (const row of rows) {
    const teamSource = normalized(row[columns.team] ?? '');
    const stateSource = normalized(row[columns.status] ?? '');
    const memberSource = columns.assignee ? normalized(row[columns.assignee] ?? '') : '';
    const projectSource = normalized(row[columns.project] ?? '');
    const prioritySource = columns.priority ? normalized(row[columns.priority] ?? '') : '';
    const labelSources = columns.labels
      ? (row[columns.labels] ?? '').split(/[;|]/u).map(normalized).filter(Boolean)
      : [];

    if (teamSource) teams.add(teamSource);
    if (teamSource && stateSource) {
      states.set(contextKey(stateSource, teamSource), { source: stateSource, teamSource });
    }
    if (teamSource && memberSource) {
      members.set(contextKey(memberSource, teamSource), { source: memberSource, teamSource });
    }
    if (projectSource) projects.add(projectSource);
    if (prioritySource) priorities.add(prioritySource);
    for (const label of labelSources) labels.add(label);
  }

  const sort = (left: string, right: string): number => left.localeCompare(right, 'ko');
  const sortContext = (
    left: { source: string; teamSource: string },
    right: { source: string; teamSource: string },
  ): number =>
    sort(`${left.teamSource}\u0000${left.source}`, `${right.teamSource}\u0000${right.source}`);
  return {
    labels: [...labels].sort(sort),
    members: [...members.values()].sort(sortContext),
    priorities: [...priorities].sort(sort),
    projects: [...projects].sort(sort),
    states: [...states.values()].sort(sortContext),
    teams: [...teams].sort(sort),
  };
}

function equal(left: string, right: string): boolean {
  return comparable(left) === comparable(right);
}

function defaultPriority(source: string): string {
  const priorities: Record<string, string> = {
    high: 'HIGH',
    low: 'LOW',
    medium: 'MEDIUM',
    none: 'NONE',
    urgent: 'URGENT',
    긴급: 'URGENT',
    낮음: 'LOW',
    없음: 'NONE',
    높음: 'HIGH',
    보통: 'MEDIUM',
  };
  return priorities[normalized(source).toLocaleLowerCase('en-US')] ?? 'NONE';
}

export function initialValueSelections(
  contexts: CsvImportValueContexts,
  options: CsvImportMappingOptionsResponseDto,
): CsvImportValueSelections {
  const teams = Object.fromEntries(
    contexts.teams.map((source) => {
      const target = options.teams.find(
        (team) => equal(team.name, source) || equal(team.key, source),
      );
      return [source, target?.id ?? EXCLUDE];
    }),
  );
  const states = Object.fromEntries(
    contexts.states.map(({ source, teamSource }) => {
      const teamId = teams[teamSource];
      const target = options.states.find(
        (state) => state.teamId === teamId && equal(state.name, source),
      );
      return [contextKey(source, teamSource), teamId === EXCLUDE ? EXCLUDE : (target?.id ?? '')];
    }),
  );
  const members = Object.fromEntries(
    contexts.members.map(({ source, teamSource }) => {
      const teamId = teams[teamSource];
      const target = options.members.find(
        (member) =>
          member.teamIds.includes(teamId ?? '') &&
          (equal(member.displayName, source) || equal(member.email, source)),
      );
      return [contextKey(source, teamSource), target?.id ?? NONE];
    }),
  );
  return {
    labels: Object.fromEntries(
      contexts.labels.map((source) => {
        const target = options.labels.find((label) => equal(label.name, source));
        return [source, target?.id ?? CREATE];
      }),
    ),
    members,
    priorities: Object.fromEntries(
      contexts.priorities.map((source) => [source, defaultPriority(source)]),
    ),
    projects: Object.fromEntries(
      contexts.projects.map((source) => {
        const target = options.projects.find((project) => equal(project.name, source));
        return [source, target?.id ?? CREATE];
      }),
    ),
    states,
    teams,
  };
}

export function valueSelectionsComplete(
  contexts: CsvImportValueContexts,
  selections: CsvImportValueSelections,
): boolean {
  return (
    contexts.teams.every((source) => Boolean(selections.teams[source])) &&
    contexts.states.every(({ source, teamSource }) =>
      selections.teams[teamSource] === EXCLUDE
        ? true
        : Boolean(selections.states[contextKey(source, teamSource)]),
    ) &&
    contexts.members.every(({ source, teamSource }) =>
      Boolean(selections.members[contextKey(source, teamSource)]),
    ) &&
    contexts.projects.every((source) => Boolean(selections.projects[source])) &&
    contexts.priorities.every((source) => Boolean(selections.priorities[source])) &&
    contexts.labels.every((source) => Boolean(selections.labels[source]))
  );
}

export function buildImportMapping(
  columns: CsvImportColumnMapping,
  contexts: CsvImportValueContexts,
  selections: CsvImportValueSelections,
  options: CsvImportMappingOptionsResponseDto,
): string {
  return JSON.stringify({
    columns,
    labels: contexts.labels.map((source) => {
      const value = selections.labels[source];
      return value === CREATE
        ? { mode: 'CREATE', source }
        : value === IGNORE
          ? { mode: 'IGNORE', source }
          : { mode: 'MAP', source, targetId: value };
    }),
    members: contexts.members.map(({ source, teamSource }) => {
      const value = selections.members[contextKey(source, teamSource)];
      return value === NONE
        ? { mode: 'NONE', source, teamSource }
        : { mode: 'MAP', source, targetId: value, teamSource };
    }),
    priorities: contexts.priorities.map((source) => ({
      mode: 'MAP',
      source,
      targetValue: selections.priorities[source],
    })),
    projects: contexts.projects.map((source) => {
      const value = selections.projects[source];
      return value === CREATE
        ? { mode: 'CREATE', source }
        : value === EXCLUDE
          ? { mode: 'EXCLUDE', source }
          : { mode: 'MAP', source, targetId: value };
    }),
    states: contexts.states.map(({ source, teamSource }) => {
      const value =
        selections.teams[teamSource] === EXCLUDE
          ? EXCLUDE
          : selections.states[contextKey(source, teamSource)];
      return value === EXCLUDE
        ? { mode: 'EXCLUDE', source, teamSource }
        : { mode: 'MAP', source, targetId: value, teamSource };
    }),
    targetFingerprint: options.targetFingerprint,
    teams: contexts.teams.map((source) => {
      const value = selections.teams[source];
      return value === EXCLUDE
        ? { mode: 'EXCLUDE', source }
        : { mode: 'MAP', source, targetId: value };
    }),
  });
}
