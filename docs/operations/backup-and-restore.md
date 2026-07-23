# 백업과 복원

> 상태: 현행
> 적용 범위: PostgreSQL과 로컬 `FILE_STORAGE_ROOT`
> 정본 책임: 일관된 백업 쌍, 격리 복원과 데이터·파일 정합성 검증
> 갱신 조건: 데이터베이스, 파일 저장소, 백업 형식 또는 복구 목표 변경

PostgreSQL과 파일 저장소는 하나의 제품 상태를 구성하므로 같은 점검 시간에 만든 백업 쌍으로
관리한다. 운영 DB나 파일 경로에 복원 훈련을 실행하지 않는다.

## 백업 전 확인

- 외부 쓰기를 차단하고 Web, API와 Worker를 정상 종료한다.
- PostgreSQL 인증은 제한된 `.pg_service.conf`와 `.pgpass` 또는 동등한 비밀 저장소를 사용한다.
- 백업 경로가 운영 서버의 서비스 계정과 분리돼 있고 충분한 공간이 있는지 확인한다.
- 현재 `RELEASE_ID`, migration 목록, 시작 시각과 파일 저장소 경로를 기록한다.

## 백업

```sh
export PGSERVICE=rivet-production
export BACKUP_DIR=/secure/backup/rivet/backup-id
umask 077
mkdir -p "$BACKUP_DIR"

pm2 stop rivet-web
pm2 stop rivet-api
pm2 stop rivet-worker

pg_dump --format=custom --file="$BACKUP_DIR/database.dump"
tar --create --file="$BACKUP_DIR/files.tar" --directory="$FILE_STORAGE_ROOT" .

pg_restore --list "$BACKUP_DIR/database.dump" >/dev/null
tar --list --file="$BACKUP_DIR/files.tar" >/dev/null
test -s "$BACKUP_DIR/database.dump"
test -s "$BACKUP_DIR/files.tar"
(
  cd "$BACKUP_DIR"
  sha256sum database.dump files.tar >SHA256SUMS
)
```

완성된 쌍을 운영 서버와 다른 제한된 위치에 복제한다. 파일 크기와 명령 성공만으로 복구
가능성을 확정하지 않고 정기적으로 격리 복원을 수행한다.

## 격리 복원 준비

- 네트워크가 격리된 빈 PostgreSQL 데이터베이스를 사용한다.
- 운영과 다른 `PGSERVICE`, `DATABASE_URL`, `FILE_STORAGE_ROOT`, `WEB_ORIGIN`을 사용한다.
- 파일 복원 루트가 비어 있고 DB `public` schema에 기존 테이블이 없는지 확인한다.
- 운영 비밀, 이메일 수신자와 외부 관측 키를 복원 환경에 주입하지 않는다.

```sh
export RESTORE_PGSERVICE=rivet-restore
export RESTORE_FILE_STORAGE_ROOT=/isolated/rivet-restore-files

test -d "$RESTORE_FILE_STORAGE_ROOT"
test -z "$(find "$RESTORE_FILE_STORAGE_ROOT" -mindepth 1 -print -quit)"
test "$(psql -X -v ON_ERROR_STOP=1 --dbname="service=$RESTORE_PGSERVICE" -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")" = 0
(
  cd "$BACKUP_DIR"
  sha256sum --check SHA256SUMS
)
```

## 복원

```sh
pg_restore --exit-on-error --single-transaction \
  --dbname="service=$RESTORE_PGSERVICE" "$BACKUP_DIR/database.dump"
tar --extract --file="$BACKUP_DIR/files.tar" --directory="$RESTORE_FILE_STORAGE_ROOT"

PGSERVICE="$RESTORE_PGSERVICE" FILE_STORAGE_ROOT="$RESTORE_FILE_STORAGE_ROOT" \
  sh scripts/check-file-storage-consistency.sh
```

정합성 검사는 DB의 `files.storage_key`와 저장소 바이너리를 읽기 전용으로 비교한다. 누락,
고아, 심볼릭 링크와 잘못된 경로가 있으면 자동 삭제하지 않고 백업 쌍과 기준 시각을 다시
확인한다.

## 복원 검증

복원한 schema와 호환되는 릴리스를 격리 환경에서 시작해 다음을 확인한다.

- migration 이력과 주요 테이블 수
- 워크스페이스 격리와 관리자·멤버 권한
- 로그인, 이슈·팀 작업·전달과 휴지통
- Outbox, 인앱 알림과 SSE
- 파일 업로드·조회와 DB·파일 정합성
- 최근 백업 시각 이후 예상 데이터 손실 범위

복구 시간, 실패 단계, 필요한 권한, 데이터 손실 범위와 확인자를 기록한다. 복원 훈련을
통과하지 않은 백업 정책은 운영 복구 절차가 준비된 것으로 보지 않는다.

## 실제 복원 판단

운영 복원은 애플리케이션 롤백으로 해결할 수 없고 데이터 손상이 확인된 경우에만 선택한다.
복원 시점 이후 정상 쓰기를 잃을 수 있으므로 사용자 영향, 보존 가능한 증분 데이터와 외부
부작용을 먼저 조사하고 승인받는다.
