import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type CreateOrganisationResponse,
  type createOrganisationSchema,
  ERROR_CODES,
  type IssuedCredentials,
  type listOrganisationsQuerySchema,
  type OrganisationAdmin,
  type OrganisationDetail,
  type OrganisationStatus,
  type OrganisationSummary,
  type Paginated,
  type updateOrganisationSchema,
} from '@corecheck/shared';
import {
  type AuditActor,
  AuditService,
  clientMetadata,
  staffActor,
} from '../audit/audit.service.js';
import type { StaffAuth } from '../auth/auth-context.js';
import { CustomerSessionsService } from '../auth/customer-sessions.service.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { SecretHasher } from '../common/crypto.js';
import { conflict, fieldError, notFound } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import { OrganisationEntity, UserEntity } from '../database/entities.js';
import { PlatformDb, SystemDb } from '../database/db-context.js';
import {
  issueTemporaryPin,
  temporaryPinColumns,
} from '../users/credentials.js';
import { provisionOrganisation } from './provisioning.js';

type CreateBody = z.output<typeof createOrganisationSchema>;
type UpdateBody = z.output<typeof updateOrganisationSchema>;
type ListQuery = z.output<typeof listOrganisationsQuerySchema>;

export type StatusAction = 'suspend' | 'activate' | 'archive';

const TRANSITIONS: Record<
  StatusAction,
  {
    from: OrganisationStatus[];
    to: OrganisationStatus;
    audit: AuditAction;
    verb: string;
  }
> = {
  suspend: {
    from: ['active'],
    to: 'suspended',
    audit: 'organisation.suspended',
    verb: 'Suspended',
  },
  activate: {
    from: ['suspended', 'archived'],
    to: 'active',
    audit: 'organisation.activated',
    verb: 'Activated',
  },
  archive: {
    from: ['active', 'suspended'],
    to: 'archived',
    audit: 'organisation.archived',
    verb: 'Archived',
  },
};

interface OrganisationRow extends OrganisationEntity {
  activeUsers: number;
  lockedUsers: number;
  inactiveUsers: number;
  plants: number;
  storedFiles: number;
  storageBytes: number;
}

const SORT_COLUMNS: Record<ListQuery['sort'], string> = {
  name: 'lower(o.name)',
  status: 'o.status',
  expiresOn: 'o.expires_on',
  createdAt: 'o.created_at',
};

const ORGANISATION_SELECT = /* sql */ `
  select o.id, o.name, o.industry, o.contact_name as "contactName",
         o.contact_email as "contactEmail", o.contact_phone as "contactPhone",
         o.address, o.country, o.time_zone as "timeZone", o.seat_limit as "seatLimit",
         o.starts_on as "startsOn", o.expires_on as "expiresOn", o.status,
         o.created_at as "createdAt", o.updated_at as "updatedAt",
         coalesce(c.active_users, 0) as "activeUsers",
         coalesce(c.locked_users, 0) as "lockedUsers",
         coalesce(c.inactive_users, 0) as "inactiveUsers",
         coalesce(p.plants, 0) as "plants",
         coalesce(s.files, 0) as "storedFiles",
         coalesce(s.bytes, 0)::float8 as "storageBytes"
    from corecheck.organisations o
    left join corecheck.organisation_user_counts() c on c.org_id = o.id
    left join corecheck.organisation_plant_counts() p on p.org_id = o.id
    left join corecheck.organisation_storage_usage() s on s.org_id = o.id`;

interface AdminRow {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  status: OrganisationAdmin['status'];
  lastLoginAt: Date | null;
}

const toAdmin = (row: AdminRow): OrganisationAdmin => ({
  id: row.id,
  firstName: row.firstName,
  lastName: row.lastName,
  username: row.username,
  status: row.status,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
});

const toCredentials = (
  username: string,
  pin: { pin: string; expiresAt: Date },
): IssuedCredentials => ({
  username,
  temporaryPin: pin.pin,
  expiresAt: pin.expiresAt.toISOString(),
});

/** Organisation fields compared and logged when they change. */
const AUDITED_FIELDS = [
  'name',
  'industry',
  'contactName',
  'contactEmail',
  'contactPhone',
  'address',
  'country',
  'timeZone',
  'seatLimit',
  'startsOn',
  'expiresOn',
] as const;

/**
 * Internal provisioning of customer organisations (FRD 23). Reads run as
 * corecheck_platform, which sees only organisations plus user counts and
 * Organisation Admin identities. Provisioning and account actions that must
 * touch customer tables run through SystemDb, each limited to its one purpose.
 */
