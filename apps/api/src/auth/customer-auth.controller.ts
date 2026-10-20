import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  changePinSchema,
  customerLoginSchema,
  type LoginResponse,
  type MeResponse,
} from '@corecheck/shared';
import { clientInfo } from '../common/request.js';
import { ValidBody } from '../common/validation.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import type { CustomerAuth } from './auth-context.js';
import {
  clearSessionCookie,
  CUSTOMER_COOKIE,
  readSessionToken,
  setSessionCookie,
} from './cookies.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerSessionsService } from './customer-sessions.service.js';
import {
  AllowPendingPinChange,
  AllowReadOnlyOrg,
  CurrentAuth,
  Public,
  SkipTenantTransaction,
} from './decorators.js';
import { toMeResponse } from './me.js';

/** Sign-in throttle per client address, on top of the per-account lockout. */
const SIGN_IN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly sessions: CustomerSessionsService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @ValidBody(customerLoginSchema) body: z.output<typeof customerLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { session, auth } = await this.auth.login(body, clientInfo(req));
    const me = toMeResponse(auth);
    if (body.client === 'mobile') return { me, token: session.token };

    setSessionCookie(
      res,
      CUSTOMER_COOKIE,
      session.token,
      session.expiresAt,
      this.config.COOKIE_SECURE,
    );
    return { me };
  }

  @Get('me')
  @AllowPendingPinChange()
  @SkipTenantTransaction()
  me(@CurrentAuth() auth: CustomerAuth): MeResponse {
    return toMeResponse(auth);
  }

  @Post('change-pin')
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  @AllowPendingPinChange()
  @AllowReadOnlyOrg()
  @SkipTenantTransaction()
  async changePin(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(changePinSchema) body: z.output<typeof changePinSchema>,
    @Req() req: Request,
  ): Promise<MeResponse> {
    await this.auth.changePin(auth, body, clientInfo(req));
    const token = readSessionToken(req, CUSTOMER_COOKIE) ?? '';
    return toMeResponse(await this.sessions.authenticate(token));
  }

  @Post('logout')
  @HttpCode(204)
  @AllowPendingPinChange()
  @AllowReadOnlyOrg()
  @SkipTenantTransaction()
  async logout(
    @CurrentAuth() auth: CustomerAuth,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, clientInfo(req));
    clearSessionCookie(res, CUSTOMER_COOKIE, this.config.COOKIE_SECURE);
  }
}
