import { validateDatabaseEnv, validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/corecheck',
  PIN_PEPPER: 'p'.repeat(40),
  MFA_ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('environment validation', () => {
  it('applies safe defaults for local development', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_SSL: 'off',
      COOKIE_SECURE: false,
      RATE_LIMIT_ENABLED: true,
      WEB_SESSION_IDLE_MINUTES: 30,
    });
  });

  it('lists every missing or weak secret at once', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'x', PIN_PEPPER: 'short' }),
    ).toThrow(/PIN_PEPPER[\s\S]*MFA_ENCRYPTION_KEY/);
  });

  it('refuses insecure settings in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /COOKIE_SECURE[\s\S]*DATABASE_SSL/,
    );
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        DATABASE_SSL: 'verify',
      }),
    ).toThrow(/DATABASE_CA_CERT/);
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        DATABASE_SSL: 'require',
      }).NODE_ENV,
    ).toBe('production');
  });

  it('needs only database settings to run migrations', () => {
    expect(
      validateDatabaseEnv({ DATABASE_URL: 'postgresql://localhost/x' })
        .DATABASE_SSL,
    ).toBe('off');
  });
});
