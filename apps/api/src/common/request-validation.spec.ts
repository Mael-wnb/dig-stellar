// apps/api/src/common/request-validation.spec.ts — Lot SEC (G1)
//
// The shared validators must answer 400 for every malformed shape a body field
// or query param can take (array from a repeated key, object, number, over-long
// string) and never reach a `.trim()` or regex on a non-string.
import { BadRequestException } from '@nestjs/common';
import {
  optionalKeyword,
  optionalText,
  optionalUserId,
  requireAddress,
  requireUserId,
  requireUuid,
} from './request-validation';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWLT';
const UUID = '00000000-0000-4000-8000-0000000000aa';

describe('requireAddress', () => {
  it('accepts a trimmed G… public key', () => {
    expect(requireAddress(`  ${G}  `)).toBe(G);
  });

  it.each([
    ['plain text with punctuation', 'not an address; really not'],
    ['too short', 'GABC'],
    ['lowercase', G.toLowerCase()],
    ['contract address', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB'],
    ['array', [G]],
    ['object', { address: G }],
    ['number', 42],
    ['undefined', undefined],
    ['over 128 chars', 'G'.repeat(200)],
  ])('rejects %s with 400', (_name, value) => {
    expect(() => requireAddress(value)).toThrow(BadRequestException);
  });
});

describe('requireUserId / optionalUserId / requireUuid', () => {
  it('accepts a UUID', () => {
    expect(requireUserId(UUID)).toBe(UUID);
    expect(optionalUserId(UUID)).toBe(UUID);
    expect(requireUuid(UUID, 'walletId')).toBe(UUID);
  });

  it('optionalUserId: absent/empty → null', () => {
    expect(optionalUserId(undefined)).toBeNull();
    expect(optionalUserId(null)).toBeNull();
    expect(optionalUserId('')).toBeNull();
  });

  it.each([
    ['array (repeated query key)', [UUID, UUID]],
    ['object', { a: 1 }],
    ['number', 1],
    ['not a uuid', 'abc'],
  ])('rejects %s with 400', (_name, value) => {
    expect(() => requireUserId(value)).toThrow(BadRequestException);
    expect(() => optionalUserId(value)).toThrow(BadRequestException);
    expect(() => requireUuid(value, 'walletId')).toThrow(BadRequestException);
  });
});

describe('optionalText', () => {
  it('absent/blank → null, trimmed otherwise', () => {
    expect(optionalText(undefined, 'label', 64)).toBeNull();
    expect(optionalText('   ', 'label', 64)).toBeNull();
    expect(optionalText('  Trading ', 'label', 64)).toBe('Trading');
  });

  it('accepts exactly maxChars and rejects maxChars + 1', () => {
    expect(optionalText('x'.repeat(64), 'label', 64)).toHaveLength(64);
    expect(() => optionalText('x'.repeat(65), 'label', 64)).toThrow(BadRequestException);
  });

  it.each([
    ['array', ['a']],
    ['object', { a: 1 }],
    ['number', 5],
  ])('rejects %s with 400', (_name, value) => {
    expect(() => optionalText(value, 'label', 64)).toThrow(BadRequestException);
  });
});

describe('optionalKeyword', () => {
  it('absent → fallback, lower-cased otherwise', () => {
    expect(optionalKeyword(undefined, 'chain', 'stellar')).toBe('stellar');
    expect(optionalKeyword(' Stellar ', 'chain', 'stellar')).toBe('stellar');
  });

  it('rejects non-strings with 400', () => {
    expect(() => optionalKeyword(['stellar'], 'chain', 'stellar')).toThrow(BadRequestException);
  });
});
