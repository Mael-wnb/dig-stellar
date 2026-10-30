// apps/api/src/common/ttl-cache.spec.ts
import { TtlCache, ttlMsFromEnv } from './ttl-cache';

describe('TtlCache', () => {
  function cacheWithClock(ttlMs: number) {
    let t = 1_000_000;
    const cache = new TtlCache<string>(ttlMs, () => t);
    return { cache, advance: (ms: number) => (t += ms) };
  }

  it('hit within TTL: the loader runs once', async () => {
    const { cache, advance } = cacheWithClock(90_000);
    const loader = jest.fn().mockResolvedValue('v1');

    expect(await cache.get('k', loader)).toBe('v1');
    advance(89_999);
    expect(await cache.get('k', loader)).toBe('v1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('miss after TTL: the loader runs again and the new value replaces the old', async () => {
    const { cache, advance } = cacheWithClock(90_000);
    const loader = jest.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    expect(await cache.get('k', loader)).toBe('v1');
    advance(90_000);
    expect(await cache.get('k', loader)).toBe('v2');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keys are independent', async () => {
    const { cache } = cacheWithClock(90_000);
    const loader = jest.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');

    expect(await cache.get('a', loader)).toBe('a');
    expect(await cache.get('b', loader)).toBe('b');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('concurrent misses share one in-flight loader (no stampede)', async () => {
    const { cache } = cacheWithClock(90_000);
    let resolve!: (v: string) => void;
    const loader = jest.fn(() => new Promise<string>((r) => (resolve = r)));

    const p1 = cache.get('k', loader);
    const p2 = cache.get('k', loader);
    resolve('v');
    expect(await Promise.all([p1, p2])).toEqual(['v', 'v']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('a failed loader is not cached: the next get() retries', async () => {
    const { cache } = cacheWithClock(90_000);
    const loader = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('ok');

    await expect(cache.get('k', loader)).rejects.toThrow('db down');
    expect(await cache.get('k', loader)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('ttlMs = 0 disables caching', async () => {
    const { cache } = cacheWithClock(0);
    const loader = jest.fn().mockResolvedValue('v');

    await cache.get('k', loader);
    await cache.get('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('ttlMsFromEnv', () => {
  const NAME = 'TTL_CACHE_SPEC_VAR';
  afterEach(() => {
    delete process.env[NAME];
  });

  it.each([
    [undefined, 90_000],
    ['', 90_000],
    ['0', 0],
    ['15000', 15_000],
    ['-5', 90_000],
    ['abc', 90_000],
  ])('env %p → %p', (raw, expected) => {
    if (raw === undefined) delete process.env[NAME];
    else process.env[NAME] = raw;
    expect(ttlMsFromEnv(NAME, 90_000)).toBe(expected);
  });
});
