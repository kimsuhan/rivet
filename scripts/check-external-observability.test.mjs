import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('EXTERNAL_NETWORK_BLOCKED_IN_TEST');
};

const { runExternalObservabilitySmoke } = await import('./check-external-observability.mjs');

after(() => {
  globalThis.fetch = originalFetch;
});

const environment = {
  POSTHOG_API_KEY: 'phc_external_smoke_test',
  RELEASE_ID: 'external-smoke-test',
  RIVET_EXTERNAL_SMOKE_CONFIRM: '',
  RIVET_EXTERNAL_SMOKE_TARGET: 'test',
  SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test/team/webhook',
};

test('dry-run은 외부 호출 없이 점검 범위와 대상을 출력한다', async () => {
  const output = [];
  let fetchCount = 0;
  const status = await runExternalObservabilitySmoke({
    args: ['--dry-run'],
    environment,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('FETCH_MUST_NOT_RUN');
    },
    log: (message) => output.push(message),
  });

  assert.equal(status, 0);
  assert.equal(fetchCount, 0);
  const result = JSON.parse(output[0]);
  assert.deepEqual(
    {
      mode: result.mode,
      posthogEvents: result.posthogEvents,
      slackSeverities: result.slackSeverities,
      target: result.target,
    },
    {
      mode: 'dry-run',
      posthogEvents: ['search_performed', '$exception'],
      slackSeverities: ['긴급', '높음'],
      target: 'test',
    },
  );
  assert.match(result.smokeId, /^[a-f0-9]{32}$/);
});

test('대상과 일치하는 확인 값이 없으면 전송 전에 중단한다', async () => {
  const errors = [];
  let fetchCount = 0;
  const status = await runExternalObservabilitySmoke({
    args: [],
    environment,
    error: (message) => errors.push(message),
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('FETCH_MUST_NOT_RUN');
    },
  });

  assert.equal(status, 2);
  assert.equal(fetchCount, 0);
  assert.match(errors.join('\n'), /RIVET_EXTERNAL_SMOKE_CONFIRM=SEND:test/);
  assert.doesNotMatch(errors.join('\n'), /phc_external_smoke_test|webhook/);
});

test('확인된 전송은 공식 예외 계약을 포함한 네 요청만 보낸다', async () => {
  const requests = [];
  const output = [];
  const status = await runExternalObservabilitySmoke({
    args: [],
    environment: { ...environment, RIVET_EXTERNAL_SMOKE_CONFIRM: 'SEND:test' },
    fetchImpl: async (url, init) => {
      requests.push({ body: JSON.parse(init.body), url });
      return { ok: true, status: 200 };
    },
    log: (message) => output.push(message),
  });

  assert.equal(status, 0);
  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      'https://us.i.posthog.com/capture/',
      'https://us.i.posthog.com/capture/',
      'https://hooks.slack.com/services/test/team/webhook',
      'https://hooks.slack.com/services/test/team/webhook',
    ],
  );
  assert.deepEqual(requests[1].body.properties.$exception_list, [
    {
      mechanism: { handled: true, synthetic: true, type: 'generic' },
      type: 'ObservabilitySmokeTest',
      value: 'ObservabilitySmokeTest',
    },
  ]);
  assert.equal(requests[0].body.event, 'search_performed');
  assert.equal(requests[0].body.properties.payloadVersion, 1);
  assert.equal(requests[0].body.properties.distinct_id, requests[0].body.properties.membershipId);
  assert.equal(requests[0].body.uuid, requests[0].body.properties.eventId);
  assert.match(requests[0].body.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(requests[0].body.timestamp).toISOString(), requests[0].body.timestamp);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /body|email|token|fileName|endpoint/);
  assert.equal(requests[1].body.properties.$exception_level, 'error');
  assert.deepEqual(
    requests.slice(2).map((request) => request.body.text.split('\n')[0]),
    [
      '[Rivet][production][긴급] 외부 관측 수신 시험',
      '[Rivet][production][높음] 외부 관측 수신 시험',
    ],
  );
  assert.doesNotMatch(output.join('\n'), /phc_external_smoke_test|webhook/);
});
