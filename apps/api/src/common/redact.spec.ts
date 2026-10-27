// apps/api/src/common/redact.spec.ts — Lot SEC (G1)
import { redactSecrets } from './redact';

const FAKE_KEY = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';

describe('redactSecrets', () => {
  it('passes null/undefined through', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('keeps a plain step message readable', () => {
    const msg = 'Command failed (1): pnpm tsx src/scripts/ingest/run-blend-pool-refresh.ts';
    expect(redactSecrets(msg)).toBe(msg);
  });

  it('reduces a URL with a key in its path to scheme + host', () => {
    const msg = `request to https://rpc.example.com/v1/${FAKE_KEY} failed, reason: socket hang up`;
    const out = redactSecrets(msg);
    expect(out).toBe('request to https://rpc.example.com/[redacted] failed, reason: socket hang up');
    expect(out).not.toContain(FAKE_KEY);
  });

  it('reduces a URL with a key in its query to scheme + host', () => {
    const out = redactSecrets(`GET https://api.example.com/prices?apikey=${FAKE_KEY}&ids=xlm → 429`);
    expect(out).toBe('GET https://api.example.com/[redacted] → 429');
  });

  it('redacts labelled secrets outside URLs', () => {
    expect(redactSecrets(`Authorization: Bearer ${FAKE_KEY} rejected`)).toBe(
      'Authorization: Bearer [redacted] rejected',
    );
    expect(redactSecrets('api-key=shortkey rejected')).toBe('api-key=[redacted] rejected');
  });

  it('redacts bare opaque tokens of 32+ chars', () => {
    expect(redactSecrets(`unexpected ${FAKE_KEY} in response`)).toBe('unexpected [redacted] in response');
  });

  it('leaves short identifiers and numbers alone', () => {
    const msg = '3/19 failed — blend-main: timeout after 30000ms; aquarius-xlm-usdc: 502';
    expect(redactSecrets(msg)).toBe(msg);
  });
});
