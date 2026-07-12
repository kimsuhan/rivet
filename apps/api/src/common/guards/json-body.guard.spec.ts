import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { JsonBodyGuard } from './json-body.guard';

function createContext(method: string, headers: Record<string, string>): ExecutionContext {
  return {
    getClass: () => JsonBodyGuard,
    getHandler: () => createContext,
    switchToHttp: () => ({
      getRequest: () => ({ headers, method }),
    }),
  } as unknown as ExecutionContext;
}

describe('JsonBodyGuard', () => {
  const guard = new JsonBodyGuard({ getAllAndOverride: () => false } as unknown as Reflector);

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows the safe %s method without a body', (method) => {
    expect(guard.canActivate(createContext(method, {}))).toBe(true);
  });

  it('allows bodyless state-changing requests', () => {
    expect(guard.canActivate(createContext('POST', {}))).toBe(true);
    expect(guard.canActivate(createContext('DELETE', { 'content-length': '0' }))).toBe(true);
  });

  it('allows a JSON body including a charset parameter', () => {
    expect(
      guard.canActivate(
        createContext('POST', {
          'content-length': '2',
          'content-type': 'Application/JSON; charset=utf-8',
        }),
      ),
    ).toBe(true);
  });

  it.each([
    [{ 'content-length': '4', 'content-type': 'text/plain' }],
    [{ 'content-length': '4' }],
    [{ 'content-type': 'multipart/form-data', 'transfer-encoding': 'chunked' }],
  ])('rejects a non-JSON body by default', (headers) => {
    expect(() => guard.canActivate(createContext('POST', headers))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_REQUEST' }),
        status: HttpStatus.BAD_REQUEST,
      }),
    );
  });
});
