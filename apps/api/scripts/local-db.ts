/**
 * Runs a local PostgreSQL 17 server for development, with its data kept in
 * apps/api/.local-db so it survives restarts. No Docker or system install is
 * needed: the binaries come from the embedded-postgres package.
 *
 *   npm run db:local -w @corecheck/api      (leave running; Ctrl+C to stop)
 *
 * Matching DATABASE_URL: postgresql://postgres:postgres@localhost:54320/corecheck
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54320;
const DATABASE = 'corecheck';
const dataDir = resolve(import.meta.dirname, '..', '.local-db');

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  onLog: () => undefined,
});

const firstRun = !existsSync(resolve(dataDir, 'PG_VERSION'));
if (firstRun) await server.initialise();
await server.start();
if (firstRun) await server.createDatabase(DATABASE);

console.log(
  `PostgreSQL is running: postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}`,
);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
