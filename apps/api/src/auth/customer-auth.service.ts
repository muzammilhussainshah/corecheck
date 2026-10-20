import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type changePinSchema,
  type customerLoginSchema,
  ERROR_CODES,
  MAX_FAILED_PIN_ATTEMPTS,
  type OrganisationStatus,
  type UserStatus,
} from '@corecheck/shared';
import {
  type AuditActor,
  AuditService,
  clientMetadata,
} from '../audit/audit.service.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { SecretHasher } from '../common/crypto.js';
import { AppException } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { UserEntity } from '../database/entities.js';
import { SystemDb } from '../database/db-context.js';
import { type CustomerAuth, fullName } from './auth-context.js';
import {
  type CreatedSession,
  CustomerSessionsService,
} from './customer-sessions.service.js';

type LoginBody = z.output<typeof customerLoginSchema>;
type ChangePinBody = z.output<typeof changePinSchema>;

type Outcome<T> = { ok: true; value: T } | { ok: false; error: AppException };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = <T>(error: AppException): Outcome<T> => ({ ok: false, error });

interface SignInRow {
  id: string;
  orgId: string;
  firstName: string;
  lastName: string;
  username: string;
  status: UserStatus;
  pinHash: string;
  mustChangePin: boolean;
  tempPinExpiresAt: Date | null;
  failedPinAttempts: number;
  orgStatus: OrganisationStatus;
  startsOn: string;
  timeZone: string;
}

// Locks the user row so concurrent attempts are counted one after another.
const SIGN_IN_LOOKUP = /* sql */ `
  select u.id, u.org_id as "orgId", u.first_name as "firstName",
         u.last_name as "lastName", u.username, u.status, u.pin_hash as "pinHash",
         u.must_change_pin as "mustChangePin", u.temp_pin_expires_at as "tempPinExpiresAt",
         u.failed_pin_attempts as "failedPinAttempts",
         o.status as "orgStatus", o.starts_on as "startsOn", o.time_zone as "timeZone"
    from corecheck.users u
    join corecheck.organisations o on o.id = u.org_id
   where %WHERE%
     for update of u`;

const invalidCredentials = (remainingAttempts?: number) =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Incorrect username or PIN.',
    remainingAttempts === undefined ? {} : { details: { remainingAttempts } },
  );

const accountLocked = (
  message = 'Your account is locked. Contact your administrator to unlock it.',
) =>
  new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.ACCOUNT_LOCKED, message);

/**
 * Username-and-PIN sign-in (USR-002..USR-006, SEC-004). Failure paths commit
 * their attempt counters and audit entries before the error is returned, so a
 * rejected request still leaves its trace.
 */
