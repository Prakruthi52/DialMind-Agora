// Creates the schema and loads the seed into DATABASE_URL (Turso or a local file).
// Run: pnpm db:setup        Reseed questions/rules: DB_RESEED=true pnpm db:setup
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local without extra dependencies.
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

async function main() {
  const { queryAll, getDb } = await import('../lib/db');
  await getDb();
  const tables = await queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  console.log(`Database: ${process.env.DATABASE_URL}`);
  for (const { name } of tables) {
    const [{ n }] = await queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`);
    console.log(`  ${name.padEnd(18)} ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
