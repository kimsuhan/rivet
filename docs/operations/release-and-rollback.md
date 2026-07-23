# 릴리스와 되돌리기

> 상태: 현행
> 적용 범위: PM2와 Nginx를 사용하는 단일 Linux 서버
> 정본 책임: 서버 준비, 반복 배포, smoke test와 애플리케이션 롤백 절차
> 갱신 조건: 빌드, migration, 프로세스, 프록시 또는 배포 방식 변경

운영 서버 접속, DNS·TLS 변경, 비밀 발급과 실제 배포는 승인된 운영자가 수행한다.

## 준비 원칙

- PM2 명령은 항상 실제 운영 계정으로 실행하고 `sudo pm2`를 섞지 않는다.
- `/var/log/rivet`은 운영 계정만 쓰게 하고
  [`deploy/logrotate/rivet.example`](../../deploy/logrotate/rivet.example)을 서버 계정에 맞춘다.
- Nginx `http` 블록에는
  [`rivet-http-log.conf.example`](../../deploy/nginx/rivet-http-log.conf.example), HTTPS
  `server` 블록에는
  [`rivet-proxy.conf.example`](../../deploy/nginx/rivet-proxy.conf.example)을 반영한다.
- 직전 정상 릴리스 디렉터리와 최근 검증된 PostgreSQL·파일 백업을 유지한다.
- migration SQL의 잠금, 기존 행 처리와 직전 앱 호환성을 사람이 검토한다.

## 릴리스 게이트

대상 커밋을 별도 릴리스 디렉터리에 준비하고 실패를 무시하지 않는다.
운영 빌드에 필요한 환경은 [환경 구성](./environment.md)의 방식으로 같은 셸에 먼저 로드한다.
통합·E2E 테스트의 데이터베이스는 운영 `DATABASE_URL`이 아니라 루트 `.env.test.local`을
사용한다.

```sh
cd "$RELEASE_DIR"
git fetch
git checkout "$TARGET_COMMIT"

node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm api:contract:check
pnpm test:e2e:full
pnpm build
```

테스트 전용 PostgreSQL이 준비되지 않았다면 통합·E2E 실패를 무시하지 않고 릴리스를 중단한다.

```sh
test -f apps/api/dist/main.js
test -f apps/worker/dist/main.js
test -f apps/web/.next/BUILD_ID
node --check ecosystem.config.cjs
```

최근 백업과 디스크 여유, 운영 환경 파일, 대상 `RELEASE_ID`, 직전 정상 릴리스 경로를 확인한
뒤에만 배포한다.

## Nginx 변경

프록시 규칙이나 포트가 바뀐 배포에서만 설정을 갱신한다.

```sh
sudo nginx -t
sudo nginx -s reload
```

문법 검사가 실패하면 reload하지 않는다. Web upstream은 저장소 예시의
`X-Forwarded-Proto` 처리 이유를 유지한다.

## migration과 프로세스 반영

운영 환경을 같은 셸에 로드한 뒤 일반적인 호환 배포는 API, Worker, Web 순서로 진행한다.

```sh
cd "$RELEASE_DIR"
pnpm db:migrate:deploy

pm2 startOrRestart "$RELEASE_DIR/ecosystem.config.cjs" --only rivet-api --update-env
pm2 describe rivet-api
curl --fail --silent --show-error "$RIVET_ORIGIN/api/v1/health/ready"

pm2 startOrRestart "$RELEASE_DIR/ecosystem.config.cjs" --only rivet-worker --update-env
pm2 describe rivet-worker

pm2 startOrRestart "$RELEASE_DIR/ecosystem.config.cjs" --only rivet-web --update-env
pm2 describe rivet-web
curl --fail --silent --show-error --location "$RIVET_ORIGIN/" >/dev/null
```

환경 변수를 추가·변경·삭제했거나 판단이 불명확하면 `restart --update-env`로 이전 값을
병합하지 않는다. 해당 앱을 `pm2 delete`한 뒤 `ecosystem.config.cjs`에서 새로 시작한다.

비호환 Outbox `schemaVersion` 변경은 신·구 payload를 읽는 Worker를 먼저 배포하는 별도
호환 순서를 사용한다. 이 순서는 이벤트 계약 변경 문서와 배포 리허설에서 명시해야 한다.

## 배포 후 점검

```sh
curl --fail --silent --show-error "$RIVET_ORIGIN/api/v1/health/live"
curl --fail --silent --show-error "$RIVET_ORIGIN/api/v1/health/ready"
```

운영 데이터와 분리한 점검 계정·워크스페이스로 다음을 확인한다.

1. 로그인·로그아웃과 현재 워크스페이스
2. 비파괴 이슈 생성·수정 또는 합의한 점검 동작
3. 알림, 읽지 않은 수와 SSE 재연결
4. 작은 파일 업로드·조회·연결 해제
5. Worker polling·정기 작업과 반복 오류 부재
6. Nginx와 앱 로그의 동일한 `RELEASE_ID`

Outbox 적체를 확인한다.

```sh
psql -X -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) AS pending, min(created_at) AS oldest_pending FROM outbox_events WHERE processed_at IS NULL AND canceled_at IS NULL;"
psql -X -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) AS failed FROM outbox_events WHERE processed_at IS NULL AND canceled_at IS NULL AND attempt_count >= 7;"
```

readiness 실패, 반복 재시작, 지속 5xx, 증가하는 Outbox 지연, 격리·파일 오류나 민감 로그가
있으면 성공으로 기록하지 않는다. 모두 통과한 뒤에만 `pm2 save`를 실행한다.

## 되돌리기 판단

다음 조건을 모두 만족할 때만 직전 애플리케이션으로 되돌린다.

- 적용 migration이 추가형이고 직전 앱이 새 schema를 읽을 수 있다.
- 새 API가 기록한 데이터와 Outbox payload를 직전 Worker가 처리할 수 있다.
- 파일 형식과 저장 경로가 바뀌지 않았다.

하나라도 만족하지 않으면 일반 롤백을 중단하고 전진 수정 또는 격리된 백업 복원을 선택한다.
데이터베이스 schema를 임의로 내리지 않는다.

## 애플리케이션 되돌리기

새 쓰기와 Worker claim을 중단한 뒤 직전 릴리스를 API, Worker, Web 순서로 시작한다.

```sh
pm2 stop rivet-web
pm2 stop rivet-api
pm2 stop rivet-worker

export RELEASE_ID="$PREVIOUS_RELEASE_ID"
test -n "$RELEASE_ID"

pm2 startOrRestart "$PREVIOUS_RELEASE_DIR/ecosystem.config.cjs" --only rivet-api --update-env
curl --fail --silent --show-error "$RIVET_ORIGIN/api/v1/health/ready"
pm2 startOrRestart "$PREVIOUS_RELEASE_DIR/ecosystem.config.cjs" --only rivet-worker --update-env
pm2 startOrRestart "$PREVIOUS_RELEASE_DIR/ecosystem.config.cjs" --only rivet-web --update-env
```

배포 후 점검과 Outbox 집계를 다시 수행하고 성공한 경우에만 쓰기를 열고 `pm2 save`를
갱신한다.

## 릴리스 기록

- 대상 커밋, `RELEASE_ID`, 시작·종료 시각과 실행자
- 실행한 검증과 migration 목록
- 백업 식별자와 복원 검증 상태
- PM2·Nginx·health·smoke 결과
- 되돌리기 조건과 실제 판단
- 남은 사용자 영향과 후속 작업
