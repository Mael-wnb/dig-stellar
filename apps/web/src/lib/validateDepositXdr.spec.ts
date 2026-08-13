import { describe, it, expect } from "vitest";
import {
  xdr,
  Address,
  Operation,
  Asset,
  Account,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  validateDepositXdr,
  validateWithdrawXdr,
  validateTrustlineXdr,
  SUPPLY_COLLATERAL,
  WITHDRAW_COLLATERAL,
  type DepositIntent,
  type WithdrawIntent,
  type TrustlineIntent,
} from "./validateDepositXdr";

// --- Fixtures -------------------------------------------------------------

// The user's own account (from / spender / to / source of a valid deposit).
const USER = "GALPCCZN4YXA3YMJHKL6CVIECKPLJJCTVMSNYWBTKJW4K5HQLYLDMZTB";
// A different account — used to prove a foreign from/spender/to/source is rejected.
const OTHER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// The mainnet Fixed pool + Circle USDC SAC (the real Lot A2 constants), and a
// look-alike wrong pool / wrong SAC to prove contract-pinning is enforced.
const POOL = "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";
const EVIL_POOL = "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";
const USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const EVIL_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"; // XLM SAC — wrong for a USDC deposit

// Circle's mainnet USDC classic issuer, and a look-alike issuer for the trustline gate.
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const EVIL_ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const USDC = new Asset("USDC", USDC_ISSUER);
const EVIL_USDC = new Asset("USDC", EVIL_ISSUER);

const PASSPHRASE = Networks.PUBLIC;

// A deposit of 12.345 USDC (decimals 7 → 123,450,000 in i128 units).
const AMOUNT_HUMAN = "12.345";
const AMOUNT_SCALED = 123_450_000n;

const baseIntent: DepositIntent = {
  sourceAccount: USER,
  poolId: POOL,
  assetSac: USDC_SAC,
  amount: AMOUNT_HUMAN,
  decimals: 7,
  networkPassphrase: PASSPHRASE,
};

const sym = (s: string) => xdr.ScVal.scvSymbol(s);

/** Builds one Blend Request struct as the ScVal map the pool contract emits. */
function requestScVal(sac: string, amount: bigint, requestType: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym("address"), val: new Address(sac).toScVal() }),
    new xdr.ScMapEntry({ key: sym("amount"), val: nativeToScVal(amount, { type: "i128" }) }),
    new xdr.ScMapEntry({ key: sym("request_type"), val: xdr.ScVal.scvU32(requestType) }),
  ]);
}

type DepositOpts = {
  pool?: string;
  from?: string;
  spender?: string;
  to?: string;
  sac?: string;
  amount?: bigint;
  requestType?: number;
  requests?: xdr.ScVal[]; // override the whole requests vec (e.g. 0 or 2 entries)
  fnName?: string;
  source?: string;
  passphrase?: string;
  fee?: string;
  extraOp?: boolean;
};

/** Builds a real, decodable Soroban invokeHostFunction(submit) deposit XDR. */
function buildDepositXdr(opts: DepositOpts = {}): string {
  const pool = opts.pool ?? POOL;
  const req = requestScVal(
    opts.sac ?? USDC_SAC,
    opts.amount ?? AMOUNT_SCALED,
    opts.requestType ?? SUPPLY_COLLATERAL,
  );
  const requests = opts.requests ?? [req];
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Address(pool).toScAddress(),
    functionName: opts.fnName ?? "submit",
    args: [
      new Address(opts.from ?? USER).toScVal(),
      new Address(opts.spender ?? USER).toScVal(),
      new Address(opts.to ?? USER).toScVal(),
      xdr.ScVal.scvVec(requests),
    ],
  });
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
  });

  const account = new Account(opts.source ?? USER, "100");
  const builder = new TransactionBuilder(account, {
    fee: opts.fee ?? BASE_FEE,
    networkPassphrase: opts.passphrase ?? PASSPHRASE,
  }).addOperation(op);

  if (opts.extraOp) {
    builder.addOperation(
      Operation.payment({ destination: OTHER, asset: Asset.native(), amount: "1" }),
    );
  }

  return builder.setTimeout(300).build().toXDR();
}

// --- Deposit: happy path --------------------------------------------------

describe("validateDepositXdr — happy path", () => {
  it("accepts a deposit XDR that exactly matches the intent", () => {
    expect(validateDepositXdr(buildDepositXdr(), baseIntent)).toEqual({ ok: true });
  });

  it("normalizes decimal formatting (12.345 == 12.3450000)", () => {
    const xdrStr = buildDepositXdr();
    expect(
      validateDepositXdr(xdrStr, { ...baseIntent, amount: "12.3450000" }),
    ).toEqual({ ok: true });
  });

  it("accepts an XLM deposit (native SAC + XLM intent)", () => {
    const xlmSac = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
    const xdrStr = buildDepositXdr({ sac: xlmSac });
    expect(validateDepositXdr(xdrStr, { ...baseIntent, assetSac: xlmSac })).toEqual({
      ok: true,
    });
  });
});

