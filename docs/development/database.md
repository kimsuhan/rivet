# 데이터베이스 개발 지침

> 상태: 확정 v1.0  
> 적용 범위: `packages/database`, Prisma 쿼리와 트랜잭션

데이터베이스 코드를 구현·리뷰·리팩터링할 때 [공통 개발 지침](./common.md)과 함께 읽는다.

## 1. 패키지 구조

```text
packages/database/
├── prisma/
│   ├── migrations/
│   ├── models/
│   │   ├── identity.prisma
│   │   ├── workspace.prisma
│   │   ├── work-management.prisma
│   │   ├── collaboration.prisma
│   │   ├── files.prisma
│   │   └── operations.prisma
│   └── schema.prisma
├── src/
│   ├── client.ts
│   ├── generated/
│   │   └── prisma/
│   └── index.ts
├── package.json
├── prisma.config.ts
└── tsconfig.json
```

- `prisma.config.ts`의 `schema`는 단일 파일이 아니라 `prisma/` 디렉터리를 가리킨다.
- `schema.prisma`에는 generator와 datasource를 두고 model과 enum은 `models/*.prisma`에 도메인 단위로 묶는다.
- Client generator는 `provider = "prisma-client"`, `output = "../src/generated/prisma"`, `runtime = "nodejs"`, `moduleFormat = "cjs"`, `engineType = "client"`를 사용한다.
- deprecated된 `prisma-client-js` generator와 `node_modules` 내부의 암묵적 생성 경로를 사용하지 않는다.
- 자체 PostgreSQL 연결은 `pg`와 `@prisma/adapter-pg`를 사용하고 `src/client.ts`에서 adapter와 Prisma Client 생성을 한 곳으로 모은다.
- 모델 하나마다 파일을 만들지 않고 함께 변경되는 관계·enum·모델을 같은 도메인 파일에 둔다.
- 파일 사이 relation을 위해 import나 중복 model을 만들지 않는다. Prisma가 디렉터리 안의 schema 파일을 하나로 결합한다.
- `schema.prisma`와 전체 migration 이력을 함께 버전 관리한다.
- 생성된 Prisma Client 파일을 사람이 수정하지 않는다.
- `index.ts`는 Prisma Client 생성·타입과 앱이 사용할 최소 진입점만 export하고 API·워커는 생성 디렉터리를 직접 import하지 않는다.
- API와 워커 프로세스는 각각 하나의 Prisma Client 수명주기를 관리한다.
- `pg` 연결 풀 최대값은 API 10개, 워커 5개를 기본으로 하고 `DATABASE_POOL_MAX`로 앱별 조정할 수 있게 한다.
- 연결 대기 제한은 `DATABASE_CONNECTION_TIMEOUT_MS=5000`, 유휴 연결 제한은 `DATABASE_IDLE_TIMEOUT_MS=10000`을 기본으로 한다.
- PM2 인스턴스를 늘릴 때는 모든 앱의 `인스턴스 수 × DATABASE_POOL_MAX` 합계와 migration·운영 연결 여유를 PostgreSQL 최대 연결 수 안에서 검토한다.
- 요청마다 Prisma Client를 새로 만들지 않는다.

## 2. 이름 매핑

- PostgreSQL 테이블과 컬럼은 복수형 `snake_case`를 유지한다.
- Prisma model은 단수형 `PascalCase`, Prisma field는 `camelCase`를 사용한다.
- `@@map`과 `@map`으로 물리 이름과 TypeScript 이름을 명시적으로 연결한다.
- 관계 필드는 의미를 드러내는 단수·복수형을 사용하고 `data`, `relation` 같은 일반 이름을 피한다.
- Prisma enum 값과 저장되는 도메인 코드는 `UPPER_SNAKE_CASE`를 사용한다.

## 3. 쿼리

- 워크스페이스 업무 조회는 메서드 입력에 `workspaceId` 또는 검증된 membership context를 필수로 둔다.
- `id`만으로 조회한 뒤 애플리케이션에서 workspace를 비교하지 않는다.
- API 응답에 필요한 필드만 `select`하고 관계 전체를 습관적으로 `include`하지 않는다.
- 목록은 안정적인 보조 ID가 있는 cursor pagination을 사용한다.
- 반복 조회가 보이면 먼저 한 번의 관계 조회, `in` 조건이나 집계 쿼리로 합친다.
- raw SQL은 Prisma가 안전·명확하게 표현하지 못하는 제약, 잠금과 PostgreSQL 기능에만 사용한다.
- raw SQL 값은 항상 parameter binding을 사용하고 문자열로 조합하지 않는다.
- 성능 최적화 전 쿼리 수, 실행 계획과 실제 데이터 규모를 확인한다.

## 4. Migration

- 스키마 변경은 새 migration으로 남기고 이미 공유·적용된 migration을 수정하지 않는다.
- 생성된 SQL을 검토해 잠금, 기존 데이터, `NOT NULL`, 유일 제약과 인덱스 영향을 확인한다.
- Prisma가 표현하지 못하는 부분 인덱스와 복잡한 CHECK는 migration SQL에 명시한다.
- 개발에서 migration을 생성하고 운영은 [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate/getting-started)의 커밋된 이력에 `migrate deploy`만 사용한다.
- 운영 스키마에 `db push`와 수동 DDL을 사용하지 않는다.
- 컬럼 제거·이름 변경은 새 코드와 기존 코드가 공존할 수 있는 확장 후 축소 순서로 나눈다.

## 5. 트랜잭션과 데이터 일관성

- use case를 조정하는 service가 트랜잭션 시작과 종료를 소유한다.
- repository가 호출자 몰래 독립 트랜잭션을 열지 않는다.
- 여러 repository가 같은 트랜잭션에 참여하면 Prisma transaction client를 명시적으로 전달한다.
- 업무 데이터, 활동 기록과 Outbox 발행은 하나의 트랜잭션에서 함께 성공하거나 롤백한다.
- 외부 API 호출, 파일 바이너리 이동과 긴 계산은 데이터베이스 트랜잭션 밖에서 수행한다.
- 파일시스템과 PostgreSQL을 하나의 원자 트랜잭션처럼 가장하지 않는다. 임시 파일, 상태 행과 정리 작업으로 보상한다.
- 읽은 상태를 바탕으로 쓰는 불변 조건은 필요한 행을 잠그거나 조건부 update로 경쟁을 막는다.
- 낙관적 동시 수정은 `version` 조건을 update에 포함하고 영향 행이 없으면 충돌로 처리한다.
- 재시도는 멱등성이 확인된 좁은 범위에서만 수행한다.
