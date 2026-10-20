import { Controller, Get } from '@nestjs/common';
import { APP_NAME } from '@corecheck/shared';
import { Public } from '../../auth/decorators.js';

/** Liveness check for the hosting platform and for the apps to probe. */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', app: APP_NAME };
  }
}
