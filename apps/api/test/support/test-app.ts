import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { Clock } from '../../src/common/clock.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';

/** A clock tests can move forward to exercise expiry rules. */
export class TestClock extends Clock {
  private offsetMs = 0;

  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  advanceMinutes(minutes: number): void {
    this.advance(minutes * 60_000);
  }

  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60_000);
  }

  reset(): void {
    this.offsetMs = 0;
  }
}

export const TEST_SECRETS = {
  PIN_PEPPER: 'test-pepper-0123456789abcdef0123456789abcdef',
  MFA_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof supertest>;
  server: Parameters<typeof supertest>[0];
  clock: TestClock;
  dataSource: DataSource;
  config: AppConfig;
  close: () => Promise<void>;
}

/** The real application, wired exactly as in production, on the test database. */
export const createTestApp = async ({
  staffMfaRequired = true,
}: { staffMfaRequired?: boolean } = {}): Promise<TestApp> => {
  Object.assign(process.env, {
    STAFF_MFA_REQUIRED: String(staffMfaRequired),
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    DATABASE_SSL: 'off',
    DATABASE_POOL_SIZE: '5',
    RATE_LIMIT_ENABLED: 'false',
    COOKIE_SECURE: 'false',
    STORAGE_DIR: await mkdtemp(join(tmpdir(), 'corecheck-test-storage-')),
    // Tests run the document expiry check themselves when they need it.
    COMPLIANCE_SWEEP_MINUTES: '0',
    ...TEST_SECRETS,
  });

  const clock = new TestClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error', 'warn'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.init();

  const server = app.getHttpServer() as Parameters<typeof supertest>[0];
  return {
    app,
    http: supertest(server),
    server,
    clock,
    dataSource: app.get(DataSource),
    config,
    close: () => app.close(),
  };
};
