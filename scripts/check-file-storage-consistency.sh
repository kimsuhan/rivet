#!/bin/sh
set -eu

: "${FILE_STORAGE_ROOT:?FILE_STORAGE_ROOT를 복구 대상의 절대 경로로 설정하세요.}"

case "$FILE_STORAGE_ROOT" in
  /*) ;;
  *)
    echo "FILE_STORAGE_ROOT는 절대 경로여야 합니다." >&2
    exit 2
    ;;
esac

command -v psql >/dev/null 2>&1 || {
  echo "psql을 찾을 수 없습니다." >&2
  exit 2
}
test -d "$FILE_STORAGE_ROOT/objects" || {
  echo "파일 저장소의 objects 디렉터리를 찾을 수 없습니다." >&2
  exit 2
}

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/rivet-file-check.XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

psql -X -v ON_ERROR_STOP=1 -Atc 'SELECT storage_key FROM files ORDER BY storage_key' \
  >"$temp_dir/database-keys"
LC_ALL=C sort -u "$temp_dir/database-keys" -o "$temp_dir/database-keys"

: >"$temp_dir/object-keys"
: >"$temp_dir/invalid-entries"
find "$FILE_STORAGE_ROOT/objects" -mindepth 1 -maxdepth 1 -print | while IFS= read -r path; do
  if test -L "$path" || ! test -f "$path"; then
    printf '%s\n' "${path#"$FILE_STORAGE_ROOT"/}" >>"$temp_dir/invalid-entries"
  else
    printf 'objects/%s\n' "${path##*/}" >>"$temp_dir/object-keys"
  fi
done
LC_ALL=C sort -u "$temp_dir/object-keys" -o "$temp_dir/object-keys"

comm -23 "$temp_dir/database-keys" "$temp_dir/object-keys" >"$temp_dir/missing-binaries"
comm -13 "$temp_dir/database-keys" "$temp_dir/object-keys" >"$temp_dir/orphan-binaries"

if test -s "$temp_dir/missing-binaries"; then
  echo "DB에는 있지만 파일 저장소에 없는 항목:" >&2
  sed -n '1,50p' "$temp_dir/missing-binaries" >&2
fi
if test -s "$temp_dir/orphan-binaries"; then
  echo "파일 저장소에만 있는 항목:" >&2
  sed -n '1,50p' "$temp_dir/orphan-binaries" >&2
fi
if test -s "$temp_dir/invalid-entries"; then
  echo "일반 파일이 아닌 objects 항목:" >&2
  sed -n '1,50p' "$temp_dir/invalid-entries" >&2
fi

if test -s "$temp_dir/missing-binaries" || test -s "$temp_dir/orphan-binaries" || \
  test -s "$temp_dir/invalid-entries"; then
  exit 1
fi

file_count=$(wc -l <"$temp_dir/database-keys" | tr -d '[:space:]')
echo "파일 메타데이터와 바이너리가 일치합니다: ${file_count}개"
