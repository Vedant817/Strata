import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema';

export type Db = LibSQLDatabase<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
// src/lib/db -> project root
const projectRoot = path.resolve(here, '../../..');

const url = process.env.DATABASE_URL ?? 'file:./data/strata.db';

if (url.startsWith('file:')) {
  const file = url.replace(/^file:/, '');
  const dir = path.isAbsolute(file)
    ? path.dirname(file)
    : path.resolve(projectRoot, path.dirname(file));
  fs.mkdirSync(dir, { recursive: true });
}

const globalForDb = globalThis as unknown as {
  __strataClient?: Client;
  __strataDb?: Db;
  __strataMigrated?: Promise<void>;
};

export const client: Client =
  globalForDb.__strataClient ?? createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

export const db: Db = globalForDb.__strataDb ?? drizzle(client, { schema });

if (!globalForDb.__strataClient) {
  globalForDb.__strataClient = client;
  globalForDb.__strataDb = db;
}

/** Migrations run once per process, before the first query. In SSR the module
 *  graph is long-lived, so a module-level promise is sufficient and idempotent. */
async function ensureMigrated(): Promise<void> {
  if (process.env.STRATA_SKIP_MIGRATE === '1') return;
  if (!globalForDb.__strataMigrated) {
    const folder = path.join(projectRoot, 'drizzle');
    globalForDb.__strataMigrated = migrate(db, { migrationsFolder: folder })
      .then(() => undefined)
      .catch((err) => {
        // Surface loudly in dev; never take the site down over it.
        console.error('[strata] migration failed:', err);
      });
  }
  return globalForDb.__strataMigrated;
}

const ready = ensureMigrated();

/** Await readiness before any query. Every repository function goes through it. */
export async function readyDb(): Promise<Db> {
  await ready;
  return db;
}

export { schema };
