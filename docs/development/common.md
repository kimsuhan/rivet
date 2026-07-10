# 공통 개발 지침

> 상태: 확정 v1.0  
> 적용 범위: Rivet 모노레포의 모든 코드

이 문서는 모든 코드 구현·리뷰·리팩터링에 적용한다. 작업할 앱이나 패키지에 해당하는 문서는 [개발 지침 색인](./index.md)에서 추가로 찾는다.

## 1. 기본 원칙

- Feature-first를 기본으로 삼아 웹은 `features/<feature>`, API·워커는 `modules/<feature>`에 관련 코드를 모으고 기술 계층만으로 앱 전체를 나누지 않는다.
- 제품 규칙은 서버가 최종 강제하고 프론트 검증은 사용자 피드백을 위한 보조 수단으로 둔다.
- API, 워커와 웹은 서로의 앱 내부 코드를 import하지 않는다.
- 외부 계약, 데이터베이스 모델과 화면 모델을 같은 타입으로 재사용하지 않는다.
- 같은 값을 여러 형태로 저장하지 않고 계산할 수 있는 값은 계산한다.
- 추상화는 두 번째 실제 사용처나 명확한 테스트·보안 경계가 생겼을 때 추가한다.
- 프레임워크 기본 기능과 이미 설치된 의존성을 먼저 사용한다.
- 작은 기능을 위해 새 패키지, 새 계층과 범용 기반 클래스를 만들지 않는다.
- 정상 흐름뿐 아니라 실패, 권한, 재시도와 복구 경로를 함께 구현한다.

## 2. 모노레포 구조

기본 구조는 다음과 같다. 폴더는 실제 파일이 생길 때 만들고 빈 구조를 미리 생성하지 않는다.

```text
.
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   ├── public/
│   │   └── e2e/
│   ├── api/
│   │   ├── src/
│   │   │   ├── common/
│   │   │   ├── modules/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/
│   └── worker/
│       ├── src/
│       │   ├── common/
│       │   ├── modules/
│       │   ├── app.module.ts
│       │   └── main.ts
│       └── test/
├── packages/
│   ├── database/
│   ├── api-client/
│   └── config/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── turbo.json
```

### 2.1 앱 책임

| 경로 | 책임 | 금지 |
| --- | --- | --- |
| `apps/web` | 화면, 사용자 상호작용, 서버 상태 캐시, 낙관적 UI와 SSE 반응 | Prisma 사용, API 내부 DTO import, 서버 권한 규칙 대체 |
| `apps/api` | REST·SSE, 인증·권한, 제품 규칙, 트랜잭션과 Outbox 발행 | 웹 컴포넌트 import, 장시간 비동기 작업 직접 수행 |
| `apps/worker` | Outbox 소비, 이메일·알림, 예약 삭제, 보존·파일 정리 | HTTP 제품 API 제공, `apps/api` 내부 코드 import |

### 2.2 패키지 책임

| 경로 | 책임 | 규칙 |
| --- | --- | --- |
| `packages/database` | Prisma 스키마, migration, 생성 클라이언트와 연결 진입점 | API 응답 DTO와 화면 타입을 두지 않음 |
| `packages/api-client` | OpenAPI에서 생성한 타입·호출 함수와 최소 런타임 설정 | 생성 영역을 사람이 직접 수정하지 않음 |
| `packages/config` | 공통 TypeScript·ESLint·Prettier 설정 | 런타임 제품 규칙과 환경별 비밀을 두지 않음 |

`packages/ui`, `packages/shared`, `packages/domain`, `packages/utils`는 기본으로 만들지 않는다. 두 앱 이상의 실제 소비자와 안정된 공개 경계가 확인될 때만 목적이 드러나는 이름으로 패키지를 추가한다.

Outbox 이벤트 계약도 초기 폴더만 미리 만들지 않는다. 최초 이벤트를 구현해 API 생산자와 워커 소비자의 실제 공유가 생기는 시점에 `packages/event-contracts`를 추가하고, `eventType`, `schemaVersion`과 payload 계약만 공개한다.

### 2.3 의존 방향

```text
apps/web ───────> packages/api-client, packages/config
apps/api ───────> packages/database, packages/config
apps/worker ────> packages/database, packages/config
packages/api-client ──> 생성 계약 외 앱 코드 의존 금지
packages/database ────> 앱 코드 의존 금지
```

