// Lot EP (EP1): the verify-only helper must stay verify-only. Two halves:
//   1. SOURCE assertions — the helper's text never contains a secret-bearing
//      Keypair API, an env read or a signing call (INV-1.2 narrow exception,
//      docs/security-invariants.md §1).
//   2. BEHAVIOUR — accepts a genuine Ed25519 signature over the raw message,
//      its SHA-256 form or its SEP-53 form (and reports which), rejects
//      everything else.
// This spec file (not the helper) generates throwaway keypairs to sign test
// vectors — the same pattern as faucet-payout.spec.ts.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { decodeSignature, verifyWalletSignature } from './verify-wallet-signature';

const SOURCE = readFileSync(path.join(__dirname, 'verify-wallet-signature.ts'), 'utf8');

describe('verify-wallet-signature.ts source (verify-only, public key, no secret)', () => {
  it.each([
    ['fromSecret', /\bfromSecret\b/],
    ['fromRawEd25519Seed', /\bfromRawEd25519Seed\b/],
    ['Keypair.random', /\bKeypair\.random\b/],
    ['Keypair.master', /\bKeypair\.master\b/],
    ['.sign(', /\.sign\(/],
    ['.signDecorated(', /\.signDecorated\(/],
    ['.signPayloadDecorated(', /\.signPayloadDecorated\(/],
    ['process.env', /process\.env/],
    ['SECRET_KEY', /SECRET_KEY/],
    ['dotenv', /dotenv/],
  ])('never mentions %s', (_label, re) => {
    expect(SOURCE).not.toMatch(re);
  });

  it('uses Keypair.fromPublicKey and nothing else from Keypair', () => {
    const keypairUses = SOURCE.match(/Keypair\.[A-Za-z0-9_]+/g) ?? [];
    expect(new Set(keypairUses)).toEqual(new Set(['Keypair.fromPublicKey']));
  });
});

describe('verifyWalletSignature', () => {
  const signer = Keypair.random();
  const other = Keypair.random();
  const address = signer.publicKey();
  const message =
    'Dig Stellar ownership proof\n' +
    'This is not a transaction and moves no funds.\n' +
    `Address: ${address}\nNonce: 0123456789abcdef0123456789abcdef\nIssued: 2026-10-15T10:00:00.000Z`;

  it('accepts a raw-bytes signature (base64) and reports variant=raw', () => {
    const sig = signer.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyWalletSignature(address, message, sig)).toEqual({ ok: true, variant: 'raw' });
  });

  it('accepts a SHA-256-form signature and reports variant=sha256', () => {
    const digest = createHash('sha256').update(Buffer.from(message, 'utf8')).digest();
    const sig = signer.sign(digest).toString('base64');
    expect(verifyWalletSignature(address, message, sig)).toEqual({ ok: true, variant: 'sha256' });
  });

  it('accepts a SEP-53 signature and reports variant=sep53', () => {
    // SEP-53: Ed25519 over SHA-256(UTF-8("Stellar Signed Message:\n" + message)).
    // Same construction Freighter 5.49.0 was measured to use (2026-10-21).
    const prefixed = Buffer.from('Stellar Signed Message:\n' + message, 'utf8');
    const digest = createHash('sha256').update(prefixed).digest();
    const sig = signer.sign(digest).toString('base64');
    expect(verifyWalletSignature(address, message, sig)).toEqual({ ok: true, variant: 'sep53' });
  });

  it('rejects the SEP-53 prefix without the hash, and the hash without the prefix', () => {
    const prefixed = Buffer.from('Stellar Signed Message:\n' + message, 'utf8');
    const unhashed = signer.sign(prefixed).toString('base64');
    expect(verifyWalletSignature(address, message, unhashed).ok).toBe(false);
    // sha256(message) without the prefix is the 'sha256' variant, not 'sep53'.
    const bare = signer.sign(createHash('sha256').update(Buffer.from(message, 'utf8')).digest()).toString('base64');
    expect(verifyWalletSignature(address, message, bare)).toEqual({ ok: true, variant: 'sha256' });
  });

  it('accepts a hex-encoded signature too', () => {
    const sig = signer.sign(Buffer.from(message, 'utf8')).toString('hex');
    expect(verifyWalletSignature(address, message, sig)).toEqual({ ok: true, variant: 'raw' });
  });

  it('rejects a signature by another key', () => {
    const sig = other.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyWalletSignature(address, message, sig)).toEqual({
      ok: false,
      variant: null,
      reason: 'signature-mismatch',
    });
  });

  it('rejects a valid signature over a DIFFERENT message (nonce swapped)', () => {
    const sig = signer.sign(Buffer.from(message.replace('0123', 'ffff'), 'utf8')).toString('base64');
    expect(verifyWalletSignature(address, message, sig).ok).toBe(false);
  });

  it('rejects a valid signature presented for a different address', () => {
    const sig = signer.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyWalletSignature(other.publicKey(), message, sig).ok).toBe(false);
  });

  it('rejects an invalid address without touching the signature', () => {
    expect(verifyWalletSignature('not-an-address', message, 'AAAA')).toEqual({
      ok: false,
      variant: null,
      reason: 'invalid-address',
    });
    // A secret seed is not a public key either — never accepted as an address.
    expect(verifyWalletSignature(signer.secret(), message, 'AAAA').reason).toBe('invalid-address');
  });

  it('rejects malformed, empty or wrong-length signatures', () => {
    for (const bad of ['', '   ', 'not base64!!', 'AAAA', 'a'.repeat(127), Buffer.alloc(32).toString('base64')]) {
      expect(verifyWalletSignature(address, message, bad)).toEqual({
        ok: false,
        variant: null,
        reason: 'invalid-signature-encoding',
      });
    }
  });

  it('decodeSignature returns exactly 64 bytes for base64 and hex, null otherwise', () => {
    const raw = signer.sign(Buffer.from('x'));
    expect(decodeSignature(raw.toString('base64'))?.equals(raw)).toBe(true);
    expect(decodeSignature(raw.toString('hex'))?.equals(raw)).toBe(true);
    expect(decodeSignature(raw.subarray(0, 63).toString('base64'))).toBeNull();
    expect(decodeSignature(Buffer.concat([raw, Buffer.alloc(1)]).toString('base64'))).toBeNull();
  });
});