// --- Deposit: one failing test per invariant (table-driven) ---------------

type FailCase = {
  name: string;
  xdr: () => string;
  intent?: Partial<DepositIntent>;
  expect: string;
};

const failCases: FailCase[] = [
  { name: "unparseable XDR", xdr: () => "not-a-real-xdr", expect: "unparseable XDR" },
  {
    name: "unrecognized network passphrase",
    xdr: () => buildDepositXdr(),
    intent: { networkPassphrase: "Bogus Network ; January 2099" },
    expect: "unrecognized network passphrase",
  },
  {
    name: "wrong tx source account",
    xdr: () => buildDepositXdr({ source: OTHER }),
    expect: "source account mismatch",
  },
  {
    name: "wrong pool contract id (injection)",
    xdr: () => buildDepositXdr({ pool: EVIL_POOL }),
    expect: "pool contract mismatch",
  },
  {
    name: "wrong contract function name",
    xdr: () => buildDepositXdr({ fnName: "borrow" }),
    expect: 'expected "submit"',
  },
  {
    name: "wrong asset SAC (deposits a different reserve)",
    xdr: () => buildDepositXdr({ sac: EVIL_SAC }),
    expect: "request asset mismatch",
  },
  {
    name: "wrong request amount",
    xdr: () => buildDepositXdr({ amount: 999n }),
    expect: "request amount mismatch",
  },
  {
    name: "wrong request_type (not SupplyCollateral)",
    xdr: () => buildDepositXdr({ requestType: 4 /* Borrow */ }),
    expect: "request_type mismatch",
  },
  {
    name: "foreign `from` (takes on a position for another account)",
    xdr: () => buildDepositXdr({ from: OTHER }),
    expect: "from mismatch",
  },
  {
    name: "foreign `spender`",
    xdr: () => buildDepositXdr({ spender: OTHER }),
    expect: "spender mismatch",
  },
  {
    name: "foreign `to` (credits withdrawn tokens elsewhere)",
    xdr: () => buildDepositXdr({ to: OTHER }),
    expect: "to mismatch",
  },
  {
    name: "extra operation smuggled alongside the deposit",
    xdr: () => buildDepositXdr({ extraOp: true }),
    expect: "expected exactly 1 operation, found 2",
  },
  {
    name: "inflated fee (corrupted fee field)",
    // 3 XLM total — beyond the 2 XLM Soroban ceiling.
    xdr: () => buildDepositXdr({ fee: "30000000" }),
    expect: "fee exceeds cap",
  },
  {
    name: "zero requests",
    xdr: () => buildDepositXdr({ requests: [] }),
    expect: "expected exactly 1 request, found 0",
  },
  {
    name: "two requests (a second hidden action)",
    xdr: () =>
      buildDepositXdr({
        requests: [
          requestScVal(USDC_SAC, AMOUNT_SCALED, SUPPLY_COLLATERAL),
          requestScVal(USDC_SAC, AMOUNT_SCALED, 4 /* Borrow */),
        ],
      }),
    expect: "expected exactly 1 request, found 2",
  },
];

