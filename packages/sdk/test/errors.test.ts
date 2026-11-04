import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRetryAfter } from '../src/errors';

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    assert.equal(parseRetryAfter('1'), 1);
    assert.equal(parseRetryAfter(' 30 '), 30);
    assert.equal(parseRetryAfter('0'), 0);
  });

  it('reads an HTTP-date relative to now, never negative', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    assert.equal(parseRetryAfter('Wed, 04 Nov 2026 12:00:05 GMT', now), 5);
    assert.equal(parseRetryAfter('Wed, 04 Nov 2026 11:59:00 GMT', now), 0);
  });

  it('is undefined when absent or unreadable', () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter('soon'), undefined);
    assert.equal(parseRetryAfter('-5'), undefined);
  });
});
