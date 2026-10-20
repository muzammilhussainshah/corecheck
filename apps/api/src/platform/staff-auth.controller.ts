import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  changeStaffPasswordSchema,
  mfaCodeSchema,
  type MfaSetupResponse,
  type StaffLoginResponse,
  staffLoginSchema,
  type StaffMe,
} from '@corecheck/shared';
import type { StaffAuth } from '../auth/auth-context.js';
import {
  clearSessionCookie,
  setSessionCookie,
  STAFF_COOKIE,
} from '../auth/cookies.js';
import {
  AllowPendingMfa,
  AllowPendingPasswordChange,
  CurrentStaff,
  Public,
  StaffArea,
} from '../auth/decorators.js';
import { clientInfo } from '../common/request.js';
import { ValidBody } from '../common/validation.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { StaffAuthService } from './staff-auth.service.js';

const SIGN_IN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@StaffArea()
@Controller('platform/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @ValidBody(staffLoginSchema) body: z.output<typeof staffLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffLoginResponse> {
    const { token, expiresAt, response } = await this.auth.login(
      body,
      clientInfo(req),
    );
    setSessionCookie(
      res,
      STAFF_COOKIE,
      token,
      expiresAt,
      this.config.COOKIE_SECURE,
    );
    return response;
  }

  @Get('me')
  @AllowPendingMfa()
  @AllowPendingPasswordChange()
  me(@CurrentStaff() staff: StaffAuth): StaffMe {
    return this.auth.me(staff);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @AllowPendingMfa()
  @AllowPendingPasswordChange()
  setupMfa(@CurrentStaff() staff: StaffAuth): Promise<MfaSetupResponse> {
    return this.auth.beginMfaSetup(staff);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  @AllowPendingMfa()
  @AllowPendingPasswordChange()
  confirmMfa(
    @CurrentStaff() staff: StaffAuth,
    @ValidBody(mfaCodeSchema) body: z.output<typeof mfaCodeSchema>,
    @Req() req: Request,
  ): Promise<StaffMe> {
    return this.auth.confirmMfaSetup(staff, body.code, clientInfo(req));
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  @AllowPendingMfa()
  @AllowPendingPasswordChange()
  verifyMfa(
    @CurrentStaff() staff: StaffAuth,
    @ValidBody(mfaCodeSchema) body: z.output<typeof mfaCodeSchema>,
    @Req() req: Request,
  ): Promise<StaffMe> {
    return this.auth.verifyMfa(staff, body.code, clientInfo(req));
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPendingPasswordChange()
  changePassword(
    @CurrentStaff() staff: StaffAuth,
    @ValidBody(changeStaffPasswordSchema)
    body: z.output<typeof changeStaffPasswordSchema>,
    @Req() req: Request,
  ): Promise<StaffMe> {
    return this.auth.changePassword(staff, body, clientInfo(req));
  }

  @Post('logout')
  @HttpCode(204)
  @AllowPendingMfa()
  @AllowPendingPasswordChange()
  async logout(
    @CurrentStaff() staff: StaffAuth,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(staff, clientInfo(req));
    clearSessionCookie(res, STAFF_COOKIE, this.config.COOKIE_SECURE);
  }
}
