# API 개발 지침

> 상태: 확정 v1.0  
> 적용 범위: `apps/api`

API 코드를 구현·리뷰·리팩터링할 때 [공통 개발 지침](./common.md)과 함께 읽는다. Prisma 쿼리, 스키마 또는 트랜잭션을 변경하면 [데이터베이스 개발 지침](./database.md)도 읽는다.

## 1. 기능 모듈 구조

API HTTP 서버는 `@nestjs/platform-express`를 사용한다. 파일 업로드는 NestJS의 Multer 기반 interceptor와 pipe를 사용하고 Fastify 전용 플러그인 경로를 함께 유지하지 않는다.

NestJS는 공식 [feature module](https://docs.nestjs.com/modules) 관례에 따라 기술 계층 전체가 아니라 기능 단위로 구성한다.

```text
apps/api/src/
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── logging/
│   └── validation/
├── modules/
│   ├── auth/
│   ├── workspaces/
│   ├── teams/
│   ├── projects/
│   ├── issues/
│   ├── collaboration/
│   ├── files/
│   ├── notifications/
│   ├── search/
│   ├── exports/
│   └── health/
├── app.module.ts
└── main.ts
```

기능 모듈 내부는 필요한 파일만 만든다.

```text
modules/issues/
├── dto/
│   ├── create-issue.dto.ts
│   └── update-issue.dto.ts
├── domain/
│   └── issue-transition.ts
├── issues.controller.ts
├── issues.module.ts
├── issues.service.ts
└── issues.repository.ts   # 복잡하거나 재사용되는 Prisma 쿼리가 있을 때만
```

- `common`에는 요청 컨텍스트, 공통 guard·filter·logging처럼 실제 횡단 관심사만 둔다.
- 제품 규칙, 도메인 enum과 기능별 helper를 `common`으로 올리지 않는다.
- 기능 모듈은 내부 provider를 기본 비공개로 두고 다른 모듈에 필요한 application service만 export한다.
- 다른 모듈의 repository나 DTO를 직접 사용하지 않는다.
- 모듈 간 순환이 생기면 `forwardRef`로 고정하지 않고 한쪽 책임을 옮기거나 작은 공개 서비스로 경계를 정리한다.
- controller의 파일·쿠키·스트리밍 경계 외에는 Express Request·Response 타입을 서비스와 도메인 계층으로 전달하지 않는다.

## 2. 계층별 책임

| 계층 | 책임 | 하지 않는 일 |
| --- | --- | --- |
| Controller | 경로, 요청 DTO, 인증 컨텍스트 전달과 응답 상태 | 제품 규칙, Prisma 쿼리, 트랜잭션 |
| Service | 사용 사례 조정, 권한 이후 제품 규칙, 트랜잭션과 Outbox | HTTP 응답 모양에 맞춘 DB 모델 노출 |
| Domain function | 순수 검증·계산·상태 전이 | NestJS, Prisma, 네트워크 접근 |
| Repository | 복잡·재사용 쿼리와 명확한 데이터 접근 경계 | 제품 흐름 조정, 외부 API 호출 |
| Guard·Pipe | 인증·권한·입력 경계 | 데이터 변경과 긴 비즈니스 흐름 |
| Filter·Interceptor | 공통 오류·응답·추적·로그 처리 | 기능별 제품 규칙 |

- 단순 Prisma CRUD 한두 줄을 감싸는 repository와 interface를 만들지 않는다.
- Repository는 기능 모듈의 필수 계층이 아니며 필요 조건이 없는 모듈에는 파일 자체를 만들지 않는다.
- 같은 워크스페이스 조건이 반복되거나 쿼리가 복잡·재사용될 때만 구체적인 repository를 만든다.
- 제네릭 CRUD repository, service locator와 하나의 구현체만 있는 DI interface를 만들지 않는다.
- provider는 constructor injection을 사용하고 의존성을 숨겨 조회하지 않는다.

## 3. 요청과 DTO

- 요청 DTO는 class-validator와 class-transformer를 사용하고 NestJS 전역 ValidationPipe에서 검증한다.
- 모든 외부 입력은 DTO, 명시적 pipe 또는 payload validator를 통과한다.
- 전역 [ValidationPipe](https://docs.nestjs.com/techniques/validation)는 알 수 없는 필드를 거부하고 변환은 명시적으로 허용한 값에만 적용한다.
- DTO와 검증 규칙은 `@nestjs/swagger`의 OpenAPI 계약과 일치시킨다.
- 프론트 Zod 폼 스키마를 백엔드로 공유하거나 백엔드 DTO 대신 사용하지 않는다.
- 경로 UUID, 배열 길이, 문자열 길이, 날짜와 enum을 API 경계에서 검증한다.
- DTO는 Prisma 입력 타입을 상속하거나 그대로 export하지 않는다.
- 요청에서 생략과 `null`의 의미를 DTO에서 구분한다.
- 현재 워크스페이스는 요청 body의 `workspaceId`가 아니라 인증된 활성 멤버십에서 구한다.
- 프론트가 보낸 역할·소유권·계산값을 신뢰하지 않고 서버에서 다시 계산한다.

## 4. 응답

- API 필드는 영문 `camelCase`, 시각은 UTC ISO 8601, 날짜는 `YYYY-MM-DD`를 사용한다.
- 단일 리소스는 불필요한 공통 wrapper 없이 객체를 반환한다.
- 목록은 `{ items, nextCursor }` 형식을 사용한다.
- 응답 DTO는 Prisma model과 별도이며 화면에 필요 없는 내부 필드를 노출하지 않는다.
- Prisma 결과의 필드 제거·이름 변경·계산이 필요하면 기능 모듈 안에 `*-response.mapper.ts` 순수 함수를 두고 공개 필드를 명시적으로 구성한다.
- Mapper 반환 객체는 명시적인 반환 타입이나 `satisfies`로 응답 DTO와 일치하는지 검사한다.
- 조회 `select` 결과가 응답 계약과 이미 같다면 값만 옮기는 Mapper를 만들지 않는다.
- 응답 Mapper에서 데이터베이스 조회, 권한 검사와 의존성 주입을 수행하지 않는다.
- 응답 계약을 위해 ClassSerializerInterceptor, 범용 Mapper 기반 클래스와 자동 매핑 라이브러리를 사용하지 않는다.
- API enum은 안정적인 영문 대문자 코드로 보내고 한국어 표시는 웹에서 매핑한다.
- 선택값 해제가 가능한 경우에만 `null`을 사용하고 생략과 구분한다.

## 5. 오류

- 외부 오류는 안정적인 `code`, 안전한 `message`, 필요할 때 `fieldErrors`, `requestId`와 충돌 정보를 사용한다.
- 사용자에게 보여 줄 한국어 문구를 서버 예외 메시지 문자열에 의존하지 않는다. 웹은 오류 코드로 문구와 행동을 결정한다.
- 다른 워크스페이스, 접근 불가와 존재하지 않는 리소스는 존재 여부를 구분하지 않는 계약을 지킨다.
- 알려진 제품 규칙 오류는 작은 공통 domain error 형식과 안정적인 code로 표현한다.
- 오류 종류마다 비어 있는 class를 하나씩 만들지 않는다. 다른 처리나 metadata가 필요할 때만 별도 class를 만든다.
- Prisma·Resend·파일시스템의 원본 오류와 stack을 응답에 노출하지 않는다.
- 예상하지 못한 오류는 전역 filter 한 곳에서 정제하고 한 번만 기록한다.

## 6. OpenAPI

- NestJS 요청·응답 DTO를 기준으로 OpenAPI를 생성한다.
- 엔드포인트에는 성공 응답과 주요 오류 응답 예시를 포함한다.
- nullable, optional, enum과 판별 가능한 union을 실제 동작과 같게 표현한다.
- 생성 클라이언트와 계약 파일은 [공통 개발 지침](./common.md)의 API 클라이언트 규칙을 따른다.

## 7. 인증, 권한과 입력 보안

- 인증과 활성 membership context를 controller 진입 전에 guard로 확정한다.
- Admin 여부, 리소스 소유권과 팀 membership은 서버에서 검증한다.
- 프론트에서 버튼을 숨기는 동작은 보안 검증으로 간주하지 않는다.
- 생성·변경에 포함된 모든 참조 ID가 현재 workspace에 속하는지 확인한다.
- Markdown은 저장 전 구조를 검증하고 렌더링할 때 허용 목록으로 정제한다.
- 파일 경로에 원본 파일명을 사용하지 않고 UUID storage key만 사용한다.
- 확장자와 브라우저 MIME을 신뢰하지 않고 서버에서 실제 형식과 크기를 검증한다.
- SQL, URL, HTML과 로그 문자열을 직접 이어 붙이지 않는다.
- 인증·세션·일회용 토큰은 원문을 데이터베이스와 로그에 저장하지 않는다.
- CSRF, Origin, 속도 제한과 보안 헤더를 우회하는 개발용 분기를 운영 build에 남기지 않는다.

## 8. 환경 설정과 로그

- `@nestjs/config`의 custom `validate()`에서 class-validator와 class-transformer로 환경 변수를 시작 시 한 번 검증한다.
- API가 사용하는 환경 변수 클래스와 typed config만 소유하고 워커 설정을 합친 공통 환경 클래스를 만들지 않는다.
- 환경 변수 검증만을 위해 Joi나 별도 검증 라이브러리를 추가하지 않는다.
- API 요청은 `requestId`로 추적한다.
- pino-http의 요청 컨텍스트에 `requestId`를 연결하고 서비스 로그에서도 같은 값을 사용한다.