@Injectable()
export class CustomerAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly systemDb: SystemDb,
    private readonly sessions: CustomerSessionsService,
    private readonly hasher: SecretHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async login(
    input: LoginBody,
    info: ClientInfo,
  ): Promise<{ session: CreatedSession; auth: CustomerAuth }> {
    const outcome = await this.systemDb.transaction(async (manager) => {
      const [user] = (await manager.query(
        SIGN_IN_LOOKUP.replace('%WHERE%', 'u.username = $1'),
        [input.username],
      )) as SignInRow[];

      if (!user) {
        // Spend the same time as a real check so response timing does not
        // reveal which usernames exist.
        await this.hasher.verify(input.pin, await this.getDummyHash());
        return fail<CreatedSession>(invalidCredentials());
      }

      const now = this.clock.now();
      const record = this.recorder(manager, user, info);

      const blocked = this.signInBlock(user, now);
      if (blocked) {
        await record(
          'auth.login.blocked',
          `Sign-in blocked: ${blocked.message}`,
          {
            reason: blocked.code,
          },
        );
        return fail<CreatedSession>(blocked);
      }

      if (!(await this.hasher.verify(input.pin, user.pinHash))) {
        return fail<CreatedSession>(
          await this.recordWrongPin(manager, user, record, now),
        );
      }

      if (
        user.mustChangePin &&
        user.tempPinExpiresAt &&
        user.tempPinExpiresAt <= now
      ) {
        await record(
          'auth.login.blocked',
          'Sign-in blocked: temporary PIN expired',
          {
            reason: ERROR_CODES.TEMPORARY_PIN_EXPIRED,
          },
        );
        return fail<CreatedSession>(
          new AppException(
            HttpStatus.UNAUTHORIZED,
            ERROR_CODES.TEMPORARY_PIN_EXPIRED,
            'Your temporary PIN has expired. Ask your administrator for a new one.',
          ),
        );
      }

      await manager.update(
        UserEntity,
        { id: user.id },
        { failedPinAttempts: 0, lastLoginAt: now },
      );
      const session = await this.sessions.create(
        manager,
        user,
        input.client,
        info,
      );
      if (session.replacedSessions > 0) {
        await record(
          'auth.session.replaced',
          'Earlier session ended by a sign-in on another device',
          { client: input.client },
        );
      }
      await record('auth.login.succeeded', `Signed in (${input.client})`, {
        client: input.client,
      });
      return ok(session);
    });

    if (!outcome.ok) throw outcome.error;
    const auth = await this.sessions.authenticate(outcome.value.token);
    return { session: outcome.value, auth };
  }

  /** Replaces the current PIN; required after a temporary PIN (USR-003). */
  async changePin(
    auth: CustomerAuth,
    input: ChangePinBody,
    info: ClientInfo,
  ): Promise<void> {
    const outcome = await this.systemDb.transaction(async (manager) => {
      const [user] = (await manager.query(
        SIGN_IN_LOOKUP.replace('%WHERE%', 'u.id = $1'),
        [auth.userId],
      )) as SignInRow[];
      if (!user) return fail<void>(accountLocked());

      const now = this.clock.now();
      const record = this.recorder(manager, user, info);

      if (!(await this.hasher.verify(input.currentPin, user.pinHash))) {
        const error = await this.recordWrongPin(manager, user, record, now);
        return fail<void>(
          error.code === ERROR_CODES.INVALID_CREDENTIALS
            ? new AppException(
                HttpStatus.BAD_REQUEST,
                ERROR_CODES.VALIDATION_FAILED,
                'Your current PIN is incorrect.',
                {
                  fieldErrors: [
                    {
                      field: 'currentPin',
                      message: 'Your current PIN is incorrect.',
                    },
                  ],
                  details: error.extras.details,
                },
              )
            : error,
        );
      }

      await manager.update(
        UserEntity,
        { id: user.id },
        {
          pinHash: await this.hasher.hash(input.newPin),
          mustChangePin: false,
          tempPinExpiresAt: null,
          failedPinAttempts: 0,
        },
      );
      await record(
        'auth.pin.changed',
        user.mustChangePin ? 'Temporary PIN replaced' : 'PIN changed',
        {},
      );
      return ok(undefined);
    });

    if (!outcome.ok) throw outcome.error;
  }

  async logout(auth: CustomerAuth, info: ClientInfo): Promise<void> {
    await this.systemDb.transaction(async (manager) => {
      await this.sessions.revoke(manager, auth.sessionId, 'logout');
      await this.audit.record(manager, {
        scope: 'tenant',
        orgId: auth.orgId,
        actor: {
          type: 'user',
          id: auth.userId,
          name: `${fullName(auth)} (${auth.username})`,
        },
        action: 'auth.logout',
        entityType: 'user',
        entityId: auth.userId,
        summary: `Signed out (${auth.client})`,
        metadata: clientMetadata(info),
      });
    });
  }

  /** Counts a wrong PIN, locking the account at the limit (USR-005). */
  private async recordWrongPin(
    manager: EntityManager,
    user: SignInRow,
    record: Recorder,
    now: Date,
  ): Promise<AppException> {
    const attempts = user.failedPinAttempts + 1;
    if (attempts >= MAX_FAILED_PIN_ATTEMPTS) {
      await manager.update(
        UserEntity,
        { id: user.id },
        { failedPinAttempts: attempts, status: 'locked', lockedAt: now },
      );
      await this.sessions.revokeAllForUser(manager, user.id, 'locked');
      await record('auth.login.failed', `Incorrect PIN (attempt ${attempts})`, {
        attempt: attempts,
      });
      await record(
        'auth.account.locked',
        `Account locked after ${attempts} incorrect PINs`,
        { attempt: attempts },
      );
      return accountLocked(
        'Too many incorrect PINs. Your account is now locked. Contact your administrator to unlock it.',
      );
    }

    await manager.update(
      UserEntity,
      { id: user.id },
      { failedPinAttempts: attempts },
    );
    await record(
      'auth.login.failed',
      `Incorrect PIN (attempt ${attempts} of ${MAX_FAILED_PIN_ATTEMPTS})`,
      { attempt: attempts },
    );
    return invalidCredentials(MAX_FAILED_PIN_ATTEMPTS - attempts);
  }

  /** Why this account may not sign in now, before the PIN is even checked. */
  private signInBlock(user: SignInRow, now: Date): AppException | null {
    const forbidden = (
      code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
      message: string,
    ) => new AppException(HttpStatus.FORBIDDEN, code, message);

    if (user.orgStatus === 'suspended') {
      return forbidden(
        ERROR_CODES.ORG_SUSPENDED,
        "Your organisation's CoreCheck account is suspended. Please contact the CoreCheck team.",
      );
    }
    if (user.orgStatus === 'archived') {
      return forbidden(
        ERROR_CODES.ORG_ARCHIVED,
        "Your organisation's CoreCheck account is closed. Please contact the CoreCheck team.",
      );
    }
    if (dateInTimeZone(now, user.timeZone) < user.startsOn) {
      return forbidden(
        ERROR_CODES.ORG_NOT_STARTED,
        `Your organisation's CoreCheck account starts on ${user.startsOn}.`,
      );
    }
    if (user.status === 'locked') return accountLocked();
    if (user.status === 'inactive') {
      return forbidden(
        ERROR_CODES.ACCOUNT_INACTIVE,
        'Your account has been deactivated. Contact your administrator.',
      );
    }
    return null;
  }

  private recorder(
    manager: EntityManager,
    user: SignInRow,
    info: ClientInfo,
  ): Recorder {
    const actor: AuditActor = {
      type: 'user',
      id: user.id,
      name: `${fullName(user)} (${user.username})`,
    };
    return (action, summary, metadata) =>
      this.audit.record(manager, {
        scope: 'tenant',
        orgId: user.orgId,
        actor,
        action,
        entityType: 'user',
        entityId: user.id,
        summary,
        metadata: { ...clientMetadata(info), ...metadata },
      });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('not-a-real-pin');
    return this.dummyHash;
  }
}

type Recorder = (
  action: AuditAction,
  summary: string,
  metadata: Record<string, unknown>,
) => Promise<void>;
