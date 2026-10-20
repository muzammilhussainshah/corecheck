import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { buildDataSourceOptions } from './data-source-options.js';
import { PlatformDb, SystemDb, TenantDb } from './db-context.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildDataSourceOptions(config),
    }),
  ],
  providers: [TenantDb, PlatformDb, SystemDb],
  exports: [TenantDb, PlatformDb, SystemDb],
})
export class DatabaseModule {}
