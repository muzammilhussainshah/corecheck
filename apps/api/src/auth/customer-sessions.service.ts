import { Injectable } from '@nestjs/common';
import { type EntityManager, IsNull } from 'typeorm';
import {
  type ClientType,
  ERROR_CODES,
  type ErrorCode,
  isPermissionCode,
  type OrganisationStatus,
  type PermissionCode,
  type StandardRoleKey,
  type UserStatus,
} from '@corecheck/shared';
import { addSeconds, Clock, dateInTimeZone } from '../common/clock.js';
import { hashToken, newSessionToken } from '../common/crypto.js';
import { unauthenticated } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { InjectConfig, type AppConfig } from '../config/app-config.js';
import { UserSessionEntity } from '../database/entities.js';
import { SystemDb } from '../database/db-context.js';
import type { CustomerAuth } from './auth-context.js';

export type RevokeReason =
  | 'logout'
  | 'replaced'
  | 'expired'
  | 'pin_reset'
  | 'locked'
  | 'deactivated'
  | 'organisation_suspended'
  | 'organisation_archived';

const REVOKED_MESSAGES: Record<RevokeReason, [ErrorCode, string]> = {
  logout: [
    ERROR_CODES.SESSION_REVOKED,
    'You have signed out. Please sign in again.',
  ],
  replaced: [
    ERROR_CODES.SESSION_REPLACED,
    'You were signed out because your account signed in on another device.',
  ],
  expired: [
    ERROR_CODES.SESSION_EXPIRED,
    'Your session has expired. Please sign in again.',
  ],
  pin_reset: [
    ERROR_CODES.SESSION_REVOKED,
    'Your PIN was reset by an administrator. Sign in with the new temporary PIN.',
  ],
  locked: [
    ERROR_CODES.ACCOUNT_LOCKED,
    'Your account is locked. Contact your administrator.',
  ],
  deactivated: [
    ERROR_CODES.ACCOUNT_INACTIVE,
    'Your account has been deactivated. Contact your administrator.',
  ],
  organisation_suspended: [
    ERROR_CODES.ORG_SUSPENDED,
    "Your organisation's CoreCheck account is suspended. Please contact the CoreCheck team.",
  ],
  organisation_archived: [
    ERROR_CODES.ORG_ARCHIVED,
    "Your organisation's CoreCheck account is closed. Please contact the CoreCheck team.",
  ],
};

interface SessionRow {
  sessionId: string;
  client: ClientType;
  expiresAt: Date;
  lastSeenAt: Date;
  idleTimeoutSeconds: number;
  revokedAt: Date | null;
  revokeReason: RevokeReason | null;
  userId: string;
  orgId: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  userStatus: UserStatus;
  mustChangePin: boolean;
  roleId: string;
  roleName: string;
  standardKey: StandardRoleKey | null;
  orgWideScope: boolean;
  orgName: string;
  timeZone: string;
  orgStatus: OrganisationStatus;
  startsOn: string;
  expiresOn: string;
  permissions: string[];
  siteIds: string[];
  teamIds: string[];
  disciplineIds: string[];
}

const SESSION_LOOKUP = /* sql */ `
  select s.id as "sessionId", s.client, s.expires_at as "expiresAt",
         s.last_seen_at as "lastSeenAt", s.idle_timeout_seconds as "idleTimeoutSeconds",
         s.revoked_at as "revokedAt", s.revoke_reason as "revokeReason",
         u.id as "userId", u.org_id as "orgId", u.first_name as "firstName",
         u.last_name as "lastName", u.username, u.email, u.status as "userStatus",
         u.must_change_pin as "mustChangePin",
         r.id as "roleId", r.name as "roleName", r.standard_key as "standardKey",
         r.org_wide_scope as "orgWideScope",
         o.name as "orgName", o.time_zone as "timeZone", o.status as "orgStatus",
         o.starts_on as "startsOn", o.expires_on as "expiresOn",
         array(select rp.permission from corecheck.role_permissions rp
                where rp.role_id = r.id order by 1) as permissions,
         array(select us.site_id from corecheck.user_sites us where us.user_id = u.id) as "siteIds",
         array(select ut.team_id from corecheck.user_teams ut where ut.user_id = u.id) as "teamIds",
         array(select ud.discipline_id from corecheck.user_disciplines ud
                where ud.user_id = u.id) as "disciplineIds"
    from corecheck.user_sessions s
    join corecheck.users u on u.id = s.user_id
    join corecheck.roles r on r.id = u.role_id
    join corecheck.organisations o on o.id = u.org_id
   where s.token_hash = $1`;

/** Renew last_seen_at at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
  /** How many still-live sessions on other devices this sign-in ended. */
  replacedSessions: number;
}

/**
 * Customer sessions: opaque random tokens whose SHA-256 is stored. Every
 * request re-reads the session, user, role and organisation, so revocation,
 * deactivation, permission and scope changes take effect immediately
 * (ROL-AC-03, MOB-AC-03).
 */
