import { describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../../src/modules/auth/tokenVerifier';

const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = (payload: object, header: object = { alg: 'RS256', typ: 'JWT', kid: 'test-key' }): string =>
  `${b64(header)}.${b64(payload)}.c2ln`;

async function codeOf(token: string): Promise<string> {
  try {
    await verifyAccessToken(token);
    return 'no error';
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}

describe('verifyAccessToken (no network needed for these cases)', () => {
  it.each(['', 'hello', 'a.b', 'abc.def.ghi', 'a.b.c.d', 'x'.repeat(5000)])('rejects garbage %#', async (token) => {
    expect(await codeOf(token)).toBe('UNAUTHORIZED');
  });

  it('reports an expired token as TOKEN_EXPIRED so clients refresh', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = unsigned({ sub: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', exp: past });
    expect(await codeOf(token)).toBe('TOKEN_EXPIRED');
  });
});
