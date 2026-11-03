// apps/api/src/modules/openapi/openapi-document.ts
//
// Lot API: loads the hand-written OpenAPI 3.1 document (apps/api/openapi/openapi.v1.yaml)
// once at boot and exposes it as a plain object. The yaml is the source of truth; this
// file only resolves where it lives at runtime:
//   1. dist/openapi/openapi.v1.yaml — copied by `nest build` (nest-cli.json assets). This is
//      what pm2 (`dist/main.js`) and the Docker image (which ships only dist/) read.
//   2. apps/api/openapi/openapi.v1.yaml — the source file, for ts-node runs (contract test).
// Both are resolved relative to this file so cwd never matters.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
};

const CANDIDATES = [
  resolve(__dirname, '../../openapi/openapi.v1.yaml'), // dist/openapi (built)
  resolve(__dirname, '../../../openapi/openapi.v1.yaml'), // apps/api/openapi (source)
];

export function resolveOpenApiPath(): string | null {
  return CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

export function loadOpenApiDocument(): OpenApiDocument {
  const path = resolveOpenApiPath();
  if (!path) {
    throw new Error(
      `OpenAPI document not found; looked in: ${CANDIDATES.join(', ')}`,
    );
  }
  const doc = parse(readFileSync(path, 'utf8')) as OpenApiDocument;
  if (!doc || typeof doc.openapi !== 'string' || !doc.info?.version) {
    throw new Error(`OpenAPI document at ${path} is not a valid OpenAPI object`);
  }
  return doc;
}
