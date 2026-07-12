import { assertSafeTestDatabaseUrl } from './test-database-url';

describe('assertSafeTestDatabaseUrl', () => {
  it.each([
    'postgresql://user:password@localhost:5432/rivet?schema=public',
    'postgres://user:password@127.0.0.1:5432/rivet?schema=public',
    'postgresql://user:password@[::1]:5432/rivet?schema=public',
  ])('accepts the local rivet public test database: %s', (databaseUrl) => {
    expect(() => assertSafeTestDatabaseUrl(databaseUrl)).not.toThrow();
  });

  it.each([
    'not-a-url',
    'mysql://user:password@localhost:3306/rivet?schema=public',
    'postgresql://user:password@database.example.com:5432/rivet?schema=public',
    'postgresql://user:password@localhost:5432/production?schema=public',
    'postgresql://user:password@localhost:5432/rivet?schema=private',
  ])('rejects a database outside the test boundary: %s', (databaseUrl) => {
    expect(() => assertSafeTestDatabaseUrl(databaseUrl)).toThrow();
  });
});
