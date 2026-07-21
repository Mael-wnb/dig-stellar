import { describe, it, expect } from 'vitest'
import {
  TransactionBuilder,
  Operation,
  Asset,
  Account,
  Networks,
  BASE_FEE,
  Keypair,
} from '@stellar/stellar-sdk'
import { validateSwapXdr, type SwapIntent } from './validateSwapXdr'

// --- Fixtures -------------------------------------------------------------

// The user's own account (source + destination of a valid swap).
const USER = 'GALPCCZN4YXA3YMJHKL6CVIECKPLJJCTVMSNYWBTKJW4K5HQLYLDMZTB'
// A different account — used to prove foreign source/destination is rejected.
const OTHER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

// The SDEX USDC used by the swap action (Circle testnet issuer), and a look-alike
// USDC with a DIFFERENT issuer to prove the wrong-issuer attack is caught.
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const EVIL_ISSUER = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56'
const USDC = new Asset('USDC', USDC_ISSUER)
const EVIL_USDC = new Asset('USDC', EVIL_ISSUER)

const PASSPHRASE = Networks.TESTNET

// Intent that mirrors a real XLM -> USDC swap of 10.5 XLM, min 9.5 USDC.
const baseIntent: SwapIntent = {
  sourceAccount: USER,
  sendAsset: 'native',
  sendAmount: '10.5',
  destAsset: { code: 'USDC', issuer: USDC_ISSUER },
  destMin: '9.5',
  networkPassphrase: PASSPHRASE,
}

type PPSSFields = Parameters<typeof Operation.pathPaymentStrictSend>[0]

/** Builds a real, decodable single-op PathPaymentStrictSend XDR. */
function buildSwapXdr(
  overrides: Partial<PPSSFields> = {},
  opts: { source?: string; passphrase?: string; extraOp?: boolean } = {},
): string {
  const account = new Account(opts.source ?? USER, '100')
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.passphrase ?? PASSPHRASE,
  })

  if (opts.extraOp) {
    // A hidden second op (changeTrust) that must trip the "exactly one op" guard.
    builder.addOperation(Operation.changeTrust({ asset: USDC }))
  }

  builder.addOperation(
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: '10.5',
      destination: USER,
      destAsset: USDC,
      destMin: '9.5',
      path: [],
      ...overrides,
    }),
  )

  return builder.setTimeout(300).build().toXDR()
}

/** Builds a real single-op tx with a NON-PathPaymentStrictSend op (payment). */
function buildPaymentXdr(): string {
  const account = new Account(USER, '100')
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.payment({ destination: USER, asset: USDC, amount: '10' }),
    )
    .setTimeout(300)
    .build()
    .toXDR()
}

// --- Happy path -----------------------------------------------------------

describe('validateSwapXdr — happy path', () => {
  it('accepts an XDR that exactly matches the intent', () => {
    const xdr = buildSwapXdr()
    expect(validateSwapXdr(xdr, baseIntent)).toEqual({ ok: true })
  })

  it('accepts destMin strictly greater than the accepted minimum', () => {
    // On-chain min 9.6 >= accepted 9.5 → better for the user, allowed.
    const xdr = buildSwapXdr({ destMin: '9.6' })
    expect(validateSwapXdr(xdr, baseIntent)).toEqual({ ok: true })
  })

  it('normalizes decimal formatting (10.5 == 10.5000000)', () => {
    const xdr = buildSwapXdr()
    expect(validateSwapXdr(xdr, { ...baseIntent, sendAmount: '10.5000000' })).toEqual({
      ok: true,
    })
  })
})

// --- One failing test per violation (table-driven) ------------------------

type FailCase = {
  name: string
  xdr: () => string
  intent?: Partial<SwapIntent>
  expect: string // substring that must appear in the violations
}

const failCases: FailCase[] = [
  {
    name: 'unparseable XDR',
    xdr: () => 'not-a-real-xdr',
    expect: 'unparseable XDR',
  },
  {
    name: 'wrong network passphrase (unrecognized)',
    xdr: () => buildSwapXdr(),
    intent: { networkPassphrase: 'Bogus Network ; January 2099' },
    expect: 'unrecognized network passphrase',
  },
  {
    name: 'wrong source account',
    xdr: () => buildSwapXdr({}, { source: OTHER }),
    // destination stays USER by default; only the tx source is foreign.
    expect: 'source account mismatch',
  },
  {
    name: 'two operations (hidden extra op)',
    xdr: () => buildSwapXdr({}, { extraOp: true }),
    expect: 'expected exactly 1 operation, found 2',
  },
  {
    name: 'wrong operation type',
    xdr: () => buildPaymentXdr(),
    expect: 'no pathPaymentStrictSend operation',
  },
  {
    name: 'wrong sendAsset code',
    xdr: () => buildSwapXdr({ sendAsset: USDC, destAsset: Asset.native() }),
    // Intent still says sold=native, so the built sendAsset=USDC mismatches.
    expect: 'sendAsset mismatch',
  },
  {
    name: 'wrong sendAsset ISSUER (look-alike token attack)',
    // Build with the evil USDC issuer but keep code "USDC"; intent expects native
    // sold and USDC bought, so we instead exercise the issuer check on destAsset
    // below — here we flip send to the evil USDC to prove issuer sensitivity.
    xdr: () => buildSwapXdr({ sendAsset: EVIL_USDC, destAsset: Asset.native() }),
    intent: { sendAsset: { code: 'USDC', issuer: USDC_ISSUER }, destAsset: 'native' },
    expect: 'sendAsset mismatch',
  },
  {
    name: 'wrong destAsset ISSUER (look-alike token attack)',
    xdr: () => buildSwapXdr({ destAsset: EVIL_USDC }),
    // Same code "USDC", wrong issuer — must be flagged.
    expect: 'destAsset mismatch',
  },
  {
    name: 'wrong sendAmount',
    xdr: () => buildSwapXdr({ sendAmount: '999.0' }),
    expect: 'sendAmount mismatch',
  },
  {
    name: 'destMin lower than accepted (worse slippage)',
    xdr: () => buildSwapXdr({ destMin: '1.0' }),
    // On-chain min 1.0 < accepted 9.5 → worse for the user.
    expect: 'destMin below accepted minimum',
  },
  {
    name: 'destination is not the user',
    xdr: () => buildSwapXdr({ destination: OTHER }),
    expect: 'destination mismatch',
  },
]

