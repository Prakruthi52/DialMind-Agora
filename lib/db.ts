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
  // Columns added after the first deploy (CREATE TABLE IF NOT EXISTS never alters a table).
  const policyCols = await db.execute('PRAGMA table_info(policies)');
  if (!policyCols.rows.some((c) => c.name === 'registration_no')) {
    await db.execute('ALTER TABLE policies ADD COLUMN registration_no TEXT');
  }
  const seeded = await db.execute(
    "SELECT COUNT(*) AS n FROM questions",
  );
  const forceReseed = process.env.DB_RESEED === 'true';
  if (Number(seeded.rows[0]?.n ?? 0) === 0 || forceReseed) {
    await db.executeMultiple(readSql('seed.sql'));
  }
  // Colloquial wording for every language (translations, synonyms, lexicon).
  const translated = await db.execute('SELECT COUNT(*) AS n FROM translations');
  if (Number(translated.rows[0]?.n ?? 0) === 0 || forceReseed) {
    await db.executeMultiple(readSql('seed_i18n.sql'));
  }
  await migrateData(db);
}

// Bump when a database seeded earlier needs data changes (see db/migrate_v*.sql).
const DATA_VERSION = '2';

async function migrateData(db: Client): Promise<void> {
  const version = await db.execute("SELECT value FROM app_meta WHERE key = 'data_version'");
  if (String(version.rows[0]?.value ?? '') !== DATA_VERSION) {
    // v2: standard 8-digit registration numbers (+ reworded identification question).
    await db.executeMultiple(readSql('migrate_v2.sql'));
    await db.executeMultiple(readSql('seed_i18n.sql'));
    await db.execute({
      sql: `INSERT INTO app_meta (key, value) VALUES ('data_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [DATA_VERSION],
    });
  }
  await db.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_registration ON policies(registration_no)',
  );
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
