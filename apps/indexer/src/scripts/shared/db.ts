// apps/indexer/src/scripts/shared/db.ts
import { Client } from 'pg';

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL?.replace('?schema=public', '') ??
    'postgresql://dig:dig@localhost:5432/dig_stellar'
  );
}

export function createPgClient(): Client {
  return new Client({
    connectionString: getDatabaseUrl(),
  });
}