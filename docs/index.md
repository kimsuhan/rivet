# Rivet 문서

> 상태: 현행
> 적용 범위: Rivet 제품 운영, 개발과 유지보수
> 정본 책임: 작업 목적별 문서 진입점과 정본 위치
> 갱신 조건: 문서 추가·삭제·이동, 책임 변경 또는 현재 제품 단계 변경
> 현재 단계: Public 준비

이 디렉터리는 현재 구현과 운영에 사용하는 정본만 보관한다. 완료된 제품 단계, 실행 계획,
검토 보고와 의사결정 과정은 Git 이력과 Pull Request에서 확인한다.

문서를 번호순으로 전부 읽지 않는다. 아래 작업별 진입점에서 필요한 문서만 선택한다.

## 제품을 이해할 때

| 문서 | 사용하는 경우 |
| --- | --- |
| [현재 제품](./product/current-product.md) | 현재 제공하는 기능과 제품 경계를 확인할 때 |
| [핵심 용어와 정책](./product/terms-and-policies.md) | 데이터 소유권, 권한, 상태와 제품 불변식을 판단할 때 |
| [사용자 흐름](./product/user-flows.md) | 사용자의 주요 진입·완료 흐름과 공통 실패 처리를 확인할 때 |

Public 제품 범위와 실행 순서는 기능 결정을 확정한 뒤 별도 문서로 추가한다. 이전 단계의
미구현 계획은 Public 범위로 자동 승계하지 않는다.

## 기능을 구현하거나 수정할 때

1. 변경되는 동작에 해당하는 제품 문서만 읽는다.
2. [개발 지침 색인](./development/index.md)에서 변경하는 앱·패키지의 지침만 읽는다.
3. 코드만으로 알 수 없는 경계가 바뀔 때만 관련 아키텍처 문서를 읽고 같은 작업에서 갱신한다.

| 문서 | 선택 기준 |
| --- | --- |
| [시스템 경계](./architecture/system-boundaries.md) | 앱·패키지 책임, 요청·비동기 흐름과 외부 경계를 바꿀 때 |
| [데이터 일관성](./architecture/data-consistency.md) | 트랜잭션, 계산 상태, 멱등성, migration과 호환성 정책을 바꿀 때 |
| [보안과 데이터 수명주기](./architecture/security-and-data-lifecycle.md) | 인증, 권한, 격리, 파일 접근, 삭제와 보존 정책을 바꿀 때 |
| [비동기 작업과 외부 연동](./architecture/async-and-integrations.md) | Outbox, 알림, 이메일, Web Push, SSE와 관측 연동을 바꿀 때 |

HTTP 엔드포인트와 DTO의 정본은
[`apps/api/openapi/openapi.json`](../apps/api/openapi/openapi.json), 데이터 모델과 제약의
정본은 [`packages/database/prisma`](../packages/database/prisma/)다. 문서와 코드가
충돌하면 구현을 임의로 문서에 맞추지 말고 의도한 계약을 확인한 뒤 둘을 같은 작업에서
정합하게 만든다.

## 배포하고 운영할 때

| 문서 | 사용하는 경우 |
| --- | --- |
| [환경 구성](./operations/environment.md) | 로컬·테스트·운영 환경과 비밀 값 주입 기준을 확인할 때 |
| [릴리스와 되돌리기](./operations/release-and-rollback.md) | 서버 준비, 배포, smoke test와 애플리케이션 롤백을 실행할 때 |
| [백업과 복원](./operations/backup-and-restore.md) | PostgreSQL·파일 저장소 백업, 격리 복원과 정합성을 확인할 때 |
| [장애 대응](./operations/incident-response.md) | 서비스, Outbox, SSE, 이메일, 파일 저장소 장애에 대응할 때 |
| [보안 운영과 외부 연동](./operations/security-and-integrations.md) | 비밀 교체, 보안 사고, PostHog·Slack·Resend·Web Push를 운영할 때 |

## 문서 관리 규칙

- 각 문서는 상태, 적용 범위, 정본 책임과 갱신 조건을 명시한다.
- 제품 단계명, 완료 기록, 실행 프롬프트와 일회성 조사 자료를 정본 문서에 보관하지 않는다.
- 코드·OpenAPI·Prisma에서 생성하거나 직접 검증할 수 있는 목록을 문서에 복제하지 않는다.
- 같은 문서를 색인의 여러 위치에서 반복 연결하지 않는다.
- 진행 중인 실행 문서는 실제 작업 기간에만 유지하고 완료 뒤 유효한 계약을 정본에 반영한 후 삭제한다.
- 장기 의사결정 문서는 현재 구조를 이해하는 데 필요하고 변경 조건이 명확할 때만 추가한다.
- 새 문서나 경로 변경은 색인, `DESIGN.md`, `AGENTS.md`와 저장소 내부 링크를 같은 작업에서 갱신한다.
