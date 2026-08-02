# Mainnet SDEX Pair Vetting — 2026-08-01

Claim evidence for **T3-D2** (mainnet swaps + adoption KPIs) / **Lot A1b** (pair expansion).
This is the security story behind the Mainnet asset whitelist (INV-4.3): every offered pair is
vetted by **on-chain reality** (direct order-book fills both directions at the launch cap within
the widget's 5% slippage tolerance) **and** by **human-grade issuer verification** (never from
memory). A displayed pair that fails on-chain — or a look-alike token with a seeded book — is
worse than no pair.

## Method

- Tool: `tools/probe-mainnet-pairs.mjs` (no deps, Node 20, Horizon Pubnet).
- Oracle: `GET horizon.stellar.org/paths/strict-send`, **DIRECT routes only** (empty path) — the
  same oracle the backend `/v1/actions/sdex/quote` uses and the same shape the swap op fills.
- Probed each candidate **XLM→asset AND asset→XLM**, at **10 XLM** (small retail) and **100 XLM**
  (the `ACTIONS_MAINNET_MAX_SEND_XLM` launch cap).
- Verdict per direction: **PASS** = both sizes route AND cap-size rate ≥ 95% of small-size rate
  (≤5% depth degradation); **THIN** = routes exist but degradation > 5%; **FAIL** = no direct
  route at one size.
- Discovery: top-25 Pubnet assets by 7-day volume via stellar.expert. The stellar.expert `asset`
  field shape has drifted to `CODE-ISSUER-N` (a trailing numeric type suffix), but the probe's
  `const [code, issuer] = parts` destructuring takes the first two segments and asset codes never
  contain `-`, so discovery still parses correctly — **no tool change was needed**.

## Probe results (raw stdout table)

`node tools/probe-mainnet-pairs.mjs --top 25` — home_domain shown is Horizon's `home_domain`
(falling back to the `_links.toml.href`).

| Asset | Issuer | home_domain | XLM→asset | deg% | asset→XLM | deg% |
| USDC | GA5ZSEJY… | https://circle.com/.well-known/stellar.toml | PASS | 0.00 | PASS | 0.00 |
| USDCAllow | GDIEKKIQ… | https://circle.com/.well-known/stellar.toml | FAIL | — | SKIP | — |
| SHX | GDSTRSHX… | https://stronghold.co/.well-known/stellar.toml | PASS | -0.00 | PASS | 0.00 |
| XRP | GBXRPL45… | https://fchain.io/.well-known/stellar.toml | PASS | 0.01 | PASS | 0.01 |
| yXLM | GARDNV3Q… | https://ultracapital.xyz/.well-known/stellar.toml | PASS | 0.00 | PASS | -0.00 |
| AQUA | GBNZILST… | https://aqua.network/.well-known/stellar.toml | PASS | 0.02 | PASS | 0.02 |
| GRG | GBIZ3FSD… | https://grg.xmint.io/.well-known/stellar.toml | THIN | 5.17 | FAIL | — |
| VELO | GDM4RQUQ… | — | PASS | 0.00 | PASS | -0.00 |
| EURC | GDHU6WRG… | https://circle.com/.well-known/stellar.toml | PASS | 0.14 | PASS | 0.01 |
| PYUSD | GDQE7IXJ… | https://token-metadata.paxos.com/.well-known/stellar.toml | PASS | 0.00 | PASS | -0.00 |
| CETES | GCRYUGD5… | https://etherfuse.com/.well-known/stellar.toml | THIN | 22.16 | THIN | 17.18 |
| sUSD | GCHW7CWI… | https://synt.tech/.well-known/stellar.toml | PASS | 0.00 | PASS | 0.49 |
| SCOP | GC6OYQJI… | https://scopuly.com/.well-known/stellar.toml | PASS | 0.71 | PASS | -0.00 |
| yUSDC | GDGTVWSM… | https://ultracapital.xyz/.well-known/stellar.toml | PASS | 0.45 | PASS | 0.45 |
| MINT | GB766ZL2… | https://mint.xmint.io/.well-known/stellar.toml | PASS | -0.00 | PASS | -0.00 |
| BTC | GDPJALI4… | https://ultracapital.xyz/.well-known/stellar.toml | PASS | 0.00 | PASS | 0.02 |
| ETH | GBFXOHVA… | https://ultracapital.xyz/.well-known/stellar.toml | PASS | 0.04 | PASS | 0.05 |
| USDV | GBLAJOKB… | https://valtorum.com/.well-known/stellar.toml | FAIL | — | SKIP | — |
| SSLX | GBHFGY3Z… | https://sslx.sl8.online/.well-known/stellar.toml | PASS | 0.09 | PASS | 0.09 |
| AFR | GBX6YI45… | https://afreum.com/.well-known/stellar.toml | PASS | 0.17 | PASS | 0.12 |
| MJQ | GBZCL2R7… | https://mj-q.com/.well-known/stellar.toml | PASS | 0.00 | PASS | 0.67 |
| RIPPLEMINT | GBGVV42A… | https://ripplemint.org/.well-known/stellar.toml | PASS | 0.00 | PASS | 0.00 |
| BTCLN | GDPKQ2TS… | https://kbtrading.org/.well-known/stellar.toml | PASS | 0.02 | PASS | 0.02 |