@Injectable()
export class OrganisationsService {
  constructor(
    private readonly platformDb: PlatformDb,
    private readonly systemDb: SystemDb,
    private readonly customerSessions: CustomerSessionsService,
    private readonly hasher: SecretHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  list(
    auth: StaffAuth,
    query: ListQuery,
  ): Promise<Paginated<OrganisationSummary>> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      const params = new SqlParams();
      const where: string[] = [];
      if (query.search) {
        const term = params.add(`%${escapeLike(query.search)}%`);
        where.push(
          `(o.name ilike ${term} or o.contact_name ilike ${term} or o.industry ilike ${term})`,
        );
      }
      if (query.status) where.push(`o.status = ${params.add(query.status)}`);
      const filter = where.length ? `where ${where.join(' and ')}` : '';

      const [{ total }] = (await manager.query(
        `select count(*)::int as total from corecheck.organisations o ${filter}`,
        params.values,
      )) as [{ total: number }];
      const rows = (await manager.query(
        `${ORGANISATION_SELECT} ${filter}
          order by ${SORT_COLUMNS[query.sort]} ${query.order}, o.id
          limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
        params.values,
      )) as OrganisationRow[];

      return {
        items: rows.map((row) => this.toSummary(row)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(auth: StaffAuth, id: string): Promise<OrganisationDetail> {
    return this.platformDb.transaction(auth.staffId, (manager) =>
      this.loadDetail(manager, id),
    );
  }

  listAdmins(auth: StaffAuth, orgId: string): Promise<OrganisationAdmin[]> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      await this.loadDetail(manager, orgId);
      const rows = (await manager.query(
        `select id, first_name as "firstName", last_name as "lastName", username, status,
                last_login_at as "lastLoginAt"
           from corecheck.organisation_admins($1)`,
        [orgId],
      )) as AdminRow[];
      return rows.map(toAdmin);
    });
  }

  /**
   * Creates an isolated organisation, its standard roles and disciplines, and
   * its first Organisation Admin with a generated username and temporary PIN
   * (IAD-002, IAD-010, IAD-AC-01). One transaction: all or nothing.
   */
  async create(
    auth: StaffAuth,
    input: CreateBody,
    info: ClientInfo,
  ): Promise<CreateOrganisationResponse> {
    const { orgId, admin, credentials } = await this.systemDb.transaction(
      (manager) =>
        provisionOrganisation(
          manager,
          { hasher: this.hasher, audit: this.audit, now: this.clock.now() },
          input,
          staffActor(auth),
          clientMetadata(info),
        ),
    );
    return {
      organisation: await this.get(auth, orgId),
      firstAdmin: admin,
      credentials,
    };
  }

  update(
    auth: StaffAuth,
    id: string,
    input: UpdateBody,
    info: ClientInfo,
  ): Promise<OrganisationDetail> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      const current = await this.loadDetail(manager, id, true);

      const startsOn = input.startsOn ?? current.startsOn;
      const expiresOn = input.expiresOn ?? current.expiresOn;
      if (expiresOn < startsOn) {
        throw fieldError(
          'expiresOn',
          'Expiry date must be on or after the start date.',
        );
      }
      if (
        input.seatLimit !== undefined &&
        input.seatLimit < current.seatsUsed
      ) {
        throw fieldError(
          'seatLimit',
          `${current.seatsUsed} users currently hold seats. Deactivate users before lowering the limit below ${current.seatsUsed}.`,
        );
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const field of AUDITED_FIELDS) {
        const next = input[field];
        if (next !== undefined && next !== current[field]) {
          before[field] = current[field];
          after[field] = next;
        }
      }
      if (Object.keys(after).length === 0) return current;

      await manager.update(OrganisationEntity, { id }, after);
      await this.audit.record(manager, {
        scope: 'platform',
        orgId: id,
        actor: staffActor(auth),
        action: 'organisation.updated',
        entityType: 'organisation',
        entityId: id,
        summary: `Updated ${current.name}: ${Object.keys(after).join(', ')}`,
        before,
        after,
        metadata: clientMetadata(info),
      });
      return this.loadDetail(manager, id);
    });
  }

  /**
   * Suspends, reactivates or archives an organisation. Suspension and archival
   * end every customer session at once (IAD-008).
   */
  async changeStatus(
    auth: StaffAuth,
    id: string,
    action: StatusAction,
    reason: string | undefined,
    info: ClientInfo,
  ): Promise<OrganisationDetail> {
    const transition = TRANSITIONS[action];
    await this.systemDb.transaction(async (manager) => {
      const org = await manager.findOne(OrganisationEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!org) throw notFound('Organisation');
      if (!transition.from.includes(org.status)) {
        throw conflict(
          ERROR_CODES.CONFLICT,
          `This organisation is ${org.status}; it cannot be ${transition.verb.toLowerCase()}.`,
        );
      }

      await manager.update(
        OrganisationEntity,
        { id },
        { status: transition.to },
      );
      if (transition.to !== 'active') {
        await this.customerSessions.revokeAllForOrganisation(
          manager,
          id,
          transition.to === 'suspended'
            ? 'organisation_suspended'
            : 'organisation_archived',
        );
      }
      await this.audit.record(manager, {
        scope: 'platform',
        orgId: id,
        actor: staffActor(auth),
        action: transition.audit,
        entityType: 'organisation',
        entityId: id,
        summary: `${transition.verb} ${org.name}${reason ? `: ${reason}` : ''}`,
        before: { status: org.status },
        after: { status: transition.to },
        metadata: { ...clientMetadata(info), ...(reason ? { reason } : {}) },
      });
    });
    return this.get(auth, id);
  }

  /** New temporary PIN for an Organisation Admin; also clears a lockout (IAD-004). */
  async resetAdminPin(
    auth: StaffAuth,
    orgId: string,
    userId: string,
    info: ClientInfo,
  ): Promise<{ admin: OrganisationAdmin; credentials: IssuedCredentials }> {
    return this.systemDb.transaction(async (manager) => {
      const admin = await this.lockAdmin(manager, orgId, userId);
      const temporary = await issueTemporaryPin(this.hasher, this.clock.now());
      await manager.update(
        UserEntity,
        { id: userId },
        {
          ...temporaryPinColumns(temporary),
          ...(admin.status === 'locked'
            ? { status: 'active' as const, lockedAt: null }
            : {}),
        },
      );
      await this.customerSessions.revokeAllForUser(
        manager,
        userId,
        'pin_reset',
      );
      await this.recordAdminAction(
        manager,
        auth,
        info,
        orgId,
        admin,
        'user.pin.reset',
        `PIN of Organisation Admin ${admin.username} reset by CoreCheck`,
      );
      return {
        admin: toAdmin({
          ...admin,
          status: admin.status === 'locked' ? 'active' : admin.status,
        }),
        credentials: toCredentials(admin.username, temporary),
      };
    });
  }

  async unlockAdmin(
    auth: StaffAuth,
    orgId: string,
    userId: string,
    info: ClientInfo,
  ): Promise<OrganisationAdmin> {
    return this.systemDb.transaction(async (manager) => {
      const admin = await this.lockAdmin(manager, orgId, userId);
      if (admin.status !== 'locked') {
        throw conflict(ERROR_CODES.CONFLICT, 'This account is not locked.');
      }
      await manager.update(
        UserEntity,
        { id: userId },
        {
          status: 'active',
          lockedAt: null,
          failedPinAttempts: 0,
        },
      );
      await this.recordAdminAction(
        manager,
        auth,
        info,
        orgId,
        admin,
        'user.unlocked',
        `Organisation Admin ${admin.username} unlocked by CoreCheck`,
      );
      return toAdmin({ ...admin, status: 'active' });
    });
  }

  private async lockAdmin(
    manager: EntityManager,
    orgId: string,
    userId: string,
  ): Promise<AdminRow> {
    const [admin] = (await manager.query(
      `select u.id, u.first_name as "firstName", u.last_name as "lastName", u.username,
              u.status, u.last_login_at as "lastLoginAt"
         from corecheck.users u
         join corecheck.roles r on r.id = u.role_id
        where u.id = $1 and u.org_id = $2 and r.standard_key = 'admin'
          for update of u`,
      [userId, orgId],
    )) as AdminRow[];
    if (!admin) throw notFound('Organisation Admin');
    return admin;
  }

  /** Staff actions on a customer account are visible to both sides. */
  private async recordAdminAction(
    manager: EntityManager,
    auth: StaffAuth,
    info: ClientInfo,
    orgId: string,
    admin: AdminRow,
    action: 'user.pin.reset' | 'user.unlocked',
    summary: string,
  ): Promise<void> {
    const actor: AuditActor = staffActor(auth);
    for (const scope of ['platform', 'tenant'] as const) {
      await this.audit.record(manager, {
        scope,
        orgId,
        actor,
        action,
        entityType: 'user',
        entityId: admin.id,
        summary,
        metadata: scope === 'platform' ? clientMetadata(info) : {},
      });
    }
  }

  private async loadDetail(
    manager: EntityManager,
    id: string,
    lock = false,
  ): Promise<OrganisationDetail> {
    const [row] = (await manager.query(
      `${ORGANISATION_SELECT} where o.id = $1 ${lock ? 'for update of o' : ''}`,
      [id],
    )) as OrganisationRow[];
    if (!row) throw notFound('Organisation');
    return {
      ...this.toSummary(row),
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      address: row.address,
      timeZone: row.timeZone,
      usage: {
        activeUsers: row.activeUsers,
        lockedUsers: row.lockedUsers,
        inactiveUsers: row.inactiveUsers,
        seatsUsed: row.activeUsers + row.lockedUsers,
        plants: row.plants,
        storedFiles: row.storedFiles,
        storageBytes: row.storageBytes,
      },
    };
  }

  private toSummary(row: OrganisationRow): OrganisationSummary {
    return {
      id: row.id,
      name: row.name,
      industry: row.industry,
      country: row.country,
      status: row.status,
      seatLimit: row.seatLimit,
      seatsUsed: row.activeUsers + row.lockedUsers,
      startsOn: row.startsOn,
      expiresOn: row.expiresOn,
      expired: dateInTimeZone(this.clock.now(), row.timeZone) > row.expiresOn,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
