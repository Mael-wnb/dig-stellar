// apps/indexer/src/scripts/shared/env.ts
export function getOptionalNumberEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
