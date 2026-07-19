import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { createPrismaClient } from '../../../packages/database/src';
import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

type Session = {
  membership: { id: string } | null;
  workspace: { id: string } | null;
};

test('A1 관리자가 CSV를 검증하고 원자적으로 가져오는 전체 흐름을 완료한다', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'CSV 설정 전체 흐름은 데스크톱 프로젝트에서 한 번 검증합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a1.csv.browser.${runId}@example.com`;
  const password = `A1 CSV 브라우저 검증 전용 비밀번호! ${runId}`;
  const projectName = `A1 CSV 프로젝트 ${runId}`;
  const issueTitle = `A1 CSV 이슈 ${runId}`;
  const sourceKey = `A1-${runId}`;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('A1 E2E DATABASE_URL이 필요합니다.');
  const database = createPrismaClient({
    connectionTimeoutMs: 5_000,
    databaseUrl,
    idleTimeoutMs: 10_000,
    poolMax: 2,
  });

  await clearM1RateLimits();
  try {
    await page.goto('/signup');
    await page.getByLabel('표시 이름').fill('A1 브라우저 관리자');
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible();

    const token = await getLatestM1Token(email, 'EMAIL_VERIFICATION');
    await page.goto(`/verify-email#token=${encodeURIComponent(token)}`);
    await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
    await page.getByRole('link', { name: '로그인' }).click();
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/workspace$/u);

    await page.getByRole('button', { name: '새 워크스페이스 만들기' }).click();
    await page.getByLabel('워크스페이스 이름').fill('A1 CSV 브라우저 워크스페이스');
    await page.getByLabel('슬러그').fill(`a1-csv-${runId}`);
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
    await page.getByLabel('팀 이름').fill('제품');
    await page.getByLabel('팀 키').fill('PROD');
    await page.getByRole('button', { name: '팀 만들기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await expect(page).toHaveURL(/\/my-issues$/u);

    const session = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      return (await response.json()) as Session;
    });
    if (!session.workspace || !session.membership) {
      throw new Error('A1 브라우저 워크스페이스와 관리자 멤버십을 준비하지 못했습니다.');
    }

    await page.goto('/settings/import');
    await expect(page.getByRole('heading', { name: 'CSV 가져오기' })).toBeVisible();
    await expect(
      page.getByText(
        '댓글, 과거 활동, 알림, 작업 전달 이력, 첨부파일과 외부 자동화 규칙은 가져오지 않습니다.',
      ),
    ).toBeVisible();

    await page.getByLabel('CSV 파일').setInputFiles({
      buffer: Buffer.from(
        [
          'source_key,title,team,status,assignee,project,priority,labels,description,comments',
          `${sourceKey},${issueTitle},제품,할 일,A1 브라우저 관리자,${projectName},높음,Alpha;CSV,"# CSV 본문\n\n실행 기록에는 복제하지 않습니다.",미지원 댓글`,
        ].join('\n'),
        'utf8',
      ),
      mimeType: 'text/csv',
      name: `a1-${runId}.csv`,
    });
    await page.getByRole('button', { name: '컬럼 확인' }).click();

    await expect(
      page.getByText('CSV 컬럼을 Rivet 필드에 연결하세요', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('지원하지 않는 데이터 컬럼이 있습니다')).toBeVisible();
    await expect(page.getByText(/comments 컬럼은 저장되지 않습니다/u)).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();

    await expect(
      page.getByText('CSV 값을 현재 워크스페이스에 맞추세요', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(projectName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '저장 전 검증' }).click();

    await expect(page.getByText('저장 전 검증 결과', { exact: true })).toBeVisible();
    await expect(page.getByText('모든 행을 원자적으로 저장할 준비가 됐습니다')).toBeVisible();
    await expect(page.getByText('생성할 이슈').locator('..').getByText('1')).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();

    await expect(page.getByText('가져오기를 실행할까요?', { exact: true })).toBeVisible();
    await expect(page.getByText('모두 저장되거나 아무것도 저장되지 않습니다')).toBeVisible();
    await page.getByRole('button', { name: '가져오기 실행' }).click();

    await expect(page.getByText('전체 가져오기 성공')).toBeVisible();
    await expect(page.getByRole('link', { name: projectName })).toBeVisible();
    const issueLink = page.getByRole('link', { name: /^F-\d+$/u });
    await expect(issueLink).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('a1-csv-import-result.png'),
      fullPage: true,
    });

    const run = await database.importRun.findFirstOrThrow({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { status: 'SUCCEEDED', workspaceId: session.workspace.id },
    });
    const source = await database.importSourceRow.findFirstOrThrow({
      include: {
        issue: {
          include: {
            comments: true,
            fileAttachments: true,
            handoffs: true,
            labels: { include: { label: true } },
            notifications: true,
            teamWorks: { include: { workflowState: true } },
          },
        },
        project: true,
      },
      where: { importRunId: run.id, workspaceId: session.workspace.id },
    });

    expect(run).toMatchObject({
      connectionCreatedCount: 4,
      errorCount: 0,
      excludedRowCount: 0,
      inputRowCount: 1,
      issueCreatedCount: 1,
      projectCreatedCount: 1,
    });
    expect(run.errorDetails).toBeNull();
    expect(JSON.stringify(run)).not.toContain(issueTitle);
    expect(JSON.stringify(run)).not.toContain('실행 기록에는 복제하지 않습니다.');
    expect(source.sourceReference).toBe(sourceKey);
    expect(source.project).toMatchObject({ name: projectName });
    expect(source.issue).toMatchObject({
      descriptionMarkdown: '# CSV 본문\n\n실행 기록에는 복제하지 않습니다.',
      priority: 'HIGH',
      title: issueTitle,
    });
    expect(source.issue.labels.map(({ label }) => label.name).sort()).toEqual(['Alpha', 'CSV']);
    expect(source.issue.teamWorks).toHaveLength(1);
    expect(source.issue.teamWorks[0]).toMatchObject({
      assigneeMembershipId: session.membership.id,
      workflowState: { name: '할 일' },
    });
    expect(source.issue.comments).toHaveLength(0);
    expect(source.issue.fileAttachments).toHaveLength(0);
    expect(source.issue.handoffs).toHaveLength(0);
    expect(source.issue.notifications).toHaveLength(0);
  } finally {
    await database.$disconnect();
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