- 앱 사이 상대 경로 import를 금지한다.
- 내부 패키지는 `workspace:*`로 의존성을 선언한다.
- 패키지는 사용하는 의존성을 자신의 `package.json`에 직접 선언하고 루트 hoisting에 기대지 않는다.
- 순환 의존을 발견하면 `forwardRef`, 동적 import나 재-export로 숨기지 말고 책임과 데이터 흐름을 다시 나눈다.

### 2.4 런타임과 컴파일러

- 로컬 개발, 테스트, 빌드와 PM2 운영은 Node.js 24 LTS를 사용한다.
- 루트 `package.json`의 `engines.node`는 `24.x`로 제한하고 저장소의 Node 버전 파일도 같은 major를 가리킨다.
- pnpm의 정확한 버전은 루트 `packageManager`에 고정하고 개발·운영에서 같은 lockfile과 버전을 사용한다.
- Node.js major를 올릴 때는 웹·API·워커 빌드, Prisma 생성·migration과 네이티브 의존성 호환성을 함께 검증한다.
- `apps/api`, `apps/worker`와 `packages/database`의 실행 결과는 CommonJS를 사용한다.
- 해당 workspace의 TypeScript `module`과 `moduleResolution`은 `NodeNext`로 맞추고 `package.json`의 `type`은 `commonjs`로 명시한다.
- 소스 코드는 `import`와 `export` 문법을 사용하고 `require`, `module.exports`를 직접 작성하지 않는다.
- Next.js 웹과 웹 전용 `packages/api-client`는 프레임워크의 ESM 번들 구성을 따르며 루트 `package.json`에서 전체 workspace의 모듈 형식을 강제하지 않는다.
- 같은 내부 패키지의 CommonJS·ESM 이중 빌드는 실제 외부 소비자가 생기기 전에는 만들지 않는다.
- `apps/api`와 `apps/worker`는 Nest CLI의 `tsc` builder로 컴파일한다.
- 백엔드 빌드에 SWC와 webpack을 함께 구성하지 않는다.
- 루트 `pnpm typecheck`는 모든 workspace에서 `tsc --noEmit` 또는 동등한 프레임워크 타입 검사를 실행한다.
- `apps/web`은 Next.js의 빌드 파이프라인을 사용하고 별도의 TypeScript 출력 파일을 만들지 않는다.
- 실제 컴파일 시간이 개발 흐름을 방해한다는 측정 결과가 생길 때만 SWC 전환을 검토한다.

## 3. 이름과 파일 규칙

### 3.1 언어

- 코드 식별자, 파일명, 폴더명, 데이터베이스 이름과 오류 코드는 영어로 작성한다.
- 사용자에게 보이는 메뉴, 안내, 검증·오류 메시지는 한국어를 기본으로 한다.
- 코드 주석과 개발 문서는 한국어를 기본으로 하되 라이브러리·프로토콜 고유 용어는 원문을 유지한다.
- 영문 코드를 한국어 발음대로 적은 식별자를 만들지 않는다.

### 3.2 식별자

| 대상 | 형식 | 예시 |
| --- | --- | --- |
| 변수·함수·메서드 | `camelCase` | `findIssueById`, `workspaceId` |
| 클래스·React 컴포넌트·타입 | `PascalCase` | `IssuesService`, `IssueDetail` |
| Boolean | `is`, `has`, `can`, `should` 접두어 | `isArchived`, `canRestore` |
| 도메인·오류·이벤트 코드 | `UPPER_SNAKE_CASE` | `RESOURCE_NOT_FOUND`, `ISSUE_CREATED` |
| 일반 폴더·파일 | `kebab-case` | `issue-detail.tsx`, `workspace-context.ts` |
| NestJS 파일 | `kebab-case.역할.ts` | `issues.controller.ts`, `create-issue.dto.ts` |
| Next.js 예약 파일 | 프레임워크 이름 | `page.tsx`, `layout.tsx`, `loading.tsx` |
| 테스트 | 대상 파일명 + 테스트 접미어 | `issues.service.spec.ts`, `issue-list.test.tsx` |
| PostgreSQL 테이블·컬럼 | 복수형 `snake_case` | `workspace_memberships`, `created_at` |

- 축약어도 일반 단어처럼 사용한다. `apiClient`, `url`, `id`를 사용하고 `APIClient`, `URLValue`, `IDValue`처럼 섞지 않는다.
- 컬렉션은 복수형, 단일 리소스는 단수형으로 이름 짓는다.
- `data`, `item`, `value`, `manager`, `helper`처럼 의미가 넓은 이름은 문맥이 한 줄 안에서 명확할 때만 사용한다.
- 사용자 ID와 멤버십 ID를 모두 `userId`로 뭉개지 않는다. `userId`, `membershipId`, `assigneeMembershipId`처럼 실제 식별 대상을 이름에 드러낸다.

