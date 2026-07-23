# 환경 구성

> 상태: 현행
> 적용 범위: 로컬 개발, 테스트와 단일 Linux 운영 서버
> 정본 책임: 환경 분리, 설정·비밀 주입과 실행 프로세스 공통 조건
> 갱신 조건: 환경 변수, 런타임, 포트, 저장소 또는 프로세스 구성 변경

환경 변수 이름과 예시는 [`.env.example`](../../.env.example), 실제 검증 규칙은 API·Worker·Web의
환경 검증 코드가 정본이다.

## 공통 원칙

- Node.js 24와 루트 `package.json`에 고정된 pnpm을 사용한다.
- Web, API와 Worker는 같은 커밋, lockfile, `RELEASE_ID`와 Prisma schema에서 빌드한다.
- 실제 비밀 값과 운영 `.env`를 Git 추적 파일, 릴리스 디렉터리와 PM2 설정에 저장하지 않는다.
- API와 Worker는 같은 `DATABASE_URL`과 절대 `FILE_STORAGE_ROOT`를 사용한다.
- 운영 `WEB_ORIGIN`은 경로나 끝 슬래시가 없는 HTTPS origin이다.
- 공개 origin과 내부 API origin을 구분하고 브라우저에 내부 주소를 노출하지 않는다.
- 비밀 값을 명령행 인자, 로그, 작업 보고와 shell history에 남기지 않는다.

## 환경별 사용

| 환경 | 구성 |
| --- | --- |
| 로컬 | `.env.example`을 참고해 Git 제외 `.env.local`에 개발 값을 둔다. |
| 테스트 | 루트 `.env.test.local`의 테스트 전용 `DATABASE_URL`과 격리 파일 경로를 사용한다. |
| 운영 | 권한이 제한된 저장소 밖 환경 파일이나 비밀 관리 시스템에서 현재 셸로 주입한다. |

로컬 `.env.local`과 테스트 `.env.test.local`을 운영에 복사하지 않는다. 운영 값은 배포 셸에서
직접 로드하며 값 자체를 출력하지 않는다.

```sh
export RIVET_ENV_FILE=/secure/path/rivet-production.env
test -r "$RIVET_ENV_FILE"
set -a
. "$RIVET_ENV_FILE"
set +a
test "$NODE_ENV" = production
test -n "$RELEASE_ID"
test -n "$DATABASE_URL"
```

## 프로세스별 책임

### Web

- `API_INTERNAL_ORIGIN`
- `RELEASE_ID`
- `NODE_ENV`

### API

- 공개 `WEB_ORIGIN`
- PostgreSQL과 파일 저장소
- 세션·CSRF·rate limit용 서로 다른 HMAC 키
- Web Push 공개 키
- PostHog와 Slack 운영 관측 설정

### Worker

- API와 같은 PostgreSQL·파일 저장소·공개 origin
- 인증 이메일용 Resend 설정
- Web Push 공개·비공개 키와 subject
- API와 공유하는 해당 HMAC 키
- PostHog와 Slack 운영 관측 설정

정확한 필수 여부, 형식과 기본값은 다음 코드를 확인한다.

- [`apps/web/lib/environment.ts`](../../apps/web/lib/environment.ts)
- [`apps/api/src/config/api-environment.ts`](../../apps/api/src/config/api-environment.ts)
- [`apps/worker/src/config/worker-environment.ts`](../../apps/worker/src/config/worker-environment.ts)

## 비밀 값

- HMAC 키는 각각 최소 32바이트의 독립 값으로 생성하며 서로 재사용하지 않는다.
- VAPID private key, Resend API key, PostHog key와 Slack webhook은 공급자·환경별로 분리한다.
- 개발·테스트 이메일은 `RESEND_ALLOWED_RECIPIENTS`에 명시한 주소로만 보낸다.
- 운영에서는 `RESEND_ALLOWED_RECIPIENTS` 변수를 주입하지 않아 실제 수신자를 허용하고 검증된
  발신 도메인을 사용한다. 빈 문자열을 명시적으로 주입하지 않는다.
- 비밀 교체는 새 값 주입, 프로세스 재생성, smoke test, 옛 값 폐기 순서로 수행한다.

## 포트와 프록시

- 기본 Web 포트는 `3000`, API 포트는 `4000`이다.
- 포트를 바꾸면 `API_INTERNAL_ORIGIN`과 Nginx `proxy_pass`를 함께 갱신한다.
- Nginx는 `/api/v1/events`의 버퍼·캐시·압축을 끄고 일반 API와 다른 timeout을 사용한다.
- `FILE_STORAGE_ROOT`를 Nginx 정적 경로로 노출하지 않는다.

실제 예시는 [`deploy/nginx`](../../deploy/nginx/)와
[`ecosystem.config.cjs`](../../ecosystem.config.cjs)를 따른다.

## 시작 전 검사

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm db:validate
node --check ecosystem.config.cjs
```

애플리케이션은 필수 환경 변수가 없거나 형식이 잘못되면 시작 단계에서 실패해야 한다. 검증을
우회하는 기본값이나 운영 전용 예외를 추가하지 않는다.
