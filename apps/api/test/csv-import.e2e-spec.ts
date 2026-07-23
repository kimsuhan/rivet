import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Test as RequestTest } from 'supertest';

import { IssueStatus, MembershipRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const CSV_HEADER = 'sourceKey,title,description,team,status,assignee,project,priority,labels';

type Fixture = {
  adminMembershipId: string;
  adminUserId: string;
  foreignAdminUserId: string;
  foreignTeamId: string;
  foreignWorkspaceId: string;
  memberUserId: string;
  projectId: string;
  stateId: string;
  teamId: string;
  workspaceId: string;
};

type MappingOptions = {
  labels: Array<{ id: string; name: string }>;
  members: Array<{ displayName: string; id: string }>;
  projects: Array<{ id: string; name: string }>;
  states: Array<{ id: string; name: string; teamId: string }>;
  targetFingerprint: string;
  teams: Array<{ id: string; name: string }>;
};

function csv(...rows: string[]): Buffer {
  return Buffer.from(`${CSV_HEADER}\n${rows.join('\n')}\n`);
}

function multipart(
  server: Parameters<typeof request>[0],
  path: 'execute' | 'inspect' | 'validate',
  cookie: string,
  csrf: string,
  executionId: string,
  contents: Buffer,
  fields: { allowDuplicateFile?: boolean; mapping?: string; validationSignature?: string } = {},
): RequestTest {
  let call = request(server)
    .post(`/api/v1/imports/csv/${path}`)
    .set('Cookie', cookie)
    .set('Origin', WEB_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .field('executionId', executionId);
  if (fields.mapping) call = call.field('mapping', fields.mapping);
  if (fields.validationSignature) {
    call = call.field('validationSignature', fields.validationSignature);
  }
  if (fields.allowDuplicateFile !== undefined) {
    call = call.field('allowDuplicateFile', String(fields.allowDuplicateFile));
  }
  return call.attach('file', contents, { contentType: 'text/csv', filename: 'issues.csv' });
}

function mapping(
  options: MappingOptions,
  config: {
    project: 'CREATE' | 'MAP';
    projectName: string;
    projectTargetId?: string;
    teamTargetId?: string;
  },
): string {
  const teamId = config.teamTargetId ?? options.teams.find(({ name }) => name === '웹')?.id;
  const stateId =
    options.states.find((state) => state.name === '할 일' && state.teamId === teamId)?.id ??
    options.states.find((state) => state.name === '할 일')?.id;
  const memberId = options.members.find(({ displayName }) => displayName === '가져오기 관리자')?.id;
  if (!teamId || !stateId || !memberId) throw new Error('CSV 테스트 매핑 대상을 찾을 수 없습니다.');
  return JSON.stringify({
    columns: {
      assignee: 'assignee',
      description: 'description',
      labels: 'labels',
      priority: 'priority',
      project: 'project',
      sourceKey: 'sourceKey',
      status: 'status',
      team: 'team',
      title: 'title',
    },
    labels: [
      options.labels.some(({ name }) => name === '버그')
        ? {
            mode: 'MAP',
            source: '버그',
            targetId: options.labels.find(({ name }) => name === '버그')?.id,
          }
        : { mode: 'CREATE', source: '버그' },
    ],
    members: [{ mode: 'MAP', source: '관리자', targetId: memberId, teamSource: '웹' }],
    priorities: [{ mode: 'MAP', source: '높음', targetValue: 'HIGH' }],
    projects: [
      config.project === 'CREATE'
        ? { mode: 'CREATE', source: config.projectName }
        : { mode: 'MAP', source: config.projectName, targetId: config.projectTargetId },
    ],
    states: [{ mode: 'MAP', source: '할 일', targetId: stateId, teamSource: '웹' }],
    targetFingerprint: options.targetFingerprint,
    teams: [{ mode: 'MAP', source: '웹', targetId: teamId }],
  });
}

describe('Alpha A1 CSV import API', () => {
  const runId = randomUUID().slice(0, 8);
  const emails = [
    `csv.admin.${runId}@example.com`,
    `csv.member.${runId}@example.com`,
    `csv.foreign.${runId}@example.com`,
  ];
  let app: INestApplication;
  let database: DatabaseService;
  let fixture: Fixture;
  let adminCookie: string;
  let adminCsrf: string;
  let memberCookie: string;
  let foreignCookie: string;
  let options: MappingOptions;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    fixture = await database.client.$transaction(async (transaction) => {
      const [admin, member, foreignAdmin] = await Promise.all(
        emails.map((email, index) =>
          transaction.user.create({
            data: {
              displayName: ['가져오기 관리자', '일반 멤버', '다른 관리자'][index]!,
              email,
              emailVerifiedAt: new Date(),
              normalizedEmail: email,
              passwordHash: 'integration-password-hash',
            },
          }),
        ),
      );
      if (!admin || !member || !foreignAdmin) throw new Error('CSV 테스트 사용자가 없습니다.');
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: admin.id,
          name: 'CSV 워크스페이스',
          normalizedSlug: `csv-${runId}`,
          slug: `csv-${runId}`,
        },
      });
      const foreignWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: foreignAdmin.id,
          name: '다른 CSV 워크스페이스',
          normalizedSlug: `csv-foreign-${runId}`,
          slug: `csv-foreign-${runId}`,
        },
      });
      const adminMembership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: admin.id, workspaceId: workspace.id },
      });
      await transaction.workspaceMembership.create({
        data: { role: MembershipRole.MEMBER, userId: member.id, workspaceId: workspace.id },
      });
      await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          userId: foreignAdmin.id,
          workspaceId: foreignWorkspace.id,
        },
      });
      const team = await transaction.team.create({
        data: { key: 'WEB', name: '웹', normalizedName: '웹', workspaceId: workspace.id },
      });
      const foreignTeam = await transaction.team.create({
        data: {
          key: 'OUT',
          name: '다른 팀',
          normalizedName: '다른 팀',
          workspaceId: foreignWorkspace.id,
        },
      });
      await transaction.teamMember.create({
        data: {
          membershipId: adminMembership.id,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const state = await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '외부 할 일',
          normalizedName: '외부 할 일',
          position: 0,
          teamId: foreignTeam.id,
          workspaceId: foreignWorkspace.id,
        },
      });
      const project = await transaction.project.create({
        data: { name: '기존 프로젝트', workspaceId: workspace.id },
      });
      await transaction.projectTeam.create({
        data: { projectId: project.id, teamId: team.id, workspaceId: workspace.id },
      });
      return {
        adminMembershipId: adminMembership.id,
        adminUserId: admin.id,
        foreignAdminUserId: foreignAdmin.id,
        foreignTeamId: foreignTeam.id,
        foreignWorkspaceId: foreignWorkspace.id,
        memberUserId: member.id,
        projectId: project.id,
        stateId: state.id,
        teamId: team.id,
        workspaceId: workspace.id,
      };
    });

    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession, foreignSession] = await Promise.all([
      sessions.create(fixture.adminUserId),
      sessions.create(fixture.memberUserId),
      sessions.create(fixture.foreignAdminUserId),
    ]);
    adminCookie = `rivet_session=${adminSession.token}`;
    adminCsrf = createCsrfToken(adminSession.token, CSRF_HMAC_KEY);
    memberCookie = `rivet_session=${memberSession.token}`;
    foreignCookie = `rivet_session=${foreignSession.token}`;

    const response = await request(app.getHttpServer())
      .get('/api/v1/imports/csv/mapping-options')
      .set('Cookie', adminCookie)
      .expect(200);
    options = response.body as MappingOptions;
  });

  afterAll(async () => {
    if (database && fixture) {
      const workspaceIds = [fixture.workspaceId, fixture.foreignWorkspaceId];
      const users = await database.client.user.findMany({
        select: { id: true },
        where: { normalizedEmail: { in: emails } },
      });
      const userIds = users.map(({ id }) => id);
      await database.client.importSourceRow.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamWork.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.importRun.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.projectTeam.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamMember.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('imports once under concurrent execution, preserves success, and prevents a duplicate file', async () => {
    const executionId = randomUUID();
    const contents = csv('A-1,첫 이슈,업무 설명,웹,할 일,관리자,기존 프로젝트,높음,버그');
    const currentMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
    });

    await multipart(app.getHttpServer(), 'inspect', adminCookie, adminCsrf, executionId, contents)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ rowCount: 1, unsupportedColumns: [] });
      });
    const validation = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: currentMapping },
    ).expect(200);
    expect(validation.body).toMatchObject({ canExecute: true, summary: { issueCreateCount: 1 } });

    const signature = validation.body.validationSignature as string;
    const executions = await Promise.all([
      multipart(app.getHttpServer(), 'execute', adminCookie, adminCsrf, executionId, contents, {
        mapping: currentMapping,
        validationSignature: signature,
      }),
      multipart(app.getHttpServer(), 'execute', adminCookie, adminCsrf, executionId, contents, {
        mapping: currentMapping,
        validationSignature: signature,
      }),
    ]);
    expect(executions.map(({ status }) => status).sort()).toEqual([200, 409]);

    const run = await database.client.importRun.findUniqueOrThrow({
      where: { workspaceId_executionId: { executionId, workspaceId: fixture.workspaceId } },
    });
    expect(run).toMatchObject({ issueCreatedCount: 1, status: 'SUCCEEDED' });
    expect(run.errorDetails).toBeNull();
    expect(await database.client.importSourceRow.count({ where: { importRunId: run.id } })).toBe(1);

    const duplicateExecutionId = randomUUID();
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      duplicateExecutionId,
      contents,
    ).expect(200);
    const duplicate = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      duplicateExecutionId,
      contents,
      { mapping: currentMapping },
    ).expect(200);
    expect(duplicate.body.canExecute).toBe(false);
    expect(duplicate.body.errors).toContainEqual(
      expect.objectContaining({ code: 'IMPORT_FILE_ALREADY_COMPLETED' }),
    );
    const refreshed = await request(app.getHttpServer())
      .get('/api/v1/imports/csv/mapping-options')
      .set('Cookie', adminCookie)
      .expect(200);
    options = refreshed.body as MappingOptions;

    const allowedExecutionId = randomUUID();
    const allowedMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
    });
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      allowedExecutionId,
      contents,
    ).expect(200);
    const allowed = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      allowedExecutionId,
      contents,
      { allowDuplicateFile: true, mapping: allowedMapping },
    ).expect(200);
    expect(allowed.body).toMatchObject({
      canExecute: true,
      duplicateCompletedRun: true,
      summary: { excludedRowCount: 1, issueCreateCount: 0 },
    });
    expect(allowed.body.warnings).toContainEqual(
      expect.objectContaining({ code: 'IMPORT_SOURCE_ALREADY_IMPORTED' }),
    );
    const allowedExecution = await multipart(
      app.getHttpServer(),
      'execute',
      adminCookie,
      adminCsrf,
      allowedExecutionId,
      contents,
      {
        allowDuplicateFile: true,
        mapping: allowedMapping,
        validationSignature: allowed.body.validationSignature as string,
      },
    ).expect(200);
    expect(allowedExecution.body).toMatchObject({
      excludedRowCount: 1,
      issueCreatedCount: 0,
      status: 'SUCCEEDED',
    });
  });

  it('rejects members and admins from other workspaces from results and mapping targets', async () => {
    const completed = await database.client.importRun.findFirstOrThrow({
      select: { executionId: true },
      where: { status: 'SUCCEEDED', workspaceId: fixture.workspaceId },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/imports/csv/runs/${completed.executionId}`)
      .set('Cookie', memberCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/imports/csv/runs/${completed.executionId}`)
      .set('Cookie', foreignCookie)
      .expect(404);

    const executionId = randomUUID();
    const contents = csv('WS-1,격리 확인,,웹,할 일,관리자,기존 프로젝트,높음,버그');
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const unsafeMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
      teamTargetId: fixture.foreignTeamId,
    });
    const response = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: unsafeMapping },
    ).expect(200);
    expect(response.body.canExecute).toBe(false);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ code: 'IMPORT_TEAM_TARGET_INVALID' }),
    );
  });

  it.each([
    [
      'formula injection',
      'F-1,=2+3,,웹,할 일,관리자,기존 프로젝트,높음,버그',
      'IMPORT_FORMULA_VALUE',
    ],
    [
      'duplicate source keys',
      'DUP,첫째,,웹,할 일,관리자,기존 프로젝트,높음,버그\nDUP,둘째,,웹,할 일,관리자,기존 프로젝트,높음,버그',
      'IMPORT_SOURCE_KEY_DUPLICATE',
    ],
    [
      'unknown mapping value',
      'UNKNOWN-1,미지 값,,웹,알 수 없음,관리자,기존 프로젝트,높음,버그',
      'IMPORT_STATE_MAPPING_REQUIRED',
    ],
  ])('returns a row preview for %s', async (_name, rows, code) => {
    const executionId = randomUUID();
    const contents = csv(...rows.split('\n'));
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const response = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: mapping(options, {
          project: 'MAP',
          projectName: '기존 프로젝트',
          projectTargetId: fixture.projectId,
        }),
      },
    ).expect(200);
    expect(response.body.canExecute).toBe(false);
    expect(response.body.errors).toContainEqual(expect.objectContaining({ code }));
    expect(JSON.stringify(response.body.errors)).not.toContain('=2+3');
  });

  it('reports unsupported mention and file references in descriptions without importing them', async () => {
    const executionId = randomUUID();
    const fileId = randomUUID();
    const description =
      `참고 @[관리자](rivet-member:${fixture.adminMembershipId}) ` + `![첨부](/files/${fileId})`;
    const contents = csv(
      `REF-1,참조 포함 이슈,${description},웹,할 일,관리자,기존 프로젝트,높음,버그`,
    );
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const response = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: mapping(options, {
          project: 'MAP',
          projectName: '기존 프로젝트',
          projectTargetId: fixture.projectId,
        }),
      },
    ).expect(200);
    expect(response.body.canExecute).toBe(false);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({
        code: 'IMPORT_DESCRIPTION_REFERENCE_UNSUPPORTED',
        field: 'description',
      }),
    );
    expect(JSON.stringify(response.body.errors)).not.toContain(fixture.adminMembershipId);
    expect(JSON.stringify(response.body.errors)).not.toContain(fileId);
  });

  it('does not allow a named unsupported column to be mapped into a supported field', async () => {
    const executionId = randomUUID();
    const contents = Buffer.from(
      'sourceKey,title,comments,team,status,assignee,project,priority,labels\n' +
        'COLUMN-1,미지원 컬럼,댓글 본문,웹,할 일,관리자,기존 프로젝트,높음,버그\n',
    );
    const inspection = await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    expect(inspection.body.unsupportedColumns).toEqual(['comments']);
    const unsafeMapping = JSON.parse(
      mapping(options, {
        project: 'MAP',
        projectName: '기존 프로젝트',
        projectTargetId: fixture.projectId,
      }),
    ) as { columns: { description: string } };
    unsafeMapping.columns.description = 'comments';

    const response = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: JSON.stringify(unsafeMapping) },
    ).expect(422);
    expect(response.body.code).toBe('IMPORT_COLUMN_MAPPING_INVALID');
  });

  it('requires revalidation when a mapping target version changes after validation', async () => {
    const executionId = randomUUID();
    const sourceReference = `VERSION-${runId}`;
    const contents = csv(
      `${sourceReference},버전 변경 확인,,웹,할 일,관리자,기존 프로젝트,높음,버그`,
    );
    const currentMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
    });
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const validation = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: currentMapping },
    ).expect(200);
    expect(validation.body.canExecute).toBe(true);

    await database.client.team.update({
      data: { version: { increment: 1 } },
      where: { id: fixture.teamId },
    });
    const response = await multipart(
      app.getHttpServer(),
      'execute',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: currentMapping,
        validationSignature: validation.body.validationSignature as string,
      },
    ).expect(409);
    expect(response.body.code).toBe('IMPORT_REVALIDATION_REQUIRED');
    const run = await database.client.importRun.findUniqueOrThrow({
      where: { workspaceId_executionId: { executionId, workspaceId: fixture.workspaceId } },
    });
    expect(run.status).toBe('VALIDATION_FAILED');
    expect(
      await database.client.importSourceRow.count({
        where: { importRunId: run.id, workspaceId: fixture.workspaceId },
      }),
    ).toBe(0);

    const refreshed = await request(app.getHttpServer())
      .get('/api/v1/imports/csv/mapping-options')
      .set('Cookie', adminCookie)
      .expect(200);
    options = refreshed.body as MappingOptions;
  });

  it('serializes two runs with the same source key without creating a duplicate issue', async () => {
    const firstExecutionId = randomUUID();
    const secondExecutionId = randomUUID();
    const firstFile = csv('RACE-1,동시 실행 첫째,,웹,할 일,관리자,기존 프로젝트,높음,버그');
    const secondFile = csv('RACE-1,동시 실행 둘째,,웹,할 일,관리자,기존 프로젝트,높음,버그');
    const currentMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
    });
    const signatures: string[] = [];
    for (const [executionId, contents] of [
      [firstExecutionId, firstFile],
      [secondExecutionId, secondFile],
    ] as const) {
      await multipart(
        app.getHttpServer(),
        'inspect',
        adminCookie,
        adminCsrf,
        executionId,
        contents,
      ).expect(200);
      const validation = await multipart(
        app.getHttpServer(),
        'validate',
        adminCookie,
        adminCsrf,
        executionId,
        contents,
        { mapping: currentMapping },
      ).expect(200);
      expect(validation.body.canExecute).toBe(true);
      signatures.push(validation.body.validationSignature as string);
    }

    const responses = await Promise.all([
      multipart(
        app.getHttpServer(),
        'execute',
        adminCookie,
        adminCsrf,
        firstExecutionId,
        firstFile,
        {
          mapping: currentMapping,
          validationSignature: signatures[0]!,
        },
      ),
      multipart(
        app.getHttpServer(),
        'execute',
        adminCookie,
        adminCsrf,
        secondExecutionId,
        secondFile,
        {
          mapping: currentMapping,
          validationSignature: signatures[1]!,
        },
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const runs = await database.client.importRun.findMany({
      select: { excludedRowCount: true, issueCreatedCount: true, status: true },
      where: { executionId: { in: [firstExecutionId, secondExecutionId] } },
    });
    expect(runs.map(({ issueCreatedCount }) => issueCreatedCount).sort()).toEqual([0, 1]);
    expect(runs.map(({ excludedRowCount }) => excludedRowCount).sort()).toEqual([0, 1]);
    expect(runs.every(({ status }) => status === 'SUCCEEDED')).toBe(true);
    expect(
      await database.client.importSourceRow.count({
        where: { sourceReference: 'RACE-1', workspaceId: fixture.workspaceId },
      }),
    ).toBe(1);
  });

  it('rejects an archived mapping target', async () => {
    const archivedTeam = await database.client.team.create({
      data: {
        archivedAt: new Date(),
        key: 'OLD',
        name: '보관 팀',
        normalizedName: '보관 팀',
        workspaceId: fixture.workspaceId,
      },
    });
    const executionId = randomUUID();
    const contents = csv('OLD-1,보관 확인,,웹,할 일,관리자,기존 프로젝트,높음,버그');
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const response = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: mapping(options, {
          project: 'MAP',
          projectName: '기존 프로젝트',
          projectTargetId: fixture.projectId,
          teamTargetId: archivedTeam.id,
        }),
      },
    ).expect(200);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ code: 'IMPORT_TEAM_TARGET_INVALID' }),
    );
  });

  it('rolls back projects, issues, connections, and counters after a PostgreSQL failure', async () => {
    const executionId = randomUUID();
    const contents = csv('ROLL-1,롤백 이슈,,웹,할 일,관리자,롤백 프로젝트,높음,버그');
    await multipart(
      app.getHttpServer(),
      'inspect',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
    ).expect(200);
    const currentMapping = mapping(options, {
      project: 'CREATE',
      projectName: '롤백 프로젝트',
    });
    const validation = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: currentMapping },
    ).expect(200);
    expect(validation.body.canExecute).toBe(true);

    const workspaceBefore = await database.client.workspace.findUniqueOrThrow({
      select: { nextIssueNumber: true },
      where: { id: fixture.workspaceId },
    });
    const conflictingIssue = await database.client.issue.create({
      data: {
        createdByMembershipId: fixture.adminMembershipId,
        identifier: `F-${workspaceBefore.nextIssueNumber}`,
        projectId: fixture.projectId,
        sequenceNumber: 90_000,
        status: IssueStatus.TODO,
        title: '식별자 충돌용 이슈',
        workspaceId: fixture.workspaceId,
      },
    });
    const [projectCountBefore, issueCountBefore, labelCountBefore] = await Promise.all([
      database.client.project.count({ where: { workspaceId: fixture.workspaceId } }),
      database.client.issue.count({ where: { workspaceId: fixture.workspaceId } }),
      database.client.label.count({ where: { workspaceId: fixture.workspaceId } }),
    ]);

    const response = await multipart(
      app.getHttpServer(),
      'execute',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: currentMapping,
        validationSignature: validation.body.validationSignature as string,
      },
    ).expect(409);
    expect(response.body.code).toBe('IMPORT_DUPLICATE_CONFLICT');

    const run = await database.client.importRun.findUniqueOrThrow({
      where: { workspaceId_executionId: { executionId, workspaceId: fixture.workspaceId } },
    });
    const [projectCountAfter, issueCountAfter, labelCountAfter, sourceRows, workspaceAfter] =
      await Promise.all([
        database.client.project.count({ where: { workspaceId: fixture.workspaceId } }),
        database.client.issue.count({ where: { workspaceId: fixture.workspaceId } }),
        database.client.label.count({ where: { workspaceId: fixture.workspaceId } }),
        database.client.importSourceRow.count({ where: { importRunId: run.id } }),
        database.client.workspace.findUniqueOrThrow({
          select: { nextIssueNumber: true },
          where: { id: fixture.workspaceId },
        }),
      ]);
    expect(run.status).toBe('FAILED');
    expect({ projectCountAfter, issueCountAfter, labelCountAfter, sourceRows }).toEqual({
      issueCountAfter: issueCountBefore,
      labelCountAfter: labelCountBefore,
      projectCountAfter: projectCountBefore,
      sourceRows: 0,
    });
    expect(workspaceAfter.nextIssueNumber).toBe(workspaceBefore.nextIssueNumber);
    await database.client.issue.delete({ where: { id: conflictingIssue.id } });
  });

  it('atomically imports the documented maximum of 10,000 rows into PostgreSQL', async () => {
    const executionId = randomUUID();
    const sourcePrefix = `BULK-${runId}`;
    const contents = csv(
      ...Array.from(
        { length: 10_000 },
        (_, index) =>
          `${sourcePrefix}-${index + 1},대량 이슈 ${index + 1},,웹,할 일,,기존 프로젝트,,`,
      ),
    );
    const currentMapping = mapping(options, {
      project: 'MAP',
      projectName: '기존 프로젝트',
      projectTargetId: fixture.projectId,
    });
    await multipart(app.getHttpServer(), 'inspect', adminCookie, adminCsrf, executionId, contents)
      .expect(200)
      .expect(({ body }) => expect(body.rowCount).toBe(10_000));
    const validation = await multipart(
      app.getHttpServer(),
      'validate',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      { mapping: currentMapping },
    ).expect(200);
    expect(validation.body).toMatchObject({
      canExecute: true,
      summary: { excludedRowCount: 0, issueCreateCount: 10_000 },
    });

    const execution = await multipart(
      app.getHttpServer(),
      'execute',
      adminCookie,
      adminCsrf,
      executionId,
      contents,
      {
        mapping: currentMapping,
        validationSignature: validation.body.validationSignature as string,
      },
    ).expect(200);
    expect(execution.body).toMatchObject({ issueCreatedCount: 10_000, status: 'SUCCEEDED' });
    const run = await database.client.importRun.findUniqueOrThrow({
      select: { id: true },
      where: { workspaceId_executionId: { executionId, workspaceId: fixture.workspaceId } },
    });
    const [sourceRowCount, issueCount, teamWorkCount, eventCount] = await Promise.all([
      database.client.importSourceRow.count({ where: { importRunId: run.id } }),
      database.client.issue.count({
        where: { title: { startsWith: '대량 이슈 ' }, workspaceId: fixture.workspaceId },
      }),
      database.client.teamWork.count({
        where: { issue: { title: { startsWith: '대량 이슈 ' } }, workspaceId: fixture.workspaceId },
      }),
      database.client.activityEvent.count({
        where: {
          afterData: { path: ['importRunId'], equals: run.id },
          eventType: 'ISSUE_IMPORTED',
          workspaceId: fixture.workspaceId,
        },
      }),
    ]);
    expect({ eventCount, issueCount, sourceRowCount, teamWorkCount }).toEqual({
      eventCount: 10_000,
      issueCount: 10_000,
      sourceRowCount: 10_000,
      teamWorkCount: 10_000,
    });
  }, 240_000);
});
