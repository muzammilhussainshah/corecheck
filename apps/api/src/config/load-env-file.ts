/**
 * Loads apps/api/.env into process.env when the file exists (local
 * development). ENV_FILE picks another file, e.g. ENV_FILE=.env.staging to
 * run a CLI against staging from a laptop; a named file must exist. Deployed
 * environments set real environment variables instead.
 * Import this first in every entry point.
 */
const envFile = process.env.ENV_FILE;
try {
  process.loadEnvFile(envFile ?? '.env');
} catch (error) {
  if (envFile || (error as NodeJS.ErrnoException).code !== 'ENOENT')
    throw error;
}
