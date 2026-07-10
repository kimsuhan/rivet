# 데이터베이스 패키지 작업 지침

## 적용 범위

- 이 지침은 `packages/database` 아래의 모든 파일에 적용한다.

## 필수 문서

- 코드를 구현, 리뷰 또는 리팩터링하기 전에 다음 문서를 순서대로 읽고 따른다.
  1. [공통 개발 지침](../../docs/development/common.md)
  2. [데이터베이스 개발 지침](../../docs/development/database.md)
- 제품 데이터 정책이나 관계가 필요할 때만 [문서 색인](../../docs/index.md)에서 도메인·데이터 모델 명세를 찾아 읽는다.

## 책임 경계

- Prisma schema, migration, 생성 클라이언트와 연결 진입점만 소유한다.
- API 응답 DTO, 화면 타입과 앱별 제품 흐름을 패키지에 넣지 않는다.
- 생성된 Prisma Client를 직접 수정하지 않고 schema와 generator 설정을 변경한 뒤 재생성한다.
- workspace 업무 쿼리는 `workspaceId` 또는 검증된 membership context를 경계에 포함한다.
- 트랜잭션, 제약과 인덱스로 데이터 불변 조건을 보호한다.

## Migration 안전성

- 이미 공유되거나 적용된 migration을 수정하지 않고 새 migration을 추가한다.
- 운영 스키마에 `db push`나 이력 밖의 수동 DDL을 사용하지 않는다.
- 생성 SQL의 잠금, 기존 데이터, `NOT NULL`, 유일 제약과 인덱스 영향을 검토한다.
- 파괴적 변경은 새 코드와 기존 코드가 공존하는 확장 후 축소 순서로 나눈다.

## 완료 조건

- 저장소 스크립트를 통해 Prisma format, validate와 generate를 실행한다.
- 변경된 제약·쿼리·트랜잭션은 실제 PostgreSQL 통합 테스트로 검증한다.
- 관련 lint, typecheck와 데이터베이스 테스트를 실행한다.
- schema와 migration 이력, 생성 진입점의 일관성을 확인한다.
