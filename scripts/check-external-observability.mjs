import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';

export async function runExternalObservabilitySmoke({
  args = process.argv.slice(2),
  environment = process.env,
  error = console.error,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  const normalizedArgs = args.filter((argument) => argument !== '--');
  const dryRun = normalizedArgs.length === 1 && normalizedArgs[0] === '--dry-run';

  if (normalizedArgs.length > 1 || (normalizedArgs.length === 1 && !dryRun)) {
    error('사용법: node scripts/check-external-observability.mjs [--dry-run]');
    return 2;
  }

  const posthogApiKey = environment.POSTHOG_API_KEY?.trim() ?? '';
  const releaseId = environment.RELEASE_ID?.trim() ?? '';
  const slackWebhook = environment.SLACK_ALERT_WEBHOOK_URL?.trim() ?? '';
  const target = environment.RIVET_EXTERNAL_SMOKE_TARGET?.trim() ?? '';
  const invalidKeys = [];

  if (!/^phc_[A-Za-z0-9_-]{8,}$/.test(posthogApiKey)) invalidKeys.push('POSTHOG_API_KEY');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(releaseId)) invalidKeys.push('RELEASE_ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(target)) {
    invalidKeys.push('RIVET_EXTERNAL_SMOKE_TARGET');
  }

  try {
    const url = new URL(slackWebhook);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'hooks.slack.com' ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      invalidKeys.push('SLACK_ALERT_WEBHOOK_URL');
    }
  } catch {
    invalidKeys.push('SLACK_ALERT_WEBHOOK_URL');
  }

  if (invalidKeys.length > 0) {
    error(`외부 관측 환경 변수 검증 실패: ${invalidKeys.sort().join(', ')}`);
    return 2;
  }

  if (!dryRun && environment.RIVET_EXTERNAL_SMOKE_CONFIRM !== `SEND:${target}`) {
    error(`실제 전송에는 RIVET_EXTERNAL_SMOKE_CONFIRM=SEND:${target} 확인 값이 필요합니다.`);
    return 2;
  }

  const smokeId = randomUUID().replaceAll('-', '');
  const timestamp = new Date().toISOString();
  const workspaceId = randomUUID();
  const requestId = `req_external_smoke_${smokeId}`;
  const operations = [
    {
      body: {
        api_key: posthogApiKey,
        event: 'search_performed',
        properties: {
          distinct_id: `rivet_external_smoke_${smokeId}`,
          environment: 'production',
          releaseId,
          resultCount: 0,
          searchType: 'TITLE',
          workspaceId,
        },
      },
      name: 'posthog.product',
      url: POSTHOG_CAPTURE_URL,
    },
    {
      body: {
        api_key: posthogApiKey,
        event: '$exception',
        properties: {
          $exception_level: 'error',
          $exception_list: [
            {
              mechanism: { handled: true, synthetic: true, type: 'generic' },
              type: 'ObservabilitySmokeTest',
              value: 'ObservabilitySmokeTest',
            },
          ],
          distinct_id: requestId,
          environment: 'production',
          errorName: 'ObservabilitySmokeTest',
          releaseId,
          requestId,
          sanitizedStack: null,
        },
      },
      name: 'posthog.exception',
      url: POSTHOG_CAPTURE_URL,
    },
    ...['긴급', '높음'].map((severity) => ({
      body: {
        text: [
          `[Rivet][production][${severity}] 외부 관측 수신 시험`,
          `발생시각=${timestamp}`,
          `releaseId=${releaseId}`,
          'errorCode=OBSERVABILITY_SMOKE_TEST',
          `jobId=${smokeId}`,
          `smokeId=${smokeId}`,
          '확인절차=이 메시지의 smokeId를 배포 기록과 대조하세요.',
        ].join('\n'),
      },
      name: `slack.${severity === '긴급' ? 'critical' : 'high'}`,
      url: slackWebhook,
    })),
  ];

  if (dryRun) {
    log(
      JSON.stringify({
        mode: 'dry-run',
        posthogEvents: ['search_performed', '$exception'],
        slackSeverities: ['긴급', '높음'],
        smokeId,
        target,
      }),
    );
    return 0;
  }

  const results = await Promise.all(
    operations.map(async (operation) => {
      try {
        const response = await fetchImpl(operation.url, {
          body: JSON.stringify(operation.body),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
        });
        return { name: operation.name, ok: response.ok, status: response.status };
      } catch {
        return { name: operation.name, ok: false, status: null };
      }
    }),
  );

  log(JSON.stringify({ mode: 'send', results, smokeId, target }));
  return results.some((result) => !result.ok) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runExternalObservabilitySmoke();
}