## Step 2 — Issuer verification (human-grade, per PASS candidate)

Liquidity alone NEVER whitelists an asset. For each finalist the issuer was verified
**bidirectionally**: the asset's `home_domain` must resolve to a `stellar.toml` that itself
**declares that exact issuer + code** (the check behind stellar.expert's domain badge), and Circle
assets were additionally cross-checked against Circle's **official contract-addresses docs**.

| Asset | Issuer | Domain | Verification | Result |
|---|---|---|---|---|
| USDC  | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | circle.com | Circle official `usdc-contract-addresses` doc | ✅ verified |
| EURC  | `GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2` | circle.com | Circle official `eurc-contract-addresses` doc | ✅ verified |
| AQUA  | `GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA` | aqua.network | issuer declared in `aqua.network/.well-known/stellar.toml` | ✅ verified |
| yXLM  | `GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55` | ultracapital.xyz | issuer declared in `ultracapital.xyz/.well-known/stellar.toml` | ✅ verified |
| PYUSD | `GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5` | token-metadata.paxos.com | issuer declared in Paxos `stellar.toml` | ✅ verified |

Note: `circle.com/.well-known/stellar.toml` returns an HTML error (Circle does not serve a public
TOML there); Circle assets are therefore verified against Circle's official docs, which is the
authoritative source for Circle issuers anyway.

## Step 3 — Selection (both directions PASS + issuer verified)

**Offered at launch (5 pairs, XLM as one leg of each):**

| Pair | XLM→asset deg | asset→XLM deg | 10 XLM → out | 100 XLM → out | Why |
|---|---|---|---|---|---|
| XLM↔USDC  | 0.00% | 0.00%  | 1.7017204 USDC  | 17.0172004 USDC  | Circle USDC, deepest book (already live) |
| XLM↔EURC  | 0.14% | 0.01%  | 1.4764979 EURC  | 14.7447628 EURC  | Circle EURC (euro stablecoin) |
| XLM↔AQUA  | 0.02% | 0.02%  | 5086.24 AQUA    | 50854.01 AQUA    | Aquarius governance, deep native book |
| XLM↔yXLM  | 0.00% | 0.00%  | 10.0135173 yXLM | 100.1343405 yXLM | Ultra Capital yield-XLM, ~1:1 |
| XLM↔PYUSD | 0.00% | 0.00%  | 1.7008377 PYUSD | 17.0083770 PYUSD | PayPal USD (Paxos) |

All five clear the acceptance bar in **both** directions and are issuer-verified. The widget's
invert button covers the reverse direction; every reverse book here also PASSes at cap size.

**Rejected (negative checks — the reason INV-4.3 exists):**

| Asset | Book | Reason rejected |
|---|---|---|
| XRP        | both PASS | Issuer domain `fchain.io` is **not Ripple** — a look-alike ticker with an unaffiliated third-party issuer. Deep seeded book is exactly the attack the whitelist defends against. |
| VELO       | both PASS | **No home_domain** → issuer unverifiable. Liquidity cannot substitute for verification. |
| USDCAllow  | FAIL      | Restricted allow-list Circle variant; not a fillable/spendable swap asset. |
| GRG        | THIN/FAIL | Cap-size degradation 5.17% fwd / no reverse route — fails the depth bar. |
| CETES      | THIN      | 22% / 17% cap-size degradation — bad UX at cap size. |
| BTC, ETH   | both PASS | ultracapital.xyz wrapped majors — domain-verified but **held back** at launch (prefer native + stablecoins; addable later as one whitelist line each). |
| yUSDC, SHX | both PASS | Domain-verified survivors (ultracapital.xyz / stronghold.co) **held out only for launch-set clarity** — addable as one line each. |
| sUSD, SCOP, MINT, SSLX, AFR, MJQ, RIPPLEMINT, BTCLN | mixed | Obscure / low-credibility issuers; not offered. |

## Outcome — code changes (Lot A1b Step 4)

- `apps/api/.../network-registry.ts` — hardcoded XLM+USDC check generalized to
  `MAINNET_ASSET_WHITELIST: ReadonlyArray<{code, issuer}>` (the 5 pairs above); issuer-less legacy
  `'USDC'` still resolves to Circle; `isWhitelistedMainnetAsset` matches code AND issuer.
- `apps/web/src/config/mainnetSwapPairs.ts` — one `MAINNET_SWAP_PAIRS` entry per vetted pair with
  this evidence inline; `MAINNET_SWAP_ASSETS` derives automatically. Cross-referenced both ways
  with the API whitelist.
- A1 review nit folded in: the over-cap error now names the actual send asset
  (`cap of ${cap} ${from.code}`), not a hardcoded "XLM".

**Flags unset = byte-for-byte current behavior** (testnet untouched; Mainnet still 403 behind
`ACTIONS_MAINNET_ENABLED`). This report is the on-chain + issuer evidence for that whitelist.

## Full probe output (JSON)

```json
[
  {
    "code": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "expertDomain": "circle.com",
    "homeDomain": "https://circle.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.170172",
      "rateLarge": "0.170172",
      "degradationPct": "0.00",
      "smallOut": "1.7017204",
      "largeOut": "17.0172004"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "5.86957",
      "rateLarge": "5.86953",
      "degradationPct": "0.00",
      "smallOut": "9.9883627",
      "largeOut": "99.8829102"
    }
  },
  {
    "code": "USDCAllow",
    "issuer": "GDIEKKIQWMIZ4LD3RP3ABPN7X5KEAEWYMR634BRHB7EULIMEVREWLF3G",
    "expertDomain": "",
    "homeDomain": "https://circle.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "FAIL",
      "reason": "no direct route (small)"
    },
    "assetToXlm": {
      "verdict": "SKIP",
      "reason": "forward failed"
    }
  },
  {
    "code": "SHX",
    "issuer": "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH",
    "expertDomain": "stronghold.co",
    "homeDomain": "https://stronghold.co/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "48.9237",
      "rateLarge": "48.9237",
      "degradationPct": "-0.00",
      "smallOut": "489.2367906",
      "largeOut": "4892.3679060"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.0204228",
      "rateLarge": "0.0204218",
      "degradationPct": "0.00",
      "smallOut": "9.9915671",
      "largeOut": "99.9108106"
    }
  },
  {
    "code": "XRP",
    "issuer": "GBXRPL45NPHCVMFFAYZVUVFFVKSIZ362ZXFP7I2ETNQ3QKZMFLPRDTD5",
    "expertDomain": "fchain.io",
    "homeDomain": "https://fchain.io/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.161044",
      "rateLarge": "0.161024",
      "degradationPct": "0.01",
      "smallOut": "1.6104369",
      "largeOut": "16.1023543"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "6.19709",
      "rateLarge": "6.19632",
      "degradationPct": "0.01",
      "smallOut": "9.9800197",
      "largeOut": "99.7752799"
    }
  },
  {
    "code": "yXLM",
    "issuer": "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
    "expertDomain": "ultracapital.xyz",
    "homeDomain": "https://ultracapital.xyz/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "1.00135",
      "rateLarge": "1.00134",
      "degradationPct": "0.00",
      "smallOut": "10.0135173",
      "largeOut": "100.1343405"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.998506",
      "rateLarge": "0.998506",
      "degradationPct": "-0.00",
      "smallOut": "9.9985614",
      "largeOut": "99.9847832"
    }
  },
  {
    "code": "AQUA",
    "issuer": "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA",
    "expertDomain": "aqua.network",
    "homeDomain": "https://aqua.network/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "508.624",
      "rateLarge": "508.540",
      "degradationPct": "0.02",
      "smallOut": "5086.2416719",
      "largeOut": "50854.0148283"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.00195424",
      "rateLarge": "0.00195392",
      "degradationPct": "0.02",
      "smallOut": "9.9397256",
      "largeOut": "99.3644734"
    }
  },
  {
    "code": "GRG",
    "issuer": "GBIZ3FSDKQNAW6XECZVOP7RNGJS6I7SM3YD4WEY4YG7S6S54CGEZ7N4W",
    "expertDomain": "grg.xmint.io",
    "homeDomain": "https://grg.xmint.io/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "THIN",
      "rateSmall": "2.50000e+8",
      "rateLarge": "2.37071e+8",
      "degradationPct": "5.17",
      "smallOut": "2500000910.0000000",
      "largeOut": "23707096709.6415611"
    },
    "assetToXlm": {
      "verdict": "FAIL",
      "reason": "no direct route (cap size)"
    }
  },
  {
    "code": "VELO",
    "issuer": "GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M",
    "expertDomain": "",
    "homeDomain": "",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "47.6217",
      "rateLarge": "47.6215",
      "degradationPct": "0.00",
      "smallOut": "476.2165831",
      "largeOut": "4762.1479901"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.0209951",
      "rateLarge": "0.0209951",
      "degradationPct": "-0.00",
      "smallOut": "9.9982147",
      "largeOut": "99.9817732"
    }
  },
  {
    "code": "EURC",
    "issuer": "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
    "expertDomain": "circle.com",
    "homeDomain": "https://circle.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.147650",
      "rateLarge": "0.147448",
      "degradationPct": "0.14",
      "smallOut": "1.4764979",
      "largeOut": "14.7447628"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "6.76793",
      "rateLarge": "6.76696",
      "degradationPct": "0.01",
      "smallOut": "9.9928282",
      "largeOut": "99.7772026"
    }
  },
  {
    "code": "PYUSD",
    "issuer": "GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5",
    "expertDomain": "token-metadata.paxos.com",
    "homeDomain": "https://token-metadata.paxos.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.170084",
      "rateLarge": "0.170084",
      "degradationPct": "0.00",
      "smallOut": "1.7008377",
      "largeOut": "17.0083770"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "5.86184",
      "rateLarge": "5.86184",
      "degradationPct": "-0.00",
      "smallOut": "9.9700449",
      "largeOut": "99.7004490"
    }
  },
  {
    "code": "CETES",
    "issuer": "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC",
    "expertDomain": "etherfuse.com",
    "homeDomain": "https://etherfuse.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "THIN",
      "rateSmall": "2.41878",
      "rateLarge": "1.88282",
      "degradationPct": "22.16",
      "smallOut": "24.1877840",
      "largeOut": "188.2817392"
    },
    "assetToXlm": {
      "verdict": "THIN",
      "rateSmall": "0.385791",
      "rateLarge": "0.319525",
      "degradationPct": "17.18",
      "smallOut": "9.3314403",
      "largeOut": "60.1606808"
    }
  },
  {
    "code": "sUSD",
    "issuer": "GCHW7CWI7GMIYQYFXMFJNJX5645XGWIINIAEQK3SABQO6CAYL5T7JYIH",
    "expertDomain": "synt.tech",
    "homeDomain": "https://synt.tech/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.169523",
      "rateLarge": "0.169523",
      "degradationPct": "0.00",
      "smallOut": "1.6952330",
      "largeOut": "16.9523300"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "5.79872",
      "rateLarge": "5.77037",
      "degradationPct": "0.49",
      "smallOut": "9.8301737",
      "largeOut": "97.8211995"
    }
  },
  {
    "code": "SCOP",
    "issuer": "GC6OYQJIZF3HFXCYPFCBXYXNGIBQ4TNSFUBUXQJOZWIP6F3YZK4QH3VQ",
    "expertDomain": "scopuly.com",
    "homeDomain": "https://scopuly.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "78.6455",
      "rateLarge": "78.0899",
      "degradationPct": "0.71",
      "smallOut": "786.4547643",
      "largeOut": "7808.9860216"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.0127325",
      "rateLarge": "0.0127325",
      "degradationPct": "-0.00",
      "smallOut": "10.0135352",
      "largeOut": "99.4279145"
    }
  },
  {
    "code": "yUSDC",
    "issuer": "GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF",
    "expertDomain": "ultracapital.xyz",
    "homeDomain": "https://ultracapital.xyz/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.169342",
      "rateLarge": "0.168578",
      "degradationPct": "0.45",
      "smallOut": "1.6934154",
      "largeOut": "16.8578104"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "5.86395",
      "rateLarge": "5.83774",
      "degradationPct": "0.45",
      "smallOut": "9.9301064",
      "largeOut": "98.4114995"
    }
  },
  {
    "code": "MINT",
    "issuer": "GB766ZL26JSF4HTKAR2OU2NKEZA3HBNNV6TUFN6QA7SWUA6MVZNPFBKG",
    "expertDomain": "mint.xmint.io",
    "homeDomain": "https://mint.xmint.io/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "8695.65",
      "rateLarge": "8695.65",
      "degradationPct": "-0.00",
      "smallOut": "86956.5217391",
      "largeOut": "869565.2173913"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.000114600",
      "rateLarge": "0.000114600",
      "degradationPct": "-0.00",
      "smallOut": "9.9652173",
      "largeOut": "99.6521739"
    }
  },
  {
    "code": "BTC",
    "issuer": "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM",
    "expertDomain": "ultracapital.xyz",
    "homeDomain": "https://ultracapital.xyz/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.00000270000",
      "rateLarge": "0.00000270000",
      "degradationPct": "0.00",
      "smallOut": "0.0000270",
      "largeOut": "0.0002700"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "367907",
      "rateLarge": "367818",
      "degradationPct": "0.02",
      "smallOut": "9.9335004",
      "largeOut": "99.3108670"
    }
  },
  {
    "code": "ETH",
    "issuer": "GBFXOHVAS43OIWNIO7XLRJAHT3BICFEIKOJLZVXNT572MISM4CMGSOCC",
    "expertDomain": "ultracapital.xyz",
    "homeDomain": "https://ultracapital.xyz/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.0000919400",
      "rateLarge": "0.0000919010",
      "degradationPct": "0.04",
      "smallOut": "0.0009194",
      "largeOut": "0.0091901"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "10809.5",
      "rateLarge": "10804.2",
      "degradationPct": "0.05",
      "smallOut": "9.9382693",
      "largeOut": "99.2920673"
    }
  },
  {
    "code": "USDV",
    "issuer": "GBLAJOKBIIT7P32BJQFCSRJVOE2SXHI4D5ZGLFJ4DLMFJXI2NN6R37G5",
    "expertDomain": "valtorum.com",
    "homeDomain": "https://valtorum.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "FAIL",
      "reason": "no direct route (small)"
    },
    "assetToXlm": {
      "verdict": "SKIP",
      "reason": "forward failed"
    }
  },
  {
    "code": "SSLX",
    "issuer": "GBHFGY3ZNEJWLNO4LBUKLYOCEK4V7ENEBJGPRHHX7JU47GWHBREH37UR",
    "expertDomain": "sslx.sl8.online",
    "homeDomain": "https://sslx.sl8.online/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "650.167",
      "rateLarge": "649.593",
      "degradationPct": "0.09",
      "smallOut": "6501.6682483",
      "largeOut": "64959.3038170"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.00152855",
      "rateLarge": "0.00152721",
      "degradationPct": "0.09",
      "smallOut": "9.9381419",
      "largeOut": "99.2064414"
    }
  },
  {
    "code": "AFR",
    "issuer": "GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W",
    "expertDomain": "afreum.com",
    "homeDomain": "https://afreum.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "303.490",
      "rateLarge": "302.975",
      "degradationPct": "0.17",
      "smallOut": "3034.9013657",
      "largeOut": "30297.4742660"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.00327610",
      "rateLarge": "0.00327225",
      "degradationPct": "0.12",
      "smallOut": "9.9426421",
      "largeOut": "99.1409725"
    }
  },
  {
    "code": "MJQ",
    "issuer": "GBZCL2R7ZZHVQ4LJWSJVRBU6W3IIT2P4JMJVTYTEHF5UF3MX3BOHIXDQ",
    "expertDomain": "mj-q.com",
    "homeDomain": "https://mj-q.com/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "1.00000",
      "rateLarge": "1.00000",
      "degradationPct": "0.00",
      "smallOut": "10.0000000",
      "largeOut": "100.0000000"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.130001",
      "rateLarge": "0.129126",
      "degradationPct": "0.67",
      "smallOut": "1.3000050",
      "largeOut": "12.9126140"
    }
  },
  {
    "code": "RIPPLEMINT",
    "issuer": "GBGVV42A66UR2EYFUSYYGGED4MEAVCIXPJ3BS5XUNXU47BKKHRKABXRP",
    "expertDomain": "ripplemint.org",
    "homeDomain": "https://ripplemint.org/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "0.0100000",
      "rateLarge": "0.0100000",
      "degradationPct": "0.00",
      "smallOut": "0.1000000",
      "largeOut": "1.0000000"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "1.00010",
      "rateLarge": "1.00010",
      "degradationPct": "0.00",
      "smallOut": "0.1000100",
      "largeOut": "1.0001000"
    }
  },
  {
    "code": "BTCLN",
    "issuer": "GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT",
    "expertDomain": "kbtrading.org",
    "homeDomain": "https://kbtrading.org/.well-known/stellar.toml",
    "xlmToAsset": {
      "verdict": "PASS",
      "rateSmall": "269.644",
      "rateLarge": "269.600",
      "degradationPct": "0.02",
      "smallOut": "2696.4393400",
      "largeOut": "26959.9679368"
    },
    "assetToXlm": {
      "verdict": "PASS",
      "rateSmall": "0.00368628",
      "rateLarge": "0.00368571",
      "degradationPct": "0.02",
      "smallOut": "9.9398407",
      "largeOut": "99.3667547"
    }
  }
]

```
