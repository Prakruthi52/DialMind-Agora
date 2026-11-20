import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type InValue } from '@libsql/client';

// One client for the whole server. DATABASE_URL is `file:local.db` in development and a
// `libsql://…turso.io` URL (with DATABASE_AUTH_TOKEN) on Vercel — same SQL either way.

type DbState = { client: Client | null; ready: Promise<void> | null };
const g = globalThis as typeof globalThis & { __dialmindDb?: DbState };
const state: DbState = (g.__dialmindDb ??= { client: null, ready: null });

function client(): Client {
  if (!state.client) {
    state.client = createClient({
      url: process.env.DATABASE_URL ?? 'file:local.db',
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return state.client;
}

function readSql(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8');
}

/** Creates tables and loads the seed (questions, rules, lexicon, mock policies) once. */
async function init(): Promise<void> {
  const db = client();
  await db.executeMultiple(readSql('schema.sql'));
  const seeded = await db.execute(
    "SELECT COUNT(*) AS n FROM questions",
  );
  const forceReseed = process.env.DB_RESEED === 'true';
  if (Number(seeded.rows[0]?.n ?? 0) === 0 || forceReseed) {
    await db.executeMultiple(readSql('seed.sql'));
  }
}

export async function getDb(): Promise<Client> {
  if (!state.ready) {
    state.ready = init().catch((error) => {
      state.ready = null;
      throw error;
    });
  }
  await state.ready;
  return client();
}

export type Row = Record<string, unknown>;

export async function queryAll<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const db = await getDb();
  const result = await db.execute({ sql, args });
  return result.rows.map((r) => ({ ...r }) as T);
}

export async function queryOne<T = Row>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await queryAll<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  const db = await getDb();
  await db.execute({ sql, args });
}