### 3.3 상수와 타입 이름

- 상수는 가장 좁은 유효 범위에 둔다.
- 파일 전체에서 공유되는 도메인 코드·설정 키만 `UPPER_SNAKE_CASE` 상수로 둔다.
- 한 함수에서만 사용하는 임계값은 함수 안에 둔다.
- 단일 사용처의 primitive나 union을 감추는 타입 별칭을 만들지 않는다.
- 재사용되거나 도메인 의미가 생기는 타입만 이름을 부여한다.
- `IUserService`, `TUser`, `UserDtoType` 같은 접두·접미 관례를 사용하지 않는다.

## 4. 포맷과 TypeScript

### 4.1 자동 포맷

- Prettier를 유일한 코드 포맷터로 사용한다.
- 기본값은 들여쓰기 2칸, 작은따옴표, 세미콜론 사용, trailing comma 사용, 줄 길이 100자로 맞춘다.
- Tailwind 클래스 순서는 `prettier-plugin-tailwindcss`로 정렬하고 사람이 임의 순서를 리뷰 기준으로 만들지 않는다.
- ESLint는 Flat Config를 사용하고 정확성, import 경계, React hooks와 미사용 코드를 검사한다.
- `packages/config`는 base, Next.js와 NestJS용 ESLint 설정 및 공통 Prettier 설정만 공개한다.
- Prettier와 겹치는 스타일 규칙은 `eslint-config-prettier`로 끄고 Prettier를 ESLint rule로 실행하지 않는다.
- `pnpm lint`는 수정 없이 검사하고 자동 수정은 `pnpm lint:fix`, 포맷은 `pnpm format`, 검사는 `pnpm format:check`로 분리한다.
- Next.js build가 lint를 대신한다고 가정하지 않고 루트 검증 명령에서 ESLint를 별도로 실행한다.
- 생성 코드에는 별도 생성기 포맷을 허용하며 사람이 손으로 맞추지 않는다.

### 4.2 TypeScript 설정

