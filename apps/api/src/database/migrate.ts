import '../config/load-env-file.js';
import { DataSource } from 'typeorm';
import { validateDatabaseEnv } from '../config/env.js';
import { buildDataSourceOptions } from './data-source-options.js';

/**
 * Applies pending migrations: `npm run db:migrate` (or `node dist/database/migrate.js`
 * in a deployed build). Exits non-zero on failure so a deploy stops.
 */
const run = async () => {
  const env = validateDatabaseEnv(process.env);
  const dataSource = new DataSource(buildDataSourceOptions(env));
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length === 0) {
      console.log('Database is up to date.');
    } else {
      for (const migration of applied) console.log(`Applied ${migration.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
