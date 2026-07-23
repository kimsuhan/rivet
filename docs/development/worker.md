# 워커 개발 지침

> 상태: 현행
> 적용 범위: `apps/worker`
> 정본 책임: Worker 모듈, Outbox 처리와 정기 작업 개발 기준
> 갱신 조건: 비동기 처리 구조, retry·lock 또는 정기 작업 방식 변경

워커 코드를 구현·리뷰·리팩터링할 때 [공통 개발 지침](./common.md)과 함께 읽는다. Outbox 조회·상태 변경이나 정리 쿼리를 변경하면 [데이터베이스 개발 지침](./database.md)도 읽는다.

## 1. 구조

워커도 NestJS 기능 모듈을 사용하지만 HTTP controller를 만들지 않는다.

```text
apps/worker/src/
├── common/
│   ├── logging/
│   └── shutdown/
├── modules/
│   ├── outbox/
│   │   ├── handlers/
│   │   │   ├── account-email.handler.ts
│   │   │   ├── notification.handler.ts
│   │   │   └── resource-purge.handler.ts
│   │   ├── outbox-poller.service.ts
│   │   ├── outbox.service.ts
│   │   └── outbox.module.ts
│   └── maintenance/
│       ├── file-cleanup.service.ts
│       ├── retention.service.ts
│       └── maintenance.module.ts
├── app.module.ts
└── main.ts
```

- Outbox polling, handler 선택과 개별 업무 처리를 분리한다.
- handler 이름은 처리하는 결과를 드러내고 범용 `job.handler.ts`를 만들지 않는다.
- API와 같은 Prisma 클라이언트를 사용하되 `apps/api` 코드를 import하지 않는다.
- 워커 전용 제품 규칙을 API 서비스에서 복사하지 않는다. 같은 규칙이 실제로 양쪽에서 필요하면 작은 순수 함수의 위치를 먼저 합의한다.
- HTTP health controller를 추가하지 않고 PM2 준비 신호, polling 상태와 운영 지표로 확인한다.

## 2. 처리 규칙

- 이벤트를 처리하기 전에 `eventType`, `schemaVersion`, workspace와 aggregate 참조를 검증한다.
- handler는 같은 이벤트가 다시 실행돼도 중복 알림·메일·삭제가 생기지 않게 작성한다.
- claim 트랜잭션 안에서 Resend, 파일 삭제와 긴 계산을 수행하지 않는다.
- 한 handler가 다른 handler를 직접 호출해 숨은 처리 순서를 만들지 않는다.
- 지원하지 않는 이벤트·payload 버전은 재시도 가능한 오류로 바꾸지 않는다.
- 외부 호출은 timeout을 가지며 공급자 응답 전체를 로그에 남기지 않는다.
- 종료 신호를 받으면 새 claim을 멈추고 짧은 현재 처리를 정리한 뒤 종료한다.

## 3. 환경 설정과 로그

- `@nestjs/config`의 custom `validate()`에서 class-validator와 class-transformer로 환경 변수를 시작 시 한 번 검증한다.
- 워커가 사용하는 환경 변수 클래스와 typed config만 소유하고 API 설정을 합친 공통 환경 클래스를 만들지 않는다.
- 환경 변수 검증만을 위해 Joi나 별도 검증 라이브러리를 추가하지 않는다.
- 워커 작업은 `jobId`로 추적한다.
- handler는 이벤트를 claim한 뒤 `jobId`, `eventType`과 내부 이벤트 ID를 포함한 child logger를 사용한다.
