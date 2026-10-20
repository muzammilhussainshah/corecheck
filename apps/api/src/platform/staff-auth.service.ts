import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type changeStaffPasswordSchema,
  ERROR_CODES,
  type MfaSetupResponse,
  type StaffLoginResponse,
  type staffLoginSchema,
  type StaffMe,
} from '@corecheck/shared';
import {
  AuditService,
  clientMetadata,
  staffActor,
} from '../audit/audit.service.js';
import type { StaffAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { SecretBox, SecretHasher } from '../common/crypto.js';
import { AppException, conflict, fieldError } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { PlatformStaffEntity } from '../database/entities.js';
import { SystemDb } from '../database/db-context.js';
import { StaffSessionsService } from './staff-sessions.service.js';
import { newTotpSecret, totpQrCode, totpUri, verifyTotp } from './totp.js';

type LoginBody = z.output<typeof staffLoginSchema>;
type ChangePasswordBody = z.output<typeof changeStaffPasswordSchema>;

type Outcome<T> = { ok: true; value: T } | { ok: false; error: AppException };

/** Wrong passwords or codes in a row before a staff account locks. */
const MAX_FAILED_ATTEMPTS = 5;

const invalidCredentials = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Incorrect email or password.',
  );

const lockedOut = () =>
  new AppException(
    HttpStatus.FORBIDDEN,
    ERROR_CODES.ACCOUNT_LOCKED,
    'This staff account is locked. Ask a CoreCheck owner to reset it.',
  );

const invalidCode = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ERROR_CODES.INVALID_MFA_CODE,
    'That code is not valid. Check your authenticator app and try again.',
    { fieldErrors: [{ field: 'code', message: 'That code is not valid.' }] },
  );

/**
 * Password, then (when STAFF_MFA_REQUIRED is on) a TOTP second factor; both
 * failures count towards lockout.
 */
