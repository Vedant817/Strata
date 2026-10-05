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

/**
 * Where this process believes it is running.
 *
 * Checked once, at import, because the two behaviours that depend on it are
 * decided at import too. `VERCEL` is the signal that matters in practice — a
 * serverless deploy has no writable, persistent filesystem — but `NODE_ENV` is
 * honoured so the same guard holds anywhere else the app is hosted.
 */
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

/**
 * Refuse to start rather than start wrong.
 *
 * The fallback below is a local file, which is exactly right for development and
 * catastrophic in a deployment: on Vercel it lands somewhere ephemeral, so the
 * site comes up, answers 200, and serves an *empty publication* — no posts, no
 * notes, no writer. Nothing throws. Nothing logs. The first sign of trouble is a
 * reader concluding the publication is empty, and by then it is in caches and in
 * someone's screenshot.
 *
 * A missing configuration variable is a deployment mistake, not a runtime
 * condition, so it gets a message that says which variable and what to do —
 * rather than a database full of nothing.
 */
if (!process.env.DATABASE_URL && isProduction) {
  throw new Error(
    '[strata] DATABASE_URL is not set. Refusing to start: the local-file fallback is ' +
      'ephemeral in a serverless deployment and would serve an empty publication with ' +
      'no error. Set DATABASE_URL to a libsql:// or https:// URL.',
  );
}

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
 *  graph is long-lived, so a module-level promise is sufficient and idempotent.
 *
 *  A failed migration is fatal in production and merely loud in development.
 *
 *  The reasoning: once the schema and the code disagree, every query is a guess.
 *  Continuing turns one clear failure at boot into a stream of unrelated
 *  "no such column" and constraint errors spread across whichever requests happen
 *  to touch the affected tables — and it hides the concurrent-migration race that
 *  two instances booting at the same time can cause, which is exactly the failure
 *  this needs to surface. A deployment that is not ready should say so and stop,
 *  rather than serve. In development, where the schema is disposable and being
 *  wrong is normal while you work, it stays a log line. */
async function ensureMigrated(): Promise<void> {
  if (process.env.STRATA_SKIP_MIGRATE === '1') return;
  if (!globalForDb.__strataMigrated) {
    const folder = path.join(projectRoot, 'drizzle');
    globalForDb.__strataMigrated = migrate(db, { migrationsFolder: folder })
      .then(() => undefined)
      .catch((err) => {
        console.error('[strata] migration failed:', err);
        if (isProduction) {
          throw new Error(
            '[strata] migrations failed, refusing to serve against a schema that does ' +
              'not match the code. See the logged error above.',
          );
        }
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