describe('validateSwapXdr — violations', () => {
  for (const c of failCases) {
    it(c.name, () => {
      const intent = { ...baseIntent, ...c.intent }
      const result = validateSwapXdr(c.xdr(), intent)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes(c.expect))).toBe(true)
      }
    })
  }

  it('collects ALL violations at once (does not short-circuit)', () => {
    // Wrong sendAmount, wrong destMin, and wrong destination in one tx.
    const xdr = buildSwapXdr({ sendAmount: '1.0', destMin: '0.1', destination: OTHER })
    const result = validateSwapXdr(xdr, baseIntent)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(3)
      expect(result.violations.some((v) => v.includes('sendAmount mismatch'))).toBe(true)
      expect(result.violations.some((v) => v.includes('destMin below'))).toBe(true)
      expect(result.violations.some((v) => v.includes('destination mismatch'))).toBe(true)
    }
  })
})

// --- Optional trustline op (first-time swap into a new asset) --------------

/** Builds a 2-op tx: ChangeTrust(asset) then the standard PathPaymentStrictSend. */
function buildSwapWithTrustlineXdr(trustAsset: Asset): string {
  const account = new Account(USER, '100')
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: trustAsset }))
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount: '10.5',
        destination: USER,
        destAsset: USDC,
        destMin: '9.5',
        path: [],
      }),
    )
    .setTimeout(300)
    .build()
    .toXDR()
}

describe('validateSwapXdr — optional trustline op', () => {
  it('accepts a leading ChangeTrust for the dest asset when allowTrustlineFor is set', () => {
    const xdr = buildSwapWithTrustlineXdr(USDC)
    const intent: SwapIntent = {
      ...baseIntent,
      allowTrustlineFor: { code: 'USDC', issuer: USDC_ISSUER },
    }
    expect(validateSwapXdr(xdr, intent)).toEqual({ ok: true })
  })

  it('still rejects the extra op when allowTrustlineFor is NOT set', () => {
    const xdr = buildSwapWithTrustlineXdr(USDC)
    const result = validateSwapXdr(xdr, baseIntent)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.violations.some((v) => v.includes('expected exactly 1 operation, found 2')),
      ).toBe(true)
    }
  })

  it('rejects a ChangeTrust for a DIFFERENT asset than the dest asset', () => {
    // Permit only USDC trustlines, but the tx trusts the evil-issuer look-alike.
    const xdr = buildSwapWithTrustlineXdr(EVIL_USDC)
    const intent: SwapIntent = {
      ...baseIntent,
      allowTrustlineFor: { code: 'USDC', issuer: USDC_ISSUER },
    }
    const result = validateSwapXdr(xdr, intent)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes('changeTrust asset mismatch'))).toBe(true)
    }
  })

  it('rejects a non-trustline extra op even when allowTrustlineFor is set', () => {
    // A hidden payment op sneaks in alongside the swap; the trustline exception
    // must not widen to arbitrary ops.
    const account = new Account(USER, '100')
    const xdr = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.payment({ destination: OTHER, asset: USDC, amount: '1' }))
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: Asset.native(),
          sendAmount: '10.5',
          destination: USER,
          destAsset: USDC,
          destMin: '9.5',
          path: [],
        }),
      )
      .setTimeout(300)
      .build()
      .toXDR()
    const intent: SwapIntent = {
      ...baseIntent,
      allowTrustlineFor: { code: 'USDC', issuer: USDC_ISSUER },
    }
    const result = validateSwapXdr(xdr, intent)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes('unexpected operation'))).toBe(true)
    }
  })
})

// Sanity: Keypair import proves the SDK surface used to mint fixtures is present
// (kept minimal — no signing happens in the pure validator).
describe('fixtures', () => {
  it('SDK fixture helpers are available', () => {
    expect(typeof Keypair.random).toBe('function')
  })
})