공통 설정은 다음을 기본으로 한다.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true
  }
}
```

- `any`를 사용하지 않는다. 외부 입력은 `unknown`으로 받고 검증 후 좁힌다.
- `as` 단언과 non-null `!`는 런타임 검증이나 명확한 불변 조건을 코드로 보장한 뒤에만 사용한다.
- 외부로 노출되는 함수, 서비스 메서드와 패키지 export는 반환 타입을 명시한다.
- 짧은 로컬 함수와 React 컴포넌트의 반환 타입은 추론을 허용한다.
- 타입만 가져올 때는 `import type`을 사용하되 NestJS decorator metadata에 필요한 DTO·provider 클래스는 런타임 값 import를 유지한다.
- React props, union, intersection, 함수 시그니처와 일반 객체 타입은 `type`을 기본으로 사용한다.
- 외부에서 확장하도록 의도한 공개 객체 계약이나 클래스가 `implements`할 계약에만 `interface`를 사용한다.
- NestJS의 요청 DTO는 decorator와 런타임 검증을 위해 `class`로 선언한다.
- 한 곳에서만 쓰이고 도메인 의미를 추가하지 않는 primitive 또는 union은 별도 타입으로 감싸지 않는다.
- 애플리케이션 자체 enum은 무분별하게 추가하지 않는다. 닫힌 데이터베이스 값은 Prisma 생성 타입을 사용하고, 런타임 상수는 `as const`와 추론 타입을 우선한다.
- `null`은 명시적 비어 있음, `undefined`는 전달하지 않음으로 구분한다. API와 폼에서 두 의미를 섞지 않는다.

### 4.3 함수와 클래스

- 함수는 의미 있는 검증, 변환, 재사용, 복잡도 축소, 테스트 가능성 또는 부작용 격리를 위해서만 분리한다.
- 값만 전달하거나 필드를 그대로 옮기는 얇은 wrapper를 만들지 않는다.
- 한 메서드가 조회, 권한, 변경과 외부 호출을 모두 숨기지 않게 트랜잭션 경계를 드러낸다.
- 상속 기반 `BaseService`, `BaseController`, `BaseRepository`를 만들지 않는다.
- 조합과 작은 순수 함수를 우선하고 상속은 프레임워크가 요구할 때만 사용한다.
- catch 후 같은 오류를 그대로 다시 던지거나 모든 메서드에서 중복 로그를 남기지 않는다.

## 5. import와 모듈 공개 범위

- `eslint-plugin-simple-import-sort`로 import와 export 순서를 자동 정렬한다.
- import 그룹은 부수효과 import, Node.js 내장 모듈, 외부 패키지, `@rivet/*`, 웹 `@/*`, 상대 경로 순으로 두고 그룹 사이를 한 줄 띄운다.
- `@typescript-eslint/consistent-type-imports`로 안전한 타입 전용 import를 `import type` 형식으로 자동 수정한다.
- import 순서를 사람이 손으로 맞추거나 정렬을 피하기 위해 eslint disable 주석을 추가하지 않는다.
- 같은 기능 폴더 안에서는 짧은 상대 경로 import를 사용한다.
- 웹 앱은 루트 기준 import가 명확할 때 `@/` 별칭을 사용할 수 있다.
- API·워커는 빌드 설정을 늘리는 앱 전용 별칭을 기본으로 추가하지 않는다. 깊은 상대 경로가 반복되면 모듈 경계를 먼저 점검한다.
- 내부 패키지는 `@rivet/database`, `@rivet/api-client`, `@rivet/config`처럼 패키지 이름으로 import한다.
- 광범위한 `export *` barrel 파일을 만들지 않는다.
- `index.ts`는 패키지의 의도된 공개 API나 NestJS 모듈의 작은 공개 경계에서만 사용한다.
- 컴포넌트, hook, 함수, 타입과 상수는 named export를 기본으로 한다.
- Next.js가 default export를 요구하는 `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`와 도구가 요구하는 설정 파일에는 default export를 허용한다.
- 프레임워크 요구를 감추기 위해 default export를 다른 파일에서 named export로 다시 감싸지 않는다.
- 생성 코드는 생성기가 정한 export 형식을 따르고 사람이 직접 변경하지 않는다.
- 다른 기능 모듈의 `dto`, `repository`, 내부 컴포넌트 경로를 직접 import하지 않는다.
- NestJS 모듈은 외부에서 실제로 주입할 provider만 `exports`에 공개한다.
- 전역 NestJS 모듈은 설정, 데이터베이스와 구조화 로깅처럼 앱 전체에 하나만 존재해야 하는 기반으로 제한한다.

## 6. API 클라이언트와 생성 코드

- `packages/api-client`는 Orval과 Fetch 기반 TanStack Query 생성을 사용한다.
- Orval은 타입, 엔드포인트 호출 함수, Query·Mutation Hook과 Query Key를 생성한다.
- 인증 쿠키, CSRF와 공통 오류 처리는 생성 파일 밖의 Fetch mutator 한 곳에서 설정한다.
- 브라우저 코드에서 생성 클라이언트를 우회한 중복 타입과 호출 함수를 만들지 않는다.
- Prisma Client, OpenAPI 산출물과 `packages/api-client` 생성 영역을 직접 수정하지 않는다.
- 생성 결과를 바꾸려면 source schema, DTO 또는 generator 설정을 수정하고 다시 생성한다.
- 생성 코드와 수동 코드가 같은 파일에 섞이지 않게 런타임 wrapper를 별도 파일에 둔다.
- `packages/database/src/generated/prisma`는 `.gitignore`에 포함하고 타입 검사와 빌드가 실행되기 전에 `prisma generate`로 생성한다.
- OpenAPI JSON과 `packages/api-client`의 Orval 생성 결과는 Git에 포함해 백엔드·프론트 간 계약 변경을 함께 리뷰한다.
- `pnpm api:contract:check`는 OpenAPI와 Orval 결과를 다시 생성해 커밋된 결과와 차이가 있으면 실패한다.
- Prisma 생성 누락을 숨기기 위해 생성 결과를 임시 stub이나 수동 타입으로 대체하지 않는다.
- 호환되지 않는 필드 삭제·이름 변경·enum 제거는 프론트 전환 전에 바로 적용하지 않는다.

## 7. 설정, 비밀 값과 로그

- 기능 코드 곳곳에서 `process.env`를 직접 읽지 않는다.
- API, 워커와 웹은 자신이 사용하는 설정만 정의하고 주입받는다.
- 필수 설정 누락과 잘못된 운영 보안 설정은 시작 실패로 처리한다.
- 비밀 값은 저장소, 예시 파일의 실제 값, 빌드 로그와 테스트 fixture에 넣지 않는다.
- API와 워커의 구조화 로그는 Pino와 nestjs-pino를 사용해 표준 출력으로 기록한다.
- 로그는 구조화된 한 줄 객체를 사용하고 문자열 조합으로 자유 형식 본문을 만들지 않는다.
- 환경, 릴리스, 경로 template, 상태, 처리 시간과 내부 ID만 필요한 범위에서 기록한다.
- 비밀번호, 쿠키, 토큰, 이메일·IP 원문, 업무 본문, 원본 파일명과 요청·응답 전체를 기록하지 않는다.
- Pino redaction에 인증 헤더, 쿠키와 민감 요청 필드를 등록하되 애플리케이션 로그의 안전한 필드 선택을 대신하지 않는다.
- 애플리케이션이 로그 파일과 순환을 직접 관리하지 않고 PM2가 표준 출력을 수집·보존한다.
- 하위 계층에서 로그 후 throw하고 전역 계층에서 다시 로그하는 중복을 만들지 않는다.
- 예상 가능한 사용자 오류는 warning·error를 남발하지 않고 운영 조치가 필요한 실패만 경고한다.

## 8. 테스트와 완료 전 검증

### 8.1 도구와 위치

| 대상 | 도구 | 위치 |
| --- | --- | --- |
| API·워커 단위 | Jest + Nest Testing | 대상 코드 옆 `*.spec.ts` |
| API 통합 | Jest + Supertest | `apps/api/test/*.e2e-spec.ts` |
| 워커 통합 | Jest | `apps/worker/test/*.integration-spec.ts` |
| 웹 단위·컴포넌트 | Vitest + Testing Library | 대상 코드 옆 `*.test.ts(x)` |
| 전체 흐름 | Playwright | `apps/web/e2e/*.spec.ts` |
| Prisma | 실제 PostgreSQL 테스트 DB | `packages/database/test/*.integration-spec.ts` |

### 8.2 작성 원칙

- 규칙은 가장 낮은 유효 계층에서 충분히 검증하고 E2E에는 대표 흐름만 둔다.
- 테스트 이름은 사용자 또는 제품 관점의 조건과 결과를 설명한다.
- 구현 내부 호출 횟수보다 외부 동작, 저장 결과와 권한 경계를 검증한다.
- Prisma 제약, 트랜잭션과 잠금은 실제 PostgreSQL로 검증한다.
- Resend, PostHog와 시간은 외부 경계에서 대체하고 제품 규칙 자체를 과도하게 mock하지 않는다.
- 권한 테스트는 허용 사례와 다른 workspace·역할의 거부 사례를 함께 둔다.
- 버그 수정에는 같은 문제가 다시 발생하면 실패하는 가장 작은 회귀 테스트를 추가한다.
- snapshot은 큰 DOM이나 API 전체 응답을 대신하지 않는다. 작고 안정적인 직렬화 결과에만 사용한다.
- 테스트를 통과시키기 위한 production 분기와 임의 sleep을 만들지 않는다.
- fixture builder는 같은 준비 코드가 반복돼 의미가 분명해질 때만 추가한다.

### 8.3 커버리지

- `pnpm test:coverage`로 패키지별 line·branch·function 커버리지 리포트를 생성하되 MVP 초기에는 저장소 전체 퍼센트 threshold를 출시 게이트로 강제하지 않는다.
- 인증·권한, 워크스페이스 격리, 트랜잭션, Outbox 재시도·멱등성과 파일 접근 경계는 전체 퍼센트와 무관하게 필수 시나리오를 검증한다.
- 버그 수정에는 같은 결함을 재현하는 회귀 테스트를 추가한다.
- 단순 설정·DTO 테스트로 수치를 채우거나 커버리지 제외 설정으로 제품 규칙을 숨기지 않는다.
- 코드 기반과 패키지별 기준선이 안정된 뒤 실제 리스크와 측정값을 근거로 개별 threshold 도입을 검토한다.

### 8.4 완료 전 명령

변경 범위에 맞게 다음 명령을 실행한다.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm api:contract:check
pnpm build
```

사용자 흐름이나 브라우저 상호작용이 바뀌면 `pnpm test:e2e`를 추가한다. 문서·주석만 바꾼 경우 코드 테스트를 억지로 실행하지 않는다.

## 9. 주석과 문서화

- 코드가 무엇을 하는지 그대로 읽어 주는 주석은 쓰지 않는다.
- 트랜잭션 이유, 보안 경계, 보상 처리와 외부 계약처럼 코드만으로 알기 어려운 이유를 기록한다.
- 임시 우회에는 제거 조건을 적는다. 기한이나 조건 없는 `TODO`, `FIXME`를 남기지 않는다.
- 다른 문서를 복사해 긴 주석으로 만들지 않고 필요한 경우 안정적인 문서 링크를 남긴다.
- 공개 함수마다 형식적인 JSDoc을 붙이지 않는다. 호출자가 오해하기 쉬운 계약이나 부작용이 있을 때만 작성한다.

## 10. 의존성과 공통 코드

### 10.1 새 의존성

새 패키지를 추가하기 전에 다음 순서로 확인한다.

1. 기능 자체가 MVP에 필요한가.
2. 표준 라이브러리나 프레임워크 기능으로 해결되는가.
3. 이미 설치된 패키지가 해결하는가.
4. 직접 구현이 짧고 안전한가.
5. 새 의존성의 유지보수, 번들, 보안과 라이선스 비용이 타당한가.

- 앱 한 곳에서만 쓰는 의존성은 해당 앱에 설치한다.
- 여러 workspace가 직접 import할 때만 루트 또는 공통 패키지 배치를 검토한다.
- 내부 패키지와 외부 패키지 버전은 루트 lockfile 하나로 고정한다.
- 비슷한 역할의 상태, 날짜, 검증, HTTP와 유틸 라이브러리를 중복 도입하지 않는다.
- 의존성 추가 PR에는 사용 위치와 기존 수단으로 부족한 이유가 드러나야 한다.

### 10.2 공통 코드 승격

- 한 파일·한 기능에서만 쓰는 코드는 가장 가까운 위치에 둔다.
- 두 사용처가 문법만 비슷하고 변경 이유가 다르면 합치지 않는다.
- 실제 두 곳 이상에서 같은 규칙과 변경 이유를 공유할 때만 공통 위치로 올린다.
- 공통화할 때 공개 API를 최소화하고 내부 구현을 export하지 않는다.
- 범용 `utils`, `helpers`, `types`, `constants` 파일로 밀어 넣지 않고 책임을 드러내는 이름을 사용한다.
- interface, adapter와 injection token은 외부 경계 대체나 둘 이상의 구현이 있을 때 사용한다.

## 11. 금지하는 구조와 구현

- 앱 간 상대 경로 import
- 제품 규칙이 들어간 `common`, `shared`, `utils` 덤프 폴더
- 사용처 없는 `packages/ui`, `packages/domain`과 미래용 패키지
- 제네릭 CRUD repository와 상속 기반 base controller·service
- 한 구현체만 감싸는 interface·factory·adapter
- Prisma model을 API 응답이나 화면 타입으로 직접 노출
- controller, React page와 worker poller에 긴 제품 규칙 작성
- 권한 없는 ID 조회 후 나중에 workspace를 비교하는 패턴
- 업무 트랜잭션 안의 이메일·분석·긴 파일 작업
- 수동 작성한 API 타입과 엔드포인트 문자열의 중복
- 근거 없는 `any`, `as`, non-null assertion과 eslint disable
- 오류를 숨기는 빈 catch와 실패를 성공으로 바꾸는 fallback
- 측정 전 캐시, Redis, 메시지 브로커, 범용 event bus와 microservice 경계
- 사용하지 않는 빈 폴더, placeholder 파일과 미래용 boilerplate

## 12. 기능 구현 체크리스트

- 코드가 올바른 앱과 기능 폴더에 위치하는가.
- 다른 앱 내부 코드나 생성 코드에 역방향 의존하지 않는가.
- 입력 DTO, 권한과 workspace 경계를 서버에서 검증하는가.
- 데이터베이스 제약과 트랜잭션 경계가 제품 불변 조건을 보호하는가.
- API DTO, OpenAPI와 생성 클라이언트가 일치하는가.
- 로딩, 빈 상태, 실패, 충돌과 접근성 상태를 처리하는가.
- 로그와 분석에 민감한 사용자·업무 내용이 들어가지 않는가.
- 성공과 실패·권한·재시도 경로를 적절한 계층에서 테스트했는가.
- 새 추상화와 의존성이 실제 필요보다 크지 않은가.
- 관련 lint, typecheck, test와 build를 실행했는가.
