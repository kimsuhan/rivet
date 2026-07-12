export function assertSafeTestDatabaseUrl(value: string): void {
  let databaseUrl: URL;

  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error('테스트 DATABASE_URL 형식이 올바르지 않습니다.');
  }

  const isLocalHost = ['127.0.0.1', '[::1]', 'localhost'].includes(databaseUrl.hostname);
  const isPostgres = ['postgres:', 'postgresql:'].includes(databaseUrl.protocol);

  if (
    !isLocalHost ||
    !isPostgres ||
    databaseUrl.pathname !== '/rivet' ||
    databaseUrl.searchParams.get('schema') !== 'public'
  ) {
    throw new Error('테스트는 로컬 rivet 데이터베이스의 public 스키마에서만 실행할 수 있습니다.');
  }
}
