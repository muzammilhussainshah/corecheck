import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { Clock } from './clock.js';
import { SecretBox, SecretHasher } from './crypto.js';

@Global()
@Module({
  providers: [
    Clock,
    {
      provide: SecretHasher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretHasher(config.PIN_PEPPER),
    },
    {
      provide: SecretBox,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SecretBox(config.MFA_ENCRYPTION_KEY),
    },
  ],
  exports: [Clock, SecretHasher, SecretBox],
})
export class CommonModule {}
