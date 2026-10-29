import { z } from 'zod';

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envObject = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: positiveInt(4000),

  /** Postgres connection string (Supabase in staging and production). */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  /**
   * off: no TLS (local only). require: TLS without certificate checks.
   * verify: TLS checked against DATABASE_CA_CERT (recommended for Supabase).
   */
  DATABASE_SSL: z.enum(['off', 'require', 'verify']).default('off'),
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_SIZE: positiveInt(10),
  LOG_SQL: flag(false),

  /** Server-side secret mixed into every PIN and password hash. */
  PIN_PEPPER: z.string().min(32, 'PIN_PEPPER must be at least 32 characters.'),
  /** 32-byte key (64 hex characters) that encrypts staff MFA secrets. */
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'MFA_ENCRYPTION_KEY must be 64 hex characters.',
    ),

  /** Send session cookies over HTTPS only. Must be true in production. */
  COOKIE_SECURE: flag(false),
  /** Behind a proxy (Render), trust X-Forwarded-For for client addresses. */
  TRUST_PROXY: flag(false),
  RATE_LIMIT_ENABLED: flag(true),
  /**
   * Authenticator-app second factor for internal staff. Neither the FRD nor
   * the ITDR requires it; off until the client asks for it.
   */
  STAFF_MFA_REQUIRED: flag(false),

  WEB_SESSION_IDLE_MINUTES: positiveInt(30),
  WEB_SESSION_MAX_HOURS: positiveInt(12),
  MOBILE_SESSION_DAYS: positiveInt(30),
  STAFF_SESSION_IDLE_MINUTES: positiveInt(30),
  STAFF_SESSION_MAX_HOURS: positiveInt(8),

  /** Where uploaded evidence is written (offline-sync proof of concept). */
  STORAGE_DIR: z.string().default('./storage'),

  /**
   * The customer web app's address. Plant QR codes point at
   * <WEB_APP_URL>/q/<token>, so this must be the public URL in production.
   */
  WEB_APP_URL: z
    .url('WEB_APP_URL must be a full URL, e.g. https://app.example.com.')
    .default('http://localhost:3100')
    .transform((url) => url.replace(/\/+$/, '')),

  /**
   * Where plant documents are kept: "local" writes under STORAGE_DIR
   * (development and tests); "supabase" uses a private Supabase Storage
   * bucket, required in production because a Render disk is wiped on deploy.
   */
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.url('SUPABASE_URL must be the project URL.').optional(),
  /** Server-side key; never sent to a browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /**
   * How often to restrict approved plant whose mandatory documents have
   * expired (DOC-AC-01). 0 turns the check off (tests).
   */
  COMPLIANCE_SWEEP_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(1440)
    .default(60),
  SUPABASE_STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Use lower-case letters, digits and -.')
    .default('corecheck-files'),
});

export const envSchema = envObject.superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER === 'supabase') {
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_DRIVER is supabase.`,
        });
    }
  }
  if (env.NODE_ENV !== 'production') return;
  if (env.STORAGE_DRIVER !== 'supabase') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DRIVER'],
      message:
        'STORAGE_DRIVER must be supabase in production: files on the server disk are lost on every deploy.',
    });
  }
  if (!env.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE must be true in production.',
    });
  }
  if (env.DATABASE_SSL === 'off') {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_SSL'],
      message: 'DATABASE_SSL must not be off in production.',
    });
  }
  if (env.DATABASE_SSL === 'verify' && !env.DATABASE_CA_CERT) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_CA_CERT'],
      message: 'DATABASE_CA_CERT is required when DATABASE_SSL is verify.',
    });
  }
});

export type Env = z.output<typeof envSchema>;

/** Just the database settings: enough for migrations, which need no secrets. */
export const databaseEnvSchema = envObject.pick({
  DATABASE_URL: true,
  DATABASE_SSL: true,
  DATABASE_CA_CERT: true,
  DATABASE_POOL_SIZE: true,
  LOG_SQL: true,
});
export type DatabaseEnv = z.output<typeof databaseEnvSchema>;

/** Parses the environment, failing fast with every problem listed. */
const parseOrThrow = <T>(
  schema: z.ZodType<T>,
  raw: Record<string, unknown>,
): T => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
};

export const validateEnv = (raw: Record<string, unknown>): Env =>
  parseOrThrow(envSchema, raw);

export const validateDatabaseEnv = (
  raw: Record<string, unknown>,
): DatabaseEnv => parseOrThrow(databaseEnvSchema, raw);
