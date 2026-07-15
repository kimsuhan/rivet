# API 애플리케이션 작업 지침

## 적용 범위

- 이 지침은 `apps/api` 아래의 모든 파일에 적용한다.

## 필수 문서

- `apps/api` 아래의 코드를 구현, 리뷰 또는 리팩터링하기 전에 다음 문서를 순서대로 읽고 따른다.
  1. [공통 개발 지침](../../docs/development/common.md)
  2. [API 개발 지침](../../docs/development/api.md)
- 단순 질의나 코드 기준이 필요하지 않은 문서 작업에서는 개발 지침을 읽지 않는다.

## 조건부 문서

- Prisma 쿼리, 데이터 제약, 트랜잭션, 스키마 또는 migration을 변경할 때는 [데이터베이스 개발 지침](../../docs/development/database.md)을 추가로 읽는다.
- 웹 소비 코드나 생성 클라이언트 사용 방식까지 함께 변경할 때는 [웹 개발 지침](../../docs/development/web.md)을 추가로 읽는다.
- 제품 동작이나 엔드포인트별 상세 계약이 필요할 때만 [문서 색인](../../docs/index.md)에서 관련 기획·기술 설계 문서를 찾아 읽는다.
- 관계없는 웹·워커 문서는 미리 읽지 않는다.

## 책임 경계

- Controller는 HTTP 경계, Service는 사용 사례, Domain function은 순수 규칙을 담당한다.
- 단순 Prisma 호출을 의무적인 repository나 interface로 감싸지 않는다.
- 모든 외부 입력, 인증, 권한과 workspace 격리를 서버에서 검증한다.
- 업무 변경, 활동 기록과 Outbox 발행의 트랜잭션 경계를 명시한다.
- Prisma model을 응답 DTO로 직접 노출하거나 워커 내부 코드를 import하지 않는다.

## 완료 조건

- 요청 DTO, 응답 DTO, 오류 코드와 OpenAPI가 실제 동작과 일치하는지 확인한다.
- 허용 사례와 다른 workspace·역할의 거부 사례를 함께 검증한다.
- 변경 범위의 단위·통합 테스트, lint, typecheck와 build를 실행한다.
- API 계약이 바뀌면 OpenAPI·Orval 재생성과 `api:contract:check`를 실행한다.
- Prisma 변경이 있으면 데이터베이스 override의 검증 절차도 따른다.
