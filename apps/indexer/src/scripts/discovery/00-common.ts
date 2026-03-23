// apps/indexer/src/scripts/discovery/00-common.ts
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
    xdr,
    scValToNative,
    nativeToScVal,
    Contract,
    TransactionBuilder,
    BASE_FEE,
    Networks,
    Account,
    Address,
  } from "@stellar/stellar-sdk";
  import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";

  export const TMP_DIR = path.resolve(process.cwd(), "tmp/discovery");


  export type ContractArg =
  | { type: "address"; value: string }
  | { type: "u32"; value: number }
  | { type: "i128"; value: string | number | bigint }
  | { type: "u128"; value: string | number | bigint }
  | string
  | number
  | bigint
  | boolean
  | null;

  function contractArgToScVal(arg: ContractArg): xdr.ScVal {
    if (
      arg &&
      typeof arg === "object" &&
      "type" in arg &&
      "value" in arg
    ) {
      if (arg.type === "address") {
        return new Address(arg.value).toScVal();
      }
  
      if (arg.type === "u32") {
        return xdr.ScVal.scvU32(arg.value);
      }
  
      if (arg.type === "i128") {
        return nativeToScVal(BigInt(arg.value), { type: "i128" });
      }
  
      if (arg.type === "u128") {
        return nativeToScVal(BigInt(arg.value), { type: "u128" });
      }
    }
  
    return nativeToScVal(arg as any);
  }

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export async function ensureTmpDir(): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
}

export async function saveJson(filename: string, data: unknown): Promise<void> {
    await ensureTmpDir();
    const filePath = path.join(TMP_DIR, filename);
  
    const json = JSON.stringify(
      data,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    );
  
    await writeFile(filePath, json, "utf-8");
    console.log(`Saved ${filePath}`);
  }

export async function loadJson<T = unknown>(filename: string): Promise<T | null> {
  try {
    const filePath = path.join(TMP_DIR, filename);
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}\n${text.slice(0, 1500)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 1500)}`);
  }
}

export async function rpcCall<T = unknown>(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  return fetchJson<T>(rpcUrl, {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function short(obj: unknown, max = 1000): string {
  const s = JSON.stringify(obj);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeScValBase64(input?: string | null): unknown {
    if (!input) return null;
    return decodeScValUnknown(input);
  }

export function decodeTopicList(topics?: string[] | null): unknown[] {
  if (!topics?.length) return [];
  return topics.map((topic) => decodeScValBase64(topic));
}

export function tryExtractEventName(decodedTopics: unknown[]): string | null {
  const first = decodedTopics[0];

  if (typeof first === "string") return first;

  if (
    first &&
    typeof first === "object" &&
    "toString" in first &&
    typeof (first as { toString: () => string }).toString === "function"
  ) {
    try {
      return (first as { toString: () => string }).toString();
    } catch {
      return null;
    }
  }

  return null;
}

export async function getAccountSequence(
    horizonUrl: string,
    address: string
  ): Promise<string> {
    const url = new URL(`/accounts/${address}`, horizonUrl).toString();
    const account = await fetchJson<any>(url);
    return account.sequence;
  }
  
  export async function simulateContractRead(params: {
    rpcUrl: string;
    horizonUrl: string;
    contractId: string;
    method: string;
    args?: ContractArg[];
    sourceAccount: string;
  }): Promise<{
    ok: boolean;
    method: string;
    decoded?: unknown;
    raw?: unknown;
    error?: string;
  }> {
    const {
      rpcUrl,
      horizonUrl,
      contractId,
      method,
      args = [],
      sourceAccount,
    } = params;
  
    try {
      const sequence = await getAccountSequence(horizonUrl, sourceAccount);
  
      const server = new RpcServer(rpcUrl);
      const contract = new Contract(contractId);
  
      const account = new Account(sourceAccount, sequence);
  
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(
          contract.call(
            method,
            ...args.map((arg) => contractArgToScVal(arg as ContractArg))
          )
        )
        .setTimeout(30)
        .build();
  
      const sim = await server.simulateTransaction(tx);
  
      const retval = (sim as any)?.result?.retval;
      let decoded: unknown = null;
      
      if (retval !== undefined && retval !== null) {
        decoded = decodeScValUnknown(retval);
      }
  
      const error =
        (sim as any)?.error ??
        (sim as any)?.result?.error ??
        null;
  
      if (error) {
        return {
          ok: false,
          method,
          raw: sim,
          error: typeof error === "string" ? error : JSON.stringify(error),
        };
      }
  
      return {
        ok: true,
        method,
        decoded,
        raw: sim,
      };
    } catch (err) {
      return {
        ok: false,
        method,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function isLikelyScValInstance(value: unknown): boolean {
    return !!value && typeof value === "object" && "_arm" in (value as Record<string, unknown>);
  }
  
  function bufferLikeToString(value: unknown): unknown {
    if (
      value &&
      typeof value === "object" &&
      "type" in (value as Record<string, unknown>) &&
      "data" in (value as Record<string, unknown>) &&
      (value as { type?: string }).type === "Buffer" &&
      Array.isArray((value as { data?: unknown[] }).data)
    ) {
      try {
        return Buffer.from((value as { data: number[] }).data).toString("utf-8");
      } catch {
        return value;
      }
    }
  
    return value;
  }
  
  export function deepNormalizeDecoded(value: unknown): unknown {
    if (typeof value === "bigint") return value.toString();
  
    const maybeBufferString = bufferLikeToString(value);
    if (maybeBufferString !== value) return maybeBufferString;
  
    if (Array.isArray(value)) {
      return value.map(deepNormalizeDecoded);
    }
  
    if (value && typeof value === "object") {
      // Handle ChildUnion-like objects from Stellar SDK
      const obj = value as Record<string, unknown>;
  
      if ("_arm" in obj && "_value" in obj) {
        const arm = obj._arm;
        const inner = obj._value;
  
        if (arm === "str" && inner) {
          try {
            if (Buffer.isBuffer(inner)) return inner.toString("utf-8");
            if (
              typeof inner === "object" &&
              inner &&
              "type" in (inner as Record<string, unknown>) &&
              "data" in (inner as Record<string, unknown>) &&
              (inner as { type?: string }).type === "Buffer"
            ) {
              return Buffer.from((inner as { data: number[] }).data).toString("utf-8");
            }
          } catch {
            return inner;
          }
        }
  
        if (arm === "u32" || arm === "u64" || arm === "i32" || arm === "i64" || arm === "u128" || arm === "i128") {
          return typeof inner === "bigint" ? inner.toString() : inner;
        }
  
        return deepNormalizeDecoded(inner);
      }
  
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, deepNormalizeDecoded(v)])
      );
    }
  
    return value;
  }
  
  export function decodeScValUnknown(input: unknown): unknown {
    try {
      if (typeof input === "string") {
        const scVal = xdr.ScVal.fromXDR(input, "base64");
        return deepNormalizeDecoded(scValToNative(scVal));
      }
  
      if (isLikelyScValInstance(input)) {
        return deepNormalizeDecoded(scValToNative(input as xdr.ScVal));
      }
  
      return deepNormalizeDecoded(input);
    } catch (err) {
      return {
        __decodeError: err instanceof Error ? err.message : String(err),
        raw: deepNormalizeDecoded(input),
      };
    }
  }