# API 클라이언트 패키지 작업 지침

## 적용 범위

- 이 지침은 `packages/api-client` 아래의 모든 파일에 적용한다.

## 필수 문서

- 코드를 구현, 리뷰 또는 리팩터링하기 전에 [공통 개발 지침](../../docs/development/common.md)을 읽는다.
- OpenAPI 생산 계약도 변경할 때는 [API 개발 지침](../../docs/development/api.md)을 추가로 읽는다.
- 웹의 호출·캐시 동작도 변경할 때는 [웹 개발 지침](../../docs/development/web.md)을 추가로 읽는다.

## 책임 경계

- OpenAPI에서 생성한 타입, Fetch 호출 함수, TanStack Query hook과 최소 런타임 설정만 소유한다.
- 생성 파일을 직접 수정하지 않고 DTO, OpenAPI 또는 Orval 설정을 변경한 뒤 재생성한다.
- 인증 쿠키, CSRF와 공통 오류 처리는 생성 영역 밖의 단일 Fetch mutator에서 관리한다.
- 앱 내부 코드, 화면 모델과 수동으로 중복 작성한 API 타입을 포함하지 않는다.

## 완료 조건

- OpenAPI와 Orval 결과를 재생성하고 의도한 변경만 포함됐는지 diff를 확인한다.
- `api:contract:check`, 관련 lint와 typecheck를 실행한다.
- 호환되지 않는 필드·enum 변경은 API와 웹 전환 순서를 함께 확인한다.
