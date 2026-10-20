import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './app-config.js';
import { validateEnv } from './env.js';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => validateEnv(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
