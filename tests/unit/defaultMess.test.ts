import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ listActiveMessIds: vi.fn() }));
vi.mock('../../src/modules/settings/settings.repository', () => m);

const ORIGINAL = process.env.DEFAULT_MESS_ID;
const REAL = '11111111-1111-4111-8111-111111111111';

/** Loads the module fresh with a given DEFAULT_MESS_ID (config is read once at import). */
async function load(envValue: string) {
  vi.resetModules();
  process.env.DEFAULT_MESS_ID = envValue;
  return import('../../src/modules/settings/defaultMess.js');
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  process.env.DEFAULT_MESS_ID = ORIGINAL;
});

describe('getDefaultMessId', () => {
  it('uses DEFAULT_MESS_ID when it is set (several messes)', async () => {
    const { getDefaultMessId } = await load('22222222-2222-4222-8222-222222222222');
    expect(await getDefaultMessId()).toBe('22222222-2222-4222-8222-222222222222');
    expect(m.listActiveMessIds).not.toHaveBeenCalled();
  });

  it.each([['empty', ''], ['the example placeholder', '00000000-0000-4000-8000-000000000000']])(
    'when %s, finds the one mess by itself and remembers it',
    async (_l, value) => {
      m.listActiveMessIds.mockResolvedValue([REAL]);
      const { getDefaultMessId } = await load(value);
      expect(await getDefaultMessId()).toBe(REAL);
      expect(await getDefaultMessId()).toBe(REAL);
      expect(m.listActiveMessIds).toHaveBeenCalledTimes(1); // cached
    },
  );

  it('fails clearly when no mess exists yet (database not set up)', async () => {
    m.listActiveMessIds.mockResolvedValue([]);
    const { getDefaultMessId } = await load('');
    await expect(getDefaultMessId()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('refuses to guess when there are several messes', async () => {
    m.listActiveMessIds.mockResolvedValue([REAL, '33333333-3333-4333-8333-333333333333']);
    const { getDefaultMessId } = await load('');
    await expect(getDefaultMessId()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
