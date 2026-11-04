// apps/api/src/cors-origin.spec.ts — Lot SDK0: CORS origin policy.
import { isAllowedOrigin, parseAllowedOrigins } from './cors-origin';

const PROD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://dig-stellar-web.vercel.app',
  'https://stellar.getdig.ai',
];

describe('isAllowedOrigin', () => {
  it('accepts a Vercel branch preview of the web project', () => {
    expect(
      isAllowedOrigin(
        'https://dig-stellar-web-git-feat-lot-sdk0-dig-7a565626.vercel.app',
        PROD_ORIGINS,
      ),
    ).toBe(true);
  });

  it('accepts a Vercel per-deployment preview URL', () => {
    expect(
      isAllowedOrigin(
        'https://dig-stellar-web-k3j9x2abc-dig-7a565626.vercel.app',
        PROD_ORIGINS,
      ),
    ).toBe(true);
  });

  it('accepts the production origins listed in CORS_ORIGINS', () => {
    expect(isAllowedOrigin('https://stellar.getdig.ai', PROD_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('https://dig-stellar-web.vercel.app', PROD_ORIGINS)).toBe(true);
  });

  it('rejects a lookalike host that embeds the preview pattern as a subdomain', () => {
    expect(
      isAllowedOrigin(
        'https://evil-dig-stellar-web-x-dig-7a565626.vercel.app.attacker.com',
        PROD_ORIGINS,
      ),
    ).toBe(false);
    expect(
      isAllowedOrigin(
        'https://dig-stellar-web-x-dig-7a565626.vercel.app.attacker.com',
        PROD_ORIGINS,
      ),
    ).toBe(false);
  });

  it('rejects an http:// preview URL', () => {
    expect(
      isAllowedOrigin(
        'http://dig-stellar-web-git-feat-x-dig-7a565626.vercel.app',
        PROD_ORIGINS,
      ),
    ).toBe(false);
  });

  it('rejects a same-named project under a different Vercel team suffix', () => {
    expect(
      isAllowedOrigin(
        'https://dig-stellar-web-git-feat-x-other-1234abcd.vercel.app',
        PROD_ORIGINS,
      ),
    ).toBe(false);
  });

  it('rejects an origin that is neither listed nor a preview', () => {
    expect(isAllowedOrigin('https://example.com', PROD_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('https://stellar.getdig.ai', [])).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parseAllowedOrigins(' https://a.example , ,https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('falls back to the local dev origins when unset', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });
});
