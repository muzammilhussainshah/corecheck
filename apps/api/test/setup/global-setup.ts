import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { DataSource } from 'typeorm';
import type { TestProject } from 'vitest/node';
import { buildDataSourceOptions } from '../../src/database/data-source-options.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });

/**
 * Starts a fresh PostgreSQL 17 server in a temporary directory, applies the
 * migrations and hands the URL to the integration tests. Every run starts
 * from an empty database; tests keep apart by creating their own
 * organisations.
 */
export default async function setup(project: TestProject) {
  const dataDir = await mkdtemp(join(tmpdir(), 'corecheck-test-db-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => undefined,
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('corecheck_test');

  const databaseUrl = `postgresql://postgres:postgres@localhost:${port}/corecheck_test`;
  const dataSource = new DataSource(
    buildDataSourceOptions({
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: 'off',
      DATABASE_POOL_SIZE: 2,
      LOG_SQL: false,
    }),
  );
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
  await dataSource.destroy();

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}