describe("validateDepositXdr — violations", () => {
  for (const c of failCases) {
    it(c.name, () => {
      const intent = { ...baseIntent, ...c.intent };
      const result = validateDepositXdr(c.xdr(), intent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes(c.expect))).toBe(true);
      }
    });
  }

  it("collects MULTIPLE violations at once (does not short-circuit)", () => {
    // Wrong pool, wrong SAC, wrong amount, and foreign `to` in one tx.
    const xdrStr = buildDepositXdr({
      pool: EVIL_POOL,
      sac: EVIL_SAC,
      amount: 1n,
      to: OTHER,
    });
    const result = validateDepositXdr(xdrStr, baseIntent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
      expect(result.violations.some((v) => v.includes("pool contract mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("request asset mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("request amount mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("to mismatch"))).toBe(true);
    }
  });
});

// --- Withdraw (Lot A3) ----------------------------------------------------
//
// Same envelope shape as the deposit; the ONLY difference is request_type
// (WithdrawCollateral=3 vs SupplyCollateral=2). Every deposit invariant is
// re-asserted here because the two gates are independent entry points, plus the
// cross-type pair that proves neither gate accepts the other's transaction.

/** Builds a real Soroban submit XDR whose single request is a WithdrawCollateral. */
function buildWithdrawXdr(opts: DepositOpts = {}): string {
  return buildDepositXdr({
    ...opts,
    requestType: opts.requestType ?? WITHDRAW_COLLATERAL,
  });
}

const withdrawIntent: WithdrawIntent = { ...baseIntent };

describe("validateWithdrawXdr — happy path", () => {
  it("accepts a withdraw XDR that exactly matches the intent", () => {
    expect(validateWithdrawXdr(buildWithdrawXdr(), withdrawIntent)).toEqual({ ok: true });
  });

  it("accepts an XLM withdraw (native SAC + XLM intent)", () => {
    const xlmSac = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
    const xdrStr = buildWithdrawXdr({ sac: xlmSac });
    expect(validateWithdrawXdr(xdrStr, { ...withdrawIntent, assetSac: xlmSac })).toEqual({
      ok: true,
    });
  });

  it("normalizes decimal formatting (12.345 == 12.3450000)", () => {
    expect(
      validateWithdrawXdr(buildWithdrawXdr(), { ...withdrawIntent, amount: "12.3450000" }),
    ).toEqual({ ok: true });
  });
});

const withdrawFailCases: FailCase[] = [
  { name: "unparseable XDR", xdr: () => "not-a-real-xdr", expect: "unparseable XDR" },
  {
    name: "unrecognized network passphrase",
    xdr: () => buildWithdrawXdr(),
    intent: { networkPassphrase: "Bogus Network ; January 2099" },
    expect: "unrecognized network passphrase",
  },
  {
    name: "wrong tx source account",
    xdr: () => buildWithdrawXdr({ source: OTHER }),
    expect: "source account mismatch",
  },
  {
    name: "wrong pool contract id (injection)",
    xdr: () => buildWithdrawXdr({ pool: EVIL_POOL }),
    expect: "pool contract mismatch",
  },
  {
    name: "wrong contract function name",
    xdr: () => buildWithdrawXdr({ fnName: "borrow" }),
    expect: 'expected "submit"',
  },
  {
    name: "wrong asset SAC (withdraws a different reserve)",
    xdr: () => buildWithdrawXdr({ sac: EVIL_SAC }),
    expect: "request asset mismatch",
  },
  {
    name: "wrong request amount (withdraws more than the user asked for)",
    xdr: () => buildWithdrawXdr({ amount: 999_999_999_999n }),
    expect: "request amount mismatch",
  },
  {
    name: "request_type Withdraw (1) — unwinds a NON-collateral supply, not our position",
    xdr: () => buildWithdrawXdr({ requestType: 1 }),
    expect: "request_type mismatch",
  },
  {
    name: "request_type Borrow (4) smuggled under the withdraw",
    xdr: () => buildWithdrawXdr({ requestType: 4 }),
    expect: "request_type mismatch",
  },
  {
    name: "foreign `from` (withdraws from another account's position)",
    xdr: () => buildWithdrawXdr({ from: OTHER }),
    expect: "from mismatch",
  },
  {
    name: "foreign `spender`",
    xdr: () => buildWithdrawXdr({ spender: OTHER }),
    expect: "spender mismatch",
  },
  {
    name: "foreign `to` (sends the withdrawn funds to an attacker)",
    xdr: () => buildWithdrawXdr({ to: OTHER }),
    expect: "to mismatch",
  },
  {
    name: "extra operation smuggled alongside the withdraw",
    xdr: () => buildWithdrawXdr({ extraOp: true }),
    expect: "expected exactly 1 operation, found 2",
  },
  {
    name: "inflated fee (corrupted fee field)",
    xdr: () => buildWithdrawXdr({ fee: "30000000" }),
    expect: "fee exceeds cap",
  },
  {
    name: "zero requests",
    xdr: () => buildWithdrawXdr({ requests: [] }),
    expect: "expected exactly 1 request, found 0",
  },
  {
    name: "two requests (withdraw + a hidden borrow)",
    xdr: () =>
      buildWithdrawXdr({
        requests: [
          requestScVal(USDC_SAC, AMOUNT_SCALED, WITHDRAW_COLLATERAL),
          requestScVal(USDC_SAC, AMOUNT_SCALED, 4 /* Borrow */),
        ],
      }),
    expect: "expected exactly 1 request, found 2",
  },
];

describe("validateWithdrawXdr — violations", () => {
  for (const c of withdrawFailCases) {
    it(c.name, () => {
      const intent = { ...withdrawIntent, ...c.intent };
      const result = validateWithdrawXdr(c.xdr(), intent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes(c.expect))).toBe(true);
      }
    });
  }

  it("collects MULTIPLE violations at once (does not short-circuit)", () => {
    const xdrStr = buildWithdrawXdr({
      pool: EVIL_POOL,
      sac: EVIL_SAC,
      amount: 1n,
      to: OTHER,
    });
    const result = validateWithdrawXdr(xdrStr, withdrawIntent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
      expect(result.violations.some((v) => v.includes("pool contract mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("request asset mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("request amount mismatch"))).toBe(true);
      expect(result.violations.some((v) => v.includes("to mismatch"))).toBe(true);
    }
  });
});

// --- Cross-type: the two gates must NEVER accept each other's transaction ---
//
// The critical pair. Everything else about these envelopes is identical and valid
// (same pool, same SAC, same amount, same account) — only request_type differs, so
// nothing but the pinned request type can be rejecting them.

describe("deposit ↔ withdraw cross-type rejection", () => {
  it("a SupplyCollateral (deposit) XDR FAILS the withdraw gate", () => {
    const result = validateWithdrawXdr(buildDepositXdr(), withdrawIntent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.includes(`request_type mismatch: expected WithdrawCollateral (${WITHDRAW_COLLATERAL}), got ${SUPPLY_COLLATERAL}`),
        ),
      ).toBe(true);
    }
  });

  it("a WithdrawCollateral (withdraw) XDR FAILS the deposit gate", () => {
    const result = validateDepositXdr(buildWithdrawXdr(), baseIntent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.includes(`request_type mismatch: expected SupplyCollateral (${SUPPLY_COLLATERAL}), got ${WITHDRAW_COLLATERAL}`),
        ),
      ).toBe(true);
    }
  });

  it("the pinned request types are the SDK's values and are distinct", () => {
    // Canary: @blend-capital/blend-sdk pool enum — Supply=0, Withdraw=1,
    // SupplyCollateral=2, WithdrawCollateral=3. If either constant drifts, the
    // cross-type property above silently collapses.
    expect(SUPPLY_COLLATERAL).toBe(2);
    expect(WITHDRAW_COLLATERAL).toBe(3);
    expect(SUPPLY_COLLATERAL).not.toBe(WITHDRAW_COLLATERAL);
  });
});

