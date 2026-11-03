// apps/api/test/contract/run-contract-test.ts
//
// Lot API — HTTP contract test ("contract" = the HTTP API contract, never a smart
// contract). Boots the REAL AppModule against the configured Postgres and, for every
// operation in apps/api/openapi/openapi.v1.yaml, calls it with a valid request, asserts
// the documented status and validates the body against the response schema with ajv
// (JSON Schema 2020-12 + ajv-formats). Also exercises the documented error paths and
// the two documentation routes.
//
// Run:   DATABASE_URL=postgresql://dig:dig@localhost:5432/dig_stellar pnpm -C apps/api test:contract
// Needs: a populated local Postgres (stale data is fine: schemas describe shape, not
//        freshness) and outbound HTTPS to Horizon testnet for the quote operation.
// Not part of `pnpm test` / CI in this lot (Lot AD owns CI); it is a deploy-checklist step.
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { AppModule } from '../../src/app.module';
import {
  loadOpenApiDocument,
  resolveOpenApiPath,
  type OpenApiDocument,
} from '../../src/modules/openapi/openapi-document';

const SCHEMA_ID = 'openapi.v1';

type Outcome = { ok: boolean; label: string; detail?: string };
const outcomes: Outcome[] = [];

function record(ok: boolean, label: string, detail?: string): void {
  outcomes.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n      ${detail}` : ''}`);
}

function pointer(...segments: string[]): string {
  return segments.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

// Resolve a local `$ref` ('#/components/...') inside the document.
function deref(doc: OpenApiDocument, node: unknown): unknown {
  if (node && typeof node === 'object' && '$ref' in node) {
    const ref = (node as { $ref: string }).$ref;
    if (!ref.startsWith('#/')) throw new Error(`external $ref not supported: ${ref}`);
    let cur: unknown = doc;
    for (const seg of ref.slice(2).split('/')) {
      cur = (cur as Record<string, unknown>)[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (cur === undefined) throw new Error(`unresolved $ref: ${ref}`);
    }
    return cur;
  }
  return node;
}

type Operation = {
  method: 'get' | 'post';
  path: string;
  operationId: string;
  stability: string;
  responses: Record<string, unknown>;
};

function listOperations(doc: OpenApiDocument): Operation[] {
  const ops: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post'] as const) {
      const op = (item as Record<string, Record<string, unknown>>)[method];
      if (!op) continue;
      ops.push({
        method,
        path,
        operationId: String(op.operationId ?? `${method} ${path}`),
        stability: String(op['x-stability'] ?? 'unspecified'),
        responses: (op.responses ?? {}) as Record<string, unknown>,
      });
    }
  }
  return ops;
}

// Does this schema (after deref) forbid undocumented keys at its top level?
function strictness(doc: OpenApiDocument, schema: unknown): 'additionalProperties' | 'unevaluatedProperties' | 'open' {
  const s = deref(doc, schema) as Record<string, unknown>;
  if (s.type === 'array') return strictness(doc, s.items);
  if (Array.isArray(s.oneOf)) {
    const kinds = (s.oneOf as unknown[]).map((b) => strictness(doc, b));
    return kinds.every((k) => k !== 'open') ? kinds[0] : 'open';
  }
  if (s.additionalProperties === false) return 'additionalProperties';
  if (s.unevaluatedProperties === false) return 'unevaluatedProperties';
  return 'open';
}

