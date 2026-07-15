import { describe, expect, it } from 'vitest';

import {
  buildImportMapping,
  contextKey,
  deriveValueContexts,
  guessColumnMapping,
  initialValueSelections,
  parseLocalCsv,
} from './csv-import-model';

describe('CSV import UI model', () => {
  it('parses quoted CSV locally without persisting raw rows', () => {
    expect(
      parseLocalCsv('id,title,team,status,project\r\n1,"쉼표, 제목",웹,진행 중,알파\r\n'),
    ).toEqual({
      columns: ['id', 'title', 'team', 'status', 'project'],
      rows: [{ id: '1', project: '알파', status: '진행 중', team: '웹', title: '쉼표, 제목' }],
    });
  });

  it('derives team-scoped state and member mappings', () => {
    const rows = [
      {
        assignee: '김개발',
        labels: '버그;긴급',
        priority: '높음',
        project: '알파',
        status: '진행 중',
        team: '웹',
      },
      {
        assignee: '김개발',
        labels: '버그',
        priority: '높음',
        project: '알파',
        status: '진행 중',
        team: '앱',
      },
    ];
    const contexts = deriveValueContexts(rows, {
      assignee: 'assignee',
      labels: 'labels',
      priority: 'priority',
      project: 'project',
      sourceKey: 'id',
      status: 'status',
      team: 'team',
      title: 'title',
    });

    expect(contexts.states).toEqual([
      { source: '진행 중', teamSource: '앱' },
      { source: '진행 중', teamSource: '웹' },
    ]);
    expect(contexts.members).toHaveLength(2);
    expect(contexts.labels).toEqual(['긴급', '버그']);
  });

  it('guesses common headers and emits the server mapping contract', () => {
    const columns = guessColumnMapping(['External ID', '제목', '팀', '상태', '프로젝트']);
    expect(columns).toEqual({
      project: '프로젝트',
      sourceKey: 'External ID',
      status: '상태',
      team: '팀',
      title: '제목',
    });

    const contexts = {
      labels: [],
      members: [],
      priorities: [],
      projects: ['알파'],
      states: [{ source: '할 일', teamSource: '웹' }],
      teams: ['웹'],
    };
    const options = {
      labels: [],
      members: [],
      priorities: ['NONE' as const],
      projects: [],
      states: [
        {
          category: 'UNSTARTED' as const,
          id: 'state-id',
          name: '할 일',
          teamId: 'team-id',
          version: 1,
        },
      ],
      targetFingerprint: 'a'.repeat(64),
      teams: [{ id: 'team-id', key: 'WEB', name: '웹', version: 1 }],
    };
    const selections = initialValueSelections(contexts, options);
    const mapping = JSON.parse(
      buildImportMapping(columns as Required<typeof columns>, contexts, selections, options),
    ) as Record<string, unknown>;

    expect(selections.states[contextKey('할 일', '웹')]).toBe('state-id');
    expect(mapping).toMatchObject({
      projects: [{ mode: 'CREATE', source: '알파' }],
      states: [{ mode: 'MAP', source: '할 일', targetId: 'state-id', teamSource: '웹' }],
      teams: [{ mode: 'MAP', source: '웹', targetId: 'team-id' }],
    });
  });
});