@Injectable()
export class CustomerSessionsService {
  constructor(
    private readonly systemDb: SystemDb,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async authenticate(token: string): Promise<CustomerAuth> {
    const [row] = (await this.systemDb.manager.query(SESSION_LOOKUP, [
      hashToken(token),
    ])) as SessionRow[];
    if (!row) throw unauthenticated();

    if (row.revokedAt) {
      const [code, message] = REVOKED_MESSAGES[row.revokeReason ?? 'expired'];
      throw unauthenticated(code, message);
    }

    const now = this.clock.now();
    const idleSince = now.getTime() - row.lastSeenAt.getTime();
    if (now >= row.expiresAt || idleSince > row.idleTimeoutSeconds * 1000) {
      await this.endSession(row.sessionId, 'expired');
    }

    const blocked = this.blockingReason(row, now);
    if (blocked) await this.endSession(row.sessionId, blocked);

    if (idleSince > TOUCH_INTERVAL_MS) {
      await this.systemDb.manager.update(
        UserSessionEntity,
        { id: row.sessionId },
        { lastSeenAt: now },
      );
    }

    return this.toAuth(row, now);
  }

  /** Starts a session, ending any other live one for the user (USR-006). */
  async create(
    manager: EntityManager,
    user: { id: string; orgId: string },
    client: ClientType,
    info: ClientInfo,
  ): Promise<CreatedSession> {
    const now = this.clock.now();
    const live = (await manager.query(
      `select id, expires_at as "expiresAt", last_seen_at as "lastSeenAt",
              idle_timeout_seconds as "idleTimeoutSeconds"
         from corecheck.user_sessions
        where user_id = $1 and revoked_at is null`,
      [user.id],
    )) as Array<
      Pick<
        UserSessionEntity,
        'id' | 'expiresAt' | 'lastSeenAt' | 'idleTimeoutSeconds'
      >
    >;

    let replacedSessions = 0;
    for (const session of live) {
      const stillValid =
        session.expiresAt > now &&
        now.getTime() - session.lastSeenAt.getTime() <=
          session.idleTimeoutSeconds * 1000;
      if (stillValid) replacedSessions += 1;
      await manager.update(
        UserSessionEntity,
        { id: session.id },
        { revokedAt: now, revokeReason: stillValid ? 'replaced' : 'expired' },
      );
    }

    const { maxSeconds, idleSeconds } = this.lifetime(client);
    const { token, tokenHash } = newSessionToken();
    const expiresAt = addSeconds(now, maxSeconds);
    const result = await manager.insert(UserSessionEntity, {
      orgId: user.orgId,
      userId: user.id,
      tokenHash,
      client,
      ip: info.ip,
      userAgent: info.userAgent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      idleTimeoutSeconds: idleSeconds,
    });
    const sessionId = (result.identifiers[0] as { id: string }).id;
    return { token, sessionId, expiresAt, replacedSessions };
  }

  async revoke(
    manager: EntityManager,
    sessionId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await manager.update(
      UserSessionEntity,
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: this.clock.now(), revokeReason: reason },
    );
  }

  /** Ends the user's live session, if any (deactivation, PIN reset, lockout). */
  async revokeAllForUser(
    manager: EntityManager,
    userId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await manager.query(
      `update corecheck.user_sessions
          set revoked_at = $2, revoke_reason = $3
        where user_id = $1 and revoked_at is null`,
      [userId, this.clock.now(), reason],
    );
  }

  /** Ends every live session in an organisation (suspension, archival). */
  async revokeAllForOrganisation(
    manager: EntityManager,
    orgId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await manager.query(
      `update corecheck.user_sessions
          set revoked_at = $2, revoke_reason = $3
        where org_id = $1 and revoked_at is null`,
      [orgId, this.clock.now(), reason],
    );
  }

  private lifetime(client: ClientType) {
    if (client === 'mobile') {
      const days = this.config.MOBILE_SESSION_DAYS * 24 * 60 * 60;
      // Field work is often offline for long stretches: no idle timeout
      // beyond the session's own lifetime.
      return { maxSeconds: days, idleSeconds: days };
    }
    return {
      maxSeconds: this.config.WEB_SESSION_MAX_HOURS * 60 * 60,
      idleSeconds: this.config.WEB_SESSION_IDLE_MINUTES * 60,
    };
  }

  private blockingReason(row: SessionRow, now: Date): RevokeReason | null {
    if (row.userStatus === 'locked') return 'locked';
    if (row.userStatus === 'inactive') return 'deactivated';
    if (row.orgStatus === 'suspended') return 'organisation_suspended';
    if (row.orgStatus === 'archived') return 'organisation_archived';
    // A session cannot exist before the start date (sign-in refuses it), but
    // dates can be edited afterwards.
    if (dateInTimeZone(now, row.timeZone) < row.startsOn)
      return 'organisation_suspended';
    return null;
  }

  private async endSession(
    sessionId: string,
    reason: RevokeReason,
  ): Promise<never> {
    await this.revoke(this.systemDb.manager, sessionId, reason);
    const [code, message] = REVOKED_MESSAGES[reason];
    throw unauthenticated(code, message);
  }

  private toAuth(row: SessionRow, now: Date): CustomerAuth {
    return {
      sessionId: row.sessionId,
      client: row.client,
      sessionExpiresAt: row.expiresAt,
      idleTimeoutSeconds: row.idleTimeoutSeconds,
      userId: row.userId,
      orgId: row.orgId,
      firstName: row.firstName,
      lastName: row.lastName,
      username: row.username,
      email: row.email,
      mustChangePin: row.mustChangePin,
      roleId: row.roleId,
      roleName: row.roleName,
      standardKey: row.standardKey,
      orgWideScope: row.orgWideScope,
      permissions: new Set(
        row.permissions.filter(isPermissionCode) as PermissionCode[],
      ),
      siteIds: row.siteIds,
      teamIds: row.teamIds,
      disciplineIds: row.disciplineIds,
      org: {
        name: row.orgName,
        timeZone: row.timeZone,
        status: row.orgStatus,
        expiresOn: row.expiresOn,
        readOnly: dateInTimeZone(now, row.timeZone) > row.expiresOn,
      },
    };
  }
}
