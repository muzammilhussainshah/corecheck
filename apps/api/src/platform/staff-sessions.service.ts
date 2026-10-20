import { Injectable } from '@nestjs/common';
import { type EntityManager, IsNull } from 'typeorm';
import {
  ERROR_CODES,
  type StaffRole,
  type StaffStatus,
} from '@corecheck/shared';
import type { StaffAuth } from '../auth/auth-context.js';
import { addSeconds, Clock } from '../common/clock.js';
import { hashToken, newSessionToken } from '../common/crypto.js';
import { unauthenticated } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { StaffSessionEntity } from '../database/entities.js';
import { SystemDb } from '../database/db-context.js';

interface StaffSessionRow {
  sessionId: string;
  mfaVerifiedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
  idleTimeoutSeconds: number;
  revokedAt: Date | null;
  staffId: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  status: StaffStatus;
  lockedAt: Date | null;
  mfaEnabledAt: Date | null;
  mustChangePassword: boolean;
}

const STAFF_SESSION_LOOKUP = /* sql */ `
  select s.id as "sessionId", s.mfa_verified_at as "mfaVerifiedAt",
         s.expires_at as "expiresAt", s.last_seen_at as "lastSeenAt",
         s.idle_timeout_seconds as "idleTimeoutSeconds", s.revoked_at as "revokedAt",
         p.id as "staffId", p.name, p.email, p.staff_role as "staffRole", p.status,
         p.locked_at as "lockedAt", p.mfa_enabled_at as "mfaEnabledAt",
         p.must_change_password as "mustChangePassword"
    from corecheck.staff_sessions s
    join corecheck.platform_staff p on p.id = s.staff_id
   where s.token_hash = $1`;

const TOUCH_INTERVAL_MS = 60_000;

/** Internal staff sessions: shorter-lived than customer sessions; MFA-gated when STAFF_MFA_REQUIRED is on. */
@Injectable()
export class StaffSessionsService {
  constructor(
    private readonly systemDb: SystemDb,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async authenticate(token: string): Promise<StaffAuth> {
    const [row] = (await this.systemDb.manager.query(STAFF_SESSION_LOOKUP, [
      hashToken(token),
    ])) as StaffSessionRow[];
    if (!row) throw unauthenticated();
    if (row.revokedAt) {
      throw unauthenticated(
        ERROR_CODES.SESSION_REVOKED,
        'Please sign in again.',
      );
    }

    const now = this.clock.now();
    const idleSince = now.getTime() - row.lastSeenAt.getTime();
    if (now >= row.expiresAt || idleSince > row.idleTimeoutSeconds * 1000) {
      await this.revoke(this.systemDb.manager, row.sessionId, 'expired');
      throw unauthenticated(
        ERROR_CODES.SESSION_EXPIRED,
        'Your session has expired. Please sign in again.',
      );
    }
    if (row.status !== 'active' || row.lockedAt) {
      await this.revoke(
        this.systemDb.manager,
        row.sessionId,
        'account_blocked',
      );
      throw unauthenticated(
        row.lockedAt
          ? ERROR_CODES.ACCOUNT_LOCKED
          : ERROR_CODES.ACCOUNT_INACTIVE,
        'Your staff account is not active. Contact a CoreCheck owner.',
      );
    }

    if (idleSince > TOUCH_INTERVAL_MS) {
      await this.systemDb.manager.update(
        StaffSessionEntity,
        { id: row.sessionId },
        { lastSeenAt: now },
      );
    }

    return {
      sessionId: row.sessionId,
      staffId: row.staffId,
      name: row.name,
      email: row.email,
      staffRole: row.staffRole,
      mfaEnabled: row.mfaEnabledAt !== null,
      // With staff MFA switched off, the password alone completes sign-in.
      mfaVerified:
        !this.config.STAFF_MFA_REQUIRED || row.mfaVerifiedAt !== null,
      mustChangePassword: row.mustChangePassword,
    };
  }

  async create(
    manager: EntityManager,
    staffId: string,
    info: ClientInfo,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock.now();
    const { token, tokenHash } = newSessionToken();
    const expiresAt = addSeconds(
      now,
      this.config.STAFF_SESSION_MAX_HOURS * 60 * 60,
    );
    await manager.insert(StaffSessionEntity, {
      staffId,
      tokenHash,
      ip: info.ip,
      userAgent: info.userAgent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      idleTimeoutSeconds: this.config.STAFF_SESSION_IDLE_MINUTES * 60,
    });
    return { token, expiresAt };
  }

  async markMfaVerified(
    manager: EntityManager,
    sessionId: string,
  ): Promise<void> {
    await manager.update(
      StaffSessionEntity,
      { id: sessionId },
      { mfaVerifiedAt: this.clock.now() },
    );
  }

  async revoke(
    manager: EntityManager,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    await manager.update(
      StaffSessionEntity,
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: this.clock.now(), revokeReason: reason },
    );
  }

  async revokeAllForStaff(
    manager: EntityManager,
    staffId: string,
    reason: string,
  ): Promise<void> {
    await manager.update(
      StaffSessionEntity,
      { staffId, revokedAt: IsNull() },
      { revokedAt: this.clock.now(), revokeReason: reason },
    );
  }
}
