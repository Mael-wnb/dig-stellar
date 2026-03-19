import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { xdr, scValToNative } from "@stellar/stellar-sdk";

export const TMP_DIR = path.resolve(process.cwd(), "tmp/discovery");

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

  try {
    const scVal = xdr.ScVal.fromXDR(input, "base64");
    return scValToNative(scVal);
  } catch (err) {
    return {
      __decodeError: err instanceof Error ? err.message : String(err),
      raw: input,
    };
  }
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