// --- Trustline: happy path + violations -----------------------------------

/** Builds a real single-op ChangeTrust XDR for the given asset. */
function buildTrustlineXdr(
  asset: Asset,
  opts: { source?: string; passphrase?: string; fee?: string; extraOp?: boolean } = {},
): string {
  const account = new Account(opts.source ?? USER, "100");
  const builder = new TransactionBuilder(account, {
    fee: opts.fee ?? BASE_FEE,
    networkPassphrase: opts.passphrase ?? PASSPHRASE,
  }).addOperation(Operation.changeTrust({ asset }));
  if (opts.extraOp) {
    builder.addOperation(
      Operation.payment({ destination: OTHER, asset: Asset.native(), amount: "1" }),
    );
  }
  return builder.setTimeout(300).build().toXDR();
}

const trustlineIntent: TrustlineIntent = {
  sourceAccount: USER,
  asset: { code: "USDC", issuer: USDC_ISSUER },
  networkPassphrase: PASSPHRASE,
};

describe("validateTrustlineXdr", () => {
  it("accepts a single ChangeTrust for exactly the expected USDC", () => {
    expect(validateTrustlineXdr(buildTrustlineXdr(USDC), trustlineIntent)).toEqual({
      ok: true,
    });
  });

  it("rejects a ChangeTrust for a look-alike issuer (wrong-issuer attack)", () => {
    const result = validateTrustlineXdr(buildTrustlineXdr(EVIL_USDC), trustlineIntent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("changeTrust asset mismatch"))).toBe(true);
    }
  });

  it("rejects a ChangeTrust for a different code", () => {
    const result = validateTrustlineXdr(
      buildTrustlineXdr(new Asset("EURC", USDC_ISSUER)),
      trustlineIntent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("changeTrust asset mismatch"))).toBe(true);
    }
  });

  it("rejects a foreign tx source", () => {
    const result = validateTrustlineXdr(
      buildTrustlineXdr(USDC, { source: OTHER }),
      trustlineIntent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("source account mismatch"))).toBe(true);
    }
  });

  it("rejects an extra operation smuggled alongside the trustline", () => {
    const result = validateTrustlineXdr(
      buildTrustlineXdr(USDC, { extraOp: true }),
      trustlineIntent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("expected exactly 1 operation, found 2"))).toBe(true);
    }
  });

  it("rejects an inflated classic fee (> 0.01 XLM)", () => {
    const result = validateTrustlineXdr(
      buildTrustlineXdr(USDC, { fee: "200000" }),
      trustlineIntent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("fee exceeds cap"))).toBe(true);
    }
  });

  it("rejects an unrecognized network passphrase", () => {
    const result = validateTrustlineXdr(buildTrustlineXdr(USDC), {
      ...trustlineIntent,
      networkPassphrase: "Bogus Network ; January 2099",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("unrecognized network passphrase"))).toBe(true);
    }
  });
});
