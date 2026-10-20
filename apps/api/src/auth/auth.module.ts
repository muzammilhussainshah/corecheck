import { Module } from '@nestjs/common';
import { StaffSessionsService } from '../platform/staff-sessions.service.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerSessionsService } from './customer-sessions.service.js';

@Module({
  controllers: [CustomerAuthController],
  providers: [
    CustomerSessionsService,
    StaffSessionsService,
    CustomerAuthService,
  ],
  exports: [CustomerSessionsService, StaffSessionsService],
})
export class AuthModule {}
