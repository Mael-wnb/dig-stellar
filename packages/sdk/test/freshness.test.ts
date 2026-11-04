import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOfDate, isStale } from '../src/freshness';

describe('freshness helpers', () => {
  it('isStale reads isStale, then the deprecated stale alias, else null', () => {
    assert.equal(isStale({ isStale: true, stale: false }), true);
    assert.equal(isStale({ isStale: false }), false);
    assert.equal(isStale({ isStale: null }), null);
    assert.equal(isStale({ stale: true }), true);
    assert.equal(isStale({}), null);
  });

  it('asOfDate turns updatedAt into a Date, null when missing or unparseable', () => {
    assert.equal(asOfDate({ updatedAt: '2026-11-03T18:01:05.612Z' })?.toISOString(), '2026-11-03T18:01:05.612Z');
    assert.equal(asOfDate({ updatedAt: null }), null);
    assert.equal(asOfDate({}), null);
    assert.equal(asOfDate({ updatedAt: 'not a date' }), null);
  });
});