async function main(): Promise<void> {
  const specPath = resolveOpenApiPath();
  const doc = loadOpenApiDocument();
  console.log(`spec: ${specPath} (${doc.info.title} ${doc.info.version})`);
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — the contract test needs a populated Postgres.');
    process.exit(2);
  }

  // strict:false — the document carries OpenAPI keywords (openapi, info, paths,
  // discriminator, example, x-*) that are not JSON Schema; ajv must ignore them.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(doc as unknown as Record<string, unknown>, SCHEMA_ID);

  const validatorFor = (op: Operation, status: string): ValidateFunction => {
    const key = `${SCHEMA_ID}#/paths/${pointer(op.path)}/${op.method}/responses/${status}/content/${pointer('application/json')}/schema`;
    // A `$ref`'d response ('#/components/responses/X') has no inline content: resolve it.
    const response = deref(doc, op.responses[status]) as Record<string, unknown>;
    const content = response?.content as Record<string, Record<string, unknown>> | undefined;
    const schema = content?.['application/json']?.schema;
    if (!schema) throw new Error(`${op.operationId} ${status}: no JSON schema documented`);
    const direct = ajv.getSchema(key);
    if (direct) return direct;
    // Response reached through $ref: compile the referenced schema by its own pointer.
    const ref = (op.responses[status] as { $ref?: string }).$ref;
    if (ref) {
      const v = ajv.getSchema(`${SCHEMA_ID}#${ref.slice(1)}/content/${pointer('application/json')}/schema`);
      if (v) return v;
    }
    throw new Error(`${op.operationId} ${status}: cannot compile schema`);
  };

  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  const http = request(app.getHttpServer());

  const check = async (
    op: Operation,
    status: number,
    send: () => request.Test,
    label: string,
  ): Promise<unknown> => {
    let body: unknown = undefined;
    try {
      const res = await send();
      body = res.body;
      if (res.status !== status) {
        record(false, label, `expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
        return body;
      }
      const validate = validatorFor(op, String(status));
      const valid = validate(res.body);
      if (!valid) {
        const errors = (validate.errors ?? [])
          .slice(0, 8)
          .map((e) => `${e.instancePath || '/'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`)
          .join('; ');
        record(false, label, `schema violation: ${errors}`);
        return body;
      }
      record(true, label);
    } catch (err) {
      record(false, label, err instanceof Error ? err.message : String(err));
    }
    return body;
  };

  const ops = listOperations(doc);
  const byId = Object.fromEntries(ops.map((o) => [o.operationId, o]));
  const need = (id: string): Operation => {
    const op = byId[id];
    if (!op) throw new Error(`operation ${id} missing from the spec`);
    return op;
  };

  // ── Discover path parameters from the live list (never hardcoded) ───────────
  const poolsOp = need('listPools');
  const pools = (await check(poolsOp, 200, () => http.get('/v1/pools'), `GET /v1/pools  [${poolsOp.stability}]`)) as
    | Array<{ id: string; type: string; protocol: { id: string } }>
    | undefined;
  const list = Array.isArray(pools) ? pools : [];
  const pick = (pred: (p: { id: string; type: string; protocol: { id: string } }) => boolean) => list.find(pred)?.id;
  const slugs = {
    amm: pick((p) => p.type === 'amm_pool' && p.protocol.id !== 'stellar-native'),
    native: pick((p) => p.protocol.id === 'stellar-native'),
    lending: pick((p) => p.type === 'lending_pool' && p.protocol.id === 'blend'),
    lendingOther: pick((p) => p.type === 'lending_pool' && p.protocol.id !== 'blend'),
    vault: pick((p) => p.type === 'yield_vault'),
  };
  console.log(`discovered slugs: ${JSON.stringify(slugs)}`);

  // ── Every operation, valid request ──────────────────────────────────────────
  const get = (id: string, url: string, label = url) =>
    check(need(id), 200, () => http.get(url), `GET ${label}  [${need(id).stability}]`);

  await get('getHealth', '/health');
  await get('listProtocols', '/v1/protocols');
  await get('listPools', '/v1/pools?protocol=blend&sort=tvlUsd&order=desc');
  for (const [kind, slug] of Object.entries(slugs)) {
    if (!slug) {
      record(false, `GET /v1/pools/{slug} (${kind})`, 'no pool of this kind in the local database');
      continue;
    }
    await get('getPool', `/v1/pools/${slug}`, `/v1/pools/${slug} (${kind})`);
  }
  for (const slug of [slugs.amm, slugs.lending].filter(Boolean) as string[]) {
    await get('getPoolFlows', `/v1/pools/${slug}/flows?window=7d`);
    await get('getPoolSeries', `/v1/pools/${slug}/series`);
  }
  await get('getNetworkStats', '/v1/network/stats');
  await get('getNetworkTvlSeries', '/v1/network/tvl-series');
  await get('getBridgeSummary', '/v1/bridge/summary?window=30d');
  await get('listBridgeFlows', '/v1/bridge/flows?direction=inflow&limit=5');
  await get('getBridgeSeries', '/v1/bridge/series?days=14');
  await get('getOpsStatus', '/v1/ops/status');
  await get('getOpsMetrics', '/v1/ops/metrics');
  await get('getOpsAdoption', '/v1/ops/adoption');

  const quote = need('quoteSdexSwap');
  await check(
    quote,
    200,
    () => http.post('/v1/actions/sdex/quote').send({ fromAsset: 'XLM', toAsset: 'USDC', amount: '10', network: 'testnet' }),
    `POST /v1/actions/sdex/quote (testnet XLM→USDC)  [${quote.stability}]`,
  );

  // ── Documented error paths ──────────────────────────────────────────────────
  await check(need('getPool'), 404, () => http.get('/v1/pools/does-not-exist'), 'GET /v1/pools/does-not-exist → 404');
  await check(need('getPoolFlows'), 404, () => http.get('/v1/pools/does-not-exist/flows'), 'GET /v1/pools/does-not-exist/flows → 404');
  await check(need('getPoolSeries'), 404, () => http.get('/v1/pools/does-not-exist/series'), 'GET /v1/pools/does-not-exist/series → 404');
  await check(need('getOpsStatus'), 400, () => http.get('/v1/ops/status?window=7d'), 'GET /v1/ops/status?window=7d → 400');
  await check(
    quote,
    400,
    () => http.post('/v1/actions/sdex/quote').send({ fromAsset: 'XLM', toAsset: 'XLM', amount: '10' }),
    'POST quote same asset → 400',
  );
  if (process.env.ACTIONS_MAINNET_ENABLED === 'true') {
    console.log('SKIP  POST quote mainnet → 403 (ACTIONS_MAINNET_ENABLED=true in this environment)');
  } else {
    await check(
      quote,
      403,
      () => http.post('/v1/actions/sdex/quote').send({ fromAsset: 'XLM', toAsset: 'USDC', amount: '10', network: 'mainnet' }),
      'POST quote mainnet (kill-switch off) → 403',
    );
  }
  await check(
    quote,
    422,
    () =>
      http.post('/v1/actions/sdex/quote').send({
        fromAsset: 'XLM',
        // A well-formed asset no market exists for: the issuer is the vetted testnet USDC
        // issuer the service already knows, so Horizon answers with zero direct paths.
        toAsset: { code: 'ZZZQ', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
        amount: '10',
        network: 'testnet',
      }),
    'POST quote no direct path → 422',
  );

  // ── Documentation routes (outside the spec, served by the openapi module) ───
  try {
    const res = await http.get('/v1/openapi.json');
    const ok = res.status === 200 && res.body?.info?.version === doc.info.version && /max-age=3600/.test(String(res.headers['cache-control']));
    record(ok, 'GET /v1/openapi.json serves the document', ok ? undefined : `status ${res.status}, version ${res.body?.info?.version}, cache-control ${res.headers['cache-control']}`);
  } catch (err) {
    record(false, 'GET /v1/openapi.json serves the document', String(err));
  }
  try {
    const res = await http.get('/v1/docs');
    const ok = res.status === 200 && /^text\/html/.test(String(res.headers['content-type'])) && /openapi\.json/.test(res.text);
    record(ok, 'GET /v1/docs is text/html and references the document', ok ? undefined : `status ${res.status}, content-type ${res.headers['content-type']}`);
  } catch (err) {
    record(false, 'GET /v1/docs is text/html and references the document', String(err));
  }

  // ── Strictness: every stable 200 schema must reject undocumented keys ───────
  for (const op of ops) {
    const response = deref(doc, op.responses['200']) as Record<string, unknown>;
    const schema = (response?.content as Record<string, Record<string, unknown>>)?.['application/json']?.schema;
    const kind = strictness(doc, schema);
    if (op.stability === 'stable') {
      record(kind !== 'open', `strict schema: ${op.operationId} (${kind})`, 'stable operation with an open response schema');
    } else {
      console.log(`INFO  ${op.operationId} is ${op.stability}: schema ${kind}`);
    }
  }

  await app.close();

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} checks passed, ${failed.length} failed` + (failed.length ? `:\n  - ${failed.map((f) => f.label).join('\n  - ')}` : ''));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
