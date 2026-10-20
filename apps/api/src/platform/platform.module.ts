import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganisationsController } from './organisations.controller.js';
import { OrganisationsService } from './organisations.service.js';
import { PlatformAuditController } from './platform-audit.controller.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

/** The internal CoreCheck administration portal's API (FRD 23). */
@Module({
  imports: [AuthModule],
  controllers: [
    StaffAuthController,
    OrganisationsController,
    StaffController,
    PlatformAuditController,
  ],
  providers: [StaffAuthService, OrganisationsService, StaffService],
})
export class PlatformModule {}