@Injectable()
export class StaffAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly systemDb: SystemDb,
    private readonly sessions: StaffSessionsService,
    private readonly hasher: SecretHasher,
    private readonly secretBox: SecretBox,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async login(
    input: LoginBody,
    info: ClientInfo,
  ): Promise<{ token: string; expiresAt: Date; response: StaffLoginResponse }> {
    const outcome = await this.systemDb.transaction(
      async (
        manager,
      ): Promise<
        Outcome<{ token: string; expiresAt: Date; staff: PlatformStaffEntity }>
      > => {
        const staff = await manager.findOne(PlatformStaffEntity, {
          where: { email: input.email },
          lock: { mode: 'pessimistic_write' },
        });
        if (!staff) {
          await this.hasher.verify(input.password, await this.getDummyHash());
          return { ok: false, error: invalidCredentials() };
        }
        if (staff.status !== 'active') {
          return {
            ok: false,
            error: new AppException(
              HttpStatus.FORBIDDEN,
              ERROR_CODES.ACCOUNT_INACTIVE,
              'This staff account is disabled.',
            ),
          };
        }
        if (staff.lockedAt) return { ok: false, error: lockedOut() };

        if (!(await this.hasher.verify(input.password, staff.passwordHash))) {
          return {
            ok: false,
            error: await this.recordFailure(manager, staff, info),
          };
        }

        await manager.update(
          PlatformStaffEntity,
          { id: staff.id },
          { failedLoginAttempts: 0 },
        );
        const session = await this.sessions.create(manager, staff.id, info);
        return { ok: true, value: { ...session, staff } };
      },
    );

    if (!outcome.ok) throw outcome.error;
    const { token, expiresAt, staff } = outcome.value;
    if (!this.config.STAFF_MFA_REQUIRED) {
      return {
        token,
        expiresAt,
        response: { staff: this.toMe(staff, true), next: 'done' },
      };
    }
    return {
      token,
      expiresAt,
      response: {
        staff: this.toMe(staff, false),
        next: staff.mfaEnabledAt ? 'mfa_verify' : 'mfa_setup',
      },
    };
  }

  /** Starts enrolment: a new secret, stored sealed until a code confirms it. */
  async beginMfaSetup(auth: StaffAuth): Promise<MfaSetupResponse> {
    if (auth.mfaEnabled) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Two-factor authentication is already set up.',
      );
    }
    const secret = newTotpSecret();
    await this.systemDb.manager.update(
      PlatformStaffEntity,
      { id: auth.staffId },
      { mfaPendingSecretEncrypted: this.secretBox.seal(secret) },
    );
    const otpauthUrl = totpUri(auth.email, secret);
    return { otpauthUrl, qrCodeDataUrl: await totpQrCode(otpauthUrl), secret };
  }

  async confirmMfaSetup(
    auth: StaffAuth,
    code: string,
    info: ClientInfo,
  ): Promise<StaffMe> {
    const outcome = await this.systemDb.transaction(
      async (manager): Promise<Outcome<PlatformStaffEntity>> => {
        const staff = await this.lockStaff(manager, auth.staffId);
        if (staff.mfaEnabledAt) {
          return {
            ok: false,
            error: conflict(
              ERROR_CODES.CONFLICT,
              'Two-factor authentication is already set up.',
            ),
          };
        }
        if (!staff.mfaPendingSecretEncrypted) {
          return {
            ok: false,
            error: fieldError(
              'code',
              'Start the set-up again to get a new QR code.',
            ),
          };
        }
        const secret = this.secretBox.open(staff.mfaPendingSecretEncrypted);
        if (!(await verifyTotp(secret, code))) {
          return {
            ok: false,
            error: await this.recordFailure(
              manager,
              staff,
              info,
              invalidCode(),
            ),
          };
        }

        const now = this.clock.now();
        await manager.update(
          PlatformStaffEntity,
          { id: staff.id },
          {
            mfaSecretEncrypted: staff.mfaPendingSecretEncrypted,
            mfaPendingSecretEncrypted: null,
            mfaEnabledAt: now,
            failedLoginAttempts: 0,
            lastLoginAt: now,
          },
        );
        await this.sessions.markMfaVerified(manager, auth.sessionId);
        await this.record(
          manager,
          auth,
          'staff.mfa.enabled',
          'Two-factor authentication set up',
          info,
        );
        await this.record(
          manager,
          auth,
          'staff.login.succeeded',
          'Signed in to the admin portal',
          info,
        );
        return { ok: true, value: { ...staff, mfaEnabledAt: now } };
      },
    );

    if (!outcome.ok) throw outcome.error;
    return this.toMe(outcome.value, true);
  }

  async verifyMfa(
    auth: StaffAuth,
    code: string,
    info: ClientInfo,
  ): Promise<StaffMe> {
    const outcome = await this.systemDb.transaction(
      async (manager): Promise<Outcome<PlatformStaffEntity>> => {
        const staff = await this.lockStaff(manager, auth.staffId);
        if (!staff.mfaSecretEncrypted) {
          return {
            ok: false,
            error: new AppException(
              HttpStatus.FORBIDDEN,
              ERROR_CODES.MFA_SETUP_REQUIRED,
              'Set up two-factor authentication first.',
            ),
          };
        }
        if (staff.lockedAt) return { ok: false, error: lockedOut() };
        if (
          !(await verifyTotp(
            this.secretBox.open(staff.mfaSecretEncrypted),
            code,
          ))
        ) {
          return {
            ok: false,
            error: await this.recordFailure(
              manager,
              staff,
              info,
              invalidCode(),
            ),
          };
        }

        await manager.update(
          PlatformStaffEntity,
          { id: staff.id },
          { failedLoginAttempts: 0, lastLoginAt: this.clock.now() },
        );
        await this.sessions.markMfaVerified(manager, auth.sessionId);
        await this.record(
          manager,
          auth,
          'staff.login.succeeded',
          'Signed in to the admin portal',
          info,
        );
        return { ok: true, value: staff };
      },
    );

    if (!outcome.ok) throw outcome.error;
    return this.toMe(outcome.value, true);
  }

  async changePassword(
    auth: StaffAuth,
    input: ChangePasswordBody,
    info: ClientInfo,
  ): Promise<StaffMe> {
    const outcome = await this.systemDb.transaction(
      async (manager): Promise<Outcome<PlatformStaffEntity>> => {
        const staff = await this.lockStaff(manager, auth.staffId);
        if (
          !(await this.hasher.verify(input.currentPassword, staff.passwordHash))
        ) {
          return {
            ok: false,
            error: await this.recordFailure(
              manager,
              staff,
              info,
              fieldError(
                'currentPassword',
                'Your current password is incorrect.',
              ),
            ),
          };
        }
        await manager.update(
          PlatformStaffEntity,
          { id: staff.id },
          {
            passwordHash: await this.hasher.hash(input.newPassword),
            mustChangePassword: false,
            failedLoginAttempts: 0,
          },
        );
        await this.record(
          manager,
          auth,
          'staff.password.changed',
          'Password changed',
          info,
        );
        return { ok: true, value: { ...staff, mustChangePassword: false } };
      },
    );

    if (!outcome.ok) throw outcome.error;
    return this.toMe(outcome.value, auth.mfaVerified);
  }

  async logout(auth: StaffAuth, info: ClientInfo): Promise<void> {
    await this.systemDb.transaction(async (manager) => {
      await this.sessions.revoke(manager, auth.sessionId, 'logout');
      await this.record(
        manager,
        auth,
        'staff.logout',
        'Signed out of the admin portal',
        info,
      );
    });
  }

  me(auth: StaffAuth): StaffMe {
    return {
      id: auth.staffId,
      name: auth.name,
      email: auth.email,
      staffRole: auth.staffRole,
      mfaEnabled: auth.mfaEnabled,
      mfaVerified: auth.mfaVerified,
      mustChangePassword: auth.mustChangePassword,
    };
  }

  /** Counts a failed password or code, locking the account at the limit. */
  private async recordFailure(
    manager: EntityManager,
    staff: PlatformStaffEntity,
    info: ClientInfo,
    error: AppException = invalidCredentials(),
  ): Promise<AppException> {
    const attempts = staff.failedLoginAttempts + 1;
    const locking = attempts >= MAX_FAILED_ATTEMPTS;
    await manager.update(
      PlatformStaffEntity,
      { id: staff.id },
      locking
        ? { failedLoginAttempts: attempts, lockedAt: this.clock.now() }
        : { failedLoginAttempts: attempts },
    );
    const actor = { staffId: staff.id, name: staff.name };
    await this.record(
      manager,
      actor,
      'staff.login.failed',
      `Failed sign-in (attempt ${attempts})`,
      info,
    );
    if (locking) {
      await this.sessions.revokeAllForStaff(manager, staff.id, 'locked');
      await this.record(
        manager,
        actor,
        'staff.account.locked',
        'Staff account locked',
        info,
      );
      return lockedOut();
    }
    return error;
  }

  private async lockStaff(
    manager: EntityManager,
    staffId: string,
  ): Promise<PlatformStaffEntity> {
    return manager.findOneOrFail(PlatformStaffEntity, {
      where: { id: staffId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private record(
    manager: EntityManager,
    actor: Pick<StaffAuth, 'staffId' | 'name'>,
    action: AuditAction,
    summary: string,
    info: ClientInfo,
  ): Promise<void> {
    return this.audit.record(manager, {
      scope: 'platform',
      orgId: null,
      actor: staffActor(actor),
      action,
      entityType: 'staff',
      entityId: actor.staffId,
      summary,
      metadata: clientMetadata(info),
    });
  }

  private toMe(staff: PlatformStaffEntity, mfaVerified: boolean): StaffMe {
    return {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      staffRole: staff.staffRole,
      mfaEnabled: staff.mfaEnabledAt !== null,
      mfaVerified,
      mustChangePassword: staff.mustChangePassword,
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('not-a-real-password');
    return this.dummyHash;
  }
}
