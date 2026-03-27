import type { Client, PoolClient } from 'pg';

type DbClient = Pick<Client | PoolClient, 'query'>;

export async function getVenueBySlugOrThrow(client: DbClient, slug: string) {
  const res = await client.query(
    `select id, slug, name from venues where slug = $1 limit 1`,
    [slug]
  );

  if (!res.rowCount) {
    throw new Error(`Missing venue: ${slug}`);
  }

  return res.rows[0] as {
    id: string;
    slug: string;
    name: string;
  };
}

export async function getEntityBySlugOrThrow(client: DbClient, slug: string) {
  const res = await client.query(
    `select id, slug, name, entity_type, contract_address from entities where slug = $1 limit 1`,
    [slug]
  );

  if (!res.rowCount) {
    throw new Error(`Missing entity: ${slug}`);
  }

  return res.rows[0] as {
    id: string;
    slug: string;
    name: string;
    entity_type: string;
    contract_address: string | null;
  };
}

export async function getAssetIdByContractMap(
  client: DbClient,
  chain = 'stellar-mainnet'
): Promise<Map<string, string>> {
  const res = await client.query(
    `select id, contract_address from assets where chain = $1`,
    [chain]
  );

  return new Map<string, string>(
    res.rows.map((row: { id: string; contract_address: string }) => [
      row.contract_address,
      row.id,
    ])
  );
}