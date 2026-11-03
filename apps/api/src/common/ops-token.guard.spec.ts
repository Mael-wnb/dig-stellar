// Lot PRE (D): the operator token gate. Unset env → 404; wrong / malformed
// bearer → 404; the right bearer → the request proceeds. Nothing is logged.
import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  OPS_TOKEN_ENV,
  OpsTokenGuard,
  opsTokenMatches,
} from './ops-token.guard';

const TOKEN = 'a'.repeat(64);

function contextWith(authorization?: string | string[]): ExecutionContext {
  const headers: Record<string, string | string[] | undefined> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('opsTokenMatches', () => {
  it('rejects everything while the token is unset or blank', () => {
    expect(opsTokenMatches(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(opsTokenMatches(`Bearer ${TOKEN}`, '')).toBe(false);
    expect(opsTokenMatches(`Bearer ${TOKEN}`, '   ')).toBe(false);
  });

  it('accepts only an exact Bearer match (scheme case-insensitive, token exact)', () => {
    expect(opsTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(opsTokenMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(opsTokenMatches(`  Bearer   ${TOKEN}  `, ` ${TOKEN} `)).toBe(true);
    expect(opsTokenMatches(`Bearer ${TOKEN.toUpperCase()}`, TOKEN)).toBe(false);
    expect(opsTokenMatches(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(opsTokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(opsTokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(opsTokenMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(opsTokenMatches(undefined, TOKEN)).toBe(false);
    expect(opsTokenMatches('', TOKEN)).toBe(false);
    expect(opsTokenMatches([`Bearer ${TOKEN}`], TOKEN)).toBe(true);
  });
});

describe('OpsTokenGuard', () => {
  const guard = new OpsTokenGuard();
  const saved = process.env[OPS_TOKEN_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[OPS_TOKEN_ENV];
    else process.env[OPS_TOKEN_ENV] = saved;
  });

  it('env unset → 404 even with a bearer', () => {
    delete process.env[OPS_TOKEN_ENV];
    expect(() => guard.canActivate(contextWith(`Bearer ${TOKEN}`))).toThrow(
      NotFoundException,
    );
    expect(() => guard.canActivate(contextWith())).toThrow(NotFoundException);
  });

  it('wrong or missing bearer → 404 with the standard Nest body', () => {
    process.env[OPS_TOKEN_ENV] = TOKEN;
    expect(() => guard.canActivate(contextWith())).toThrow(NotFoundException);
    expect(() => guard.canActivate(contextWith('Bearer nope'))).toThrow(
      NotFoundException,
    );
    try {
      guard.canActivate(contextWith('Bearer nope'));
    } catch (e) {
      expect((e as NotFoundException).getStatus()).toBe(404);
      expect((e as NotFoundException).getResponse()).toEqual({
        statusCode: 404,
        message: 'Not Found',
      });
    }
  });

  it('right bearer → proceeds', () => {
    process.env[OPS_TOKEN_ENV] = TOKEN;
    expect(guard.canActivate(contextWith(`Bearer ${TOKEN}`))).toBe(true);
  });
});
