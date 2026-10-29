import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { TenantTransactionInterceptor } from './auth/tenant-transaction.interceptor.js';
import { CommonModule } from './common/common.module.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PlantConfigModule } from './plant-config/plant-config.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PocModule } from './poc/poc.module.js';
import { RolesModule } from './roles/roles.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => !config.RATE_LIMIT_ENABLED,
      }),
    }),
    HealthModule,
    AuthModule,
    PlatformModule,
    UsersModule,
    RolesModule,
    OrganisationModule,
    PlantConfigModule,
    PocModule,
  ],
  providers: [
    // Order matters: throttle first, then authenticate.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
