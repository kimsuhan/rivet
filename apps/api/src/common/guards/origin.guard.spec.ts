import { type ExecutionContext, HttpStatus } from '@nestjs/common';

import { OriginGuard } from './origin.guard';

function createContext(method: string, headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        get: (name: string) => headers[name.toLowerCase()],
        method,
      }),
    }),
  } as ExecutionContext;
}

describe('OriginGuard', () => {
  const guard = new OriginGuard({ webOrigin: 'https://rivet.example.com' });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows the safe %s method without an origin', (method) => {
    expect(guard.canActivate(createContext(method, {}))).toBe(true);
  });

  it('accepts the exact configured origin or a same-origin referer', () => {
    expect(guard.canActivate(createContext('POST', { origin: 'https://rivet.example.com' }))).toBe(
      true,
    );
    expect(
      guard.canActivate(createContext('POST', { referer: 'https://rivet.example.com/login' })),
    ).toBe(true);
  });

  it('rejects missing, malformed, and suffix-matched origins', () => {
    expect(() => guard.canActivate(createContext('POST', {}))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CSRF_INVALID' }),
        status: HttpStatus.FORBIDDEN,
      }),
    );
    expect(() => guard.canActivate(createContext('POST', { referer: 'not-a-url' }))).toThrow(
      '요청 출처',
    );
    expect(() =>
      guard.canActivate(
        createContext('POST', { origin: 'https://rivet.example.com.attacker.test' }),
      ),
    ).toThrow('요청 출처');
  });

  it('does not use Referer to override a present but invalid Origin', () => {
    expect(() =>
      guard.canActivate(
        createContext('POST', {
          origin: 'https://attacker.example.com',
          referer: 'https://rivet.example.com/login',
        }),
      ),
    ).toThrow('요청 출처');
  });

  it.each([
    'http://rivet.example.com',
    'https://rivet.example.com:444',
    'https://RIVET.example.com',
  ])('rejects an origin that is not the exact configured string: %s', (origin) => {
    expect(() => guard.canActivate(createContext('POST', { origin }))).toThrow('요청 출처');
  });
});
