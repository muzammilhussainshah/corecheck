import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type createUserSchema,
  ERROR_CODES,
  type FieldError,
  type IdName,
  isPrivilegedRole,
  type IssuedCredentials,
  type listUsersQuerySchema,
  type Paginated,
  type SeatUsage,
  type StandardRoleKey,
  type updateUserSchema,
  type UserDetail,
  type UserStatus,
  type UserSummary,
  type UserWithCredentials,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CustomerSessionsService } from '../auth/customer-sessions.service.js';
import { Clock } from '../common/clock.js';
import { SecretHasher } from '../common/crypto.js';
import { isSeatLimitError, isUniqueViolation } from '../common/db-errors.js';
import {
  conflict,
  fieldError,
  forbidden,
  notFound,
  outOfScope,
  validationFailed,
} from '../common/errors.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import {
  UserDisciplineEntity,
  UserEntity,
  UserSiteEntity,
  UserTeamEntity,
} from '../database/entities.js';
import { SystemDb, TenantDb } from '../database/db-context.js';
import {
  type Actor,
  actorFrom,
  canAdminister,
  canAssignRole,
  canAssignSites,
  canViewUser,
  capabilitiesFor,
  type TargetUser,
} from './access-policy.js';
import { issueTemporaryPin, temporaryPinColumns } from './credentials.js';
import { generateUsername } from './username.js';

type CreateBody = z.output<typeof createUserSchema>;
type UpdateBody = z.output<typeof updateUserSchema>;
type ListQuery = z.output<typeof listUsersQuerySchema>;

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  status: UserStatus;
  mustChangePin: boolean;
  failedPinAttempts: number;
  lockedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  roleId: string;
  roleName: string;
  standardKey: StandardRoleKey | null;
  rolePermissions: string[];
  siteIds: string[];
  teamIds: string[];
  disciplineIds: string[];
}

const USER_SELECT = /* sql */ `
  select u.id, u.first_name as "firstName", u.last_name as "lastName", u.username,
         u.email, u.status, u.must_change_pin as "mustChangePin",
         u.failed_pin_attempts as "failedPinAttempts", u.locked_at as "lockedAt",
         u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
         r.id as "roleId", r.name as "roleName", r.standard_key as "standardKey",
         array(select rp.permission from corecheck.role_permissions rp
                where rp.role_id = r.id) as "rolePermissions",
         array(select us.site_id from corecheck.user_sites us where us.user_id = u.id) as "siteIds",
         array(select ut.team_id from corecheck.user_teams ut where ut.user_id = u.id) as "teamIds",
         array(select ud.discipline_id from corecheck.user_disciplines ud
                where ud.user_id = u.id) as "disciplineIds"
    from corecheck.users u
    join corecheck.roles r on r.id = u.role_id`;

const SORT_COLUMNS: Record<ListQuery['sort'], string> = {
  name: 'lower(u.last_name), lower(u.first_name)',
  username: 'u.username',
  role: 'lower(r.name)',
  status: 'u.status',
  lastLoginAt: 'u.last_login_at',
};

/** The three kinds of access scope a user can be assigned (SCP-002). */
const SCOPE_KINDS = [
  {
    field: 'siteIds',
    table: 'sites',
    label: 'site',
    link: UserSiteEntity,
    column: 'siteId',
  },
  {
    field: 'teamIds',
    table: 'teams',
    label: 'team',
    link: UserTeamEntity,
    column: 'teamId',
  },
  {
    field: 'disciplineIds',
    table: 'disciplines',
    label: 'discipline',
    link: UserDisciplineEntity,
    column: 'disciplineId',
  },
] as const;

type ScopeField = (typeof SCOPE_KINDS)[number]['field'];
type Scope = Record<ScopeField, string[]>;

interface RoleRef {
  id: string;
  name: string;
  standardKey: StandardRoleKey | null;
  archived: boolean;
  privileged: boolean;
}

const toTarget = (row: UserRow): TargetUser => ({
  id: row.id,
  status: row.status,
  privileged: isPrivilegedRole({
    standardKey: row.standardKey,
    permissions: row.rolePermissions,
  }),
  siteIds: row.siteIds,
  teamIds: row.teamIds,
});

/**
 * Customer user administration (FRD 16.1, ROL-005, SCP-004). Runs in the
 * request's tenant transaction, so row-level security keeps every statement
 * inside the organisation; the access policy narrows it further to the
 * caller's scope.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly systemDb: SystemDb,
    private readonly sessions: CustomerSessionsService,
    private readonly hasher: SecretHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async list(
    auth: CustomerAuth,
    query: ListQuery,
  ): Promise<Paginated<UserSummary>> {
    const params = new SqlParams();
    const where = [this.visibilityCondition(actorFrom(auth), params)];

    if (query.search) {
      const term = params.add(`%${escapeLike(query.search)}%`);
      where.push(
        `(u.first_name ilike ${term} or u.last_name ilike ${term} or u.username ilike ${term}
          or u.email ilike ${term} or (u.first_name || ' ' || u.last_name) ilike ${term})`,
      );
    }
    if (query.status) where.push(`u.status = ${params.add(query.status)}`);
    if (query.roleId) where.push(`u.role_id = ${params.add(query.roleId)}`);
    if (query.siteId) {
      where.push(`exists (select 1 from corecheck.user_sites f
                           where f.user_id = u.id and f.site_id = ${params.add(query.siteId)})`);
    }
    if (query.teamId) {
      where.push(`exists (select 1 from corecheck.user_teams f
                           where f.user_id = u.id and f.team_id = ${params.add(query.teamId)})`);
    }
    if (query.disciplineId) {
      where.push(`exists (select 1 from corecheck.user_disciplines f
                           where f.user_id = u.id and f.discipline_id = ${params.add(query.disciplineId)})`);
    }

    const order = `${SORT_COLUMNS[query.sort]} ${query.order} nulls last, u.id`;
    const [{ total }] = (await this.db.query(
      `select count(*)::int as total
         from corecheck.users u join corecheck.roles r on r.id = u.role_id
        where ${where.join(' and ')}`,
      params.values,
    )) as [{ total: number }];
    const page = (await this.db.query(
      `${USER_SELECT} where ${where.join(' and ')}
        order by ${order}
        limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
      params.values,
    )) as UserRow[];

    const names = await this.scopeNames(page);
    return {
      items: page.map((row) => this.toSummary(row, names)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: CustomerAuth, id: string): Promise<UserDetail> {
    const row = await this.loadVisible(auth, id);
    return this.toDetail(row, actorFrom(auth));
  }

  async seatUsage(): Promise<SeatUsage> {
    const [usage] = (await this.db.query(
      `select o.seat_limit as "limit",
              (select count(*)::int from corecheck.users u
                where u.status in ('active', 'locked')) as used
         from corecheck.organisations o
        where o.id = corecheck.current_org_id()`,
    )) as [{ limit: number; used: number }];
    return { ...usage, available: Math.max(0, usage.limit - usage.used) };
  }

  async create(
    auth: CustomerAuth,
    input: CreateBody,
  ): Promise<UserWithCredentials> {
    const actor = actorFrom(auth);
    const role = await this.loadRole(input.roleId);
    if (!canAssignRole(actor, role)) throw this.privilegedRoleRefusal(role);

    const scope: Scope = {
      siteIds: input.siteIds,
      teamIds: input.teamIds,
      disciplineIds: input.disciplineIds,
    };
    const assigningScope = SCOPE_KINDS.some(
      ({ field }) => scope[field].length > 0,
    );
    if (assigningScope && !auth.permissions.has('users.assign_scope')) {
      throw forbidden(
        'You do not have permission to assign sites, teams or disciplines.',
      );
    }
    if (!actor.orgWide && scope.siteIds.length === 0) {
      throw fieldError('siteIds', 'Choose at least one of your sites.');
    }
    if (!canAssignSites(actor, scope.siteIds)) throw outOfScope();
    await this.validateScope(scope, {
      siteIds: [],
      teamIds: [],
      disciplineIds: [],
    });

    await this.assertEmailFree(input.email);

    const temporary = await issueTemporaryPin(this.hasher, this.clock.now());
    let created: { id: string; username: string };
    try {
      created = await this.insertUser(input, role.id, temporary);
    } catch (error) {
      if (isSeatLimitError(error)) await this.recordSeatLimitReached(auth);
      throw error;
    }
    await this.replaceScope(created.id, scope);

    const name = `${input.firstName} ${input.lastName}`;
    await this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action: 'user.created',
      entityType: 'user',
      entityId: created.id,
      summary: `Created user ${name} (${created.username}) as ${role.name}`,
      after: {
        name,
        username: created.username,
        email: input.email ?? null,
        role: role.name,
        ...(await this.scopeSnapshot(scope)),
      },
    });

    return {
      user: await this.get(auth, created.id),
      credentials: this.credentials(created.username, temporary),
    };
  }

  async update(
    auth: CustomerAuth,
    id: string,
    input: UpdateBody,
  ): Promise<UserDetail> {
    const actor = actorFrom(auth);
    const row = await this.loadVisible(auth, id, true);
    const target = toTarget(row);
    const name = `${row.firstName} ${row.lastName} (${row.username})`;

    const details: Partial<
      Pick<UserEntity, 'firstName' | 'lastName' | 'email'>
    > = {};
    if (input.firstName !== undefined && input.firstName !== row.firstName)
      details.firstName = input.firstName;
    if (input.lastName !== undefined && input.lastName !== row.lastName)
      details.lastName = input.lastName;
    if (input.email !== undefined && input.email !== row.email)
      details.email = input.email;
    const roleChanging =
      input.roleId !== undefined && input.roleId !== row.roleId;
    const scopeChanging = SCOPE_KINDS.some(
      ({ field }) => input[field] !== undefined,
    );

    if (
      (Object.keys(details).length > 0 || roleChanging) &&
      !canAdminister(actor, target, 'users.manage')
    ) {
      throw this.administerRefusal(actor, target);
    }
    if (scopeChanging && !canAdminister(actor, target, 'users.assign_scope')) {
      throw this.administerRefusal(actor, target);
    }

    if (details.email) await this.assertEmailFree(details.email, id);
    if (Object.keys(details).length > 0) {
      await this.db.update(UserEntity, { id }, details);
      const before = Object.fromEntries(
        Object.keys(details).map((key) => [
          key,
          row[key as keyof typeof details],
        ]),
      );
      await this.record(
        auth,
        'user.updated',
        id,
        `Updated details of ${name}`,
        before,
        details,
      );
    }

    if (roleChanging) {
      const role = await this.loadRole(input.roleId!);
      if (!canAssignRole(actor, role)) throw this.privilegedRoleRefusal(role);
      if (row.standardKey === 'admin' && role.standardKey !== 'admin') {
        await this.assertAnotherActiveAdmin(id);
      }
      await this.db.update(UserEntity, { id }, { roleId: role.id });
      await this.record(
        auth,
        'user.role.changed',
        id,
        `Changed role of ${name} from ${row.roleName} to ${role.name}`,
        { role: row.roleName },
        { role: role.name },
      );
    }

    if (scopeChanging) {
      const current: Scope = {
        siteIds: row.siteIds,
        teamIds: row.teamIds,
        disciplineIds: row.disciplineIds,
      };
      const next: Scope = {
        siteIds: input.siteIds ?? current.siteIds,
        teamIds: input.teamIds ?? current.teamIds,
        disciplineIds: input.disciplineIds ?? current.disciplineIds,
      };
      if (!actor.orgWide && next.siteIds.length === 0) {
        throw fieldError('siteIds', 'Choose at least one of your sites.');
      }
      if (!canAssignSites(actor, next.siteIds)) throw outOfScope();
      await this.validateScope(next, current);
      await this.replaceScope(id, next);
      await this.record(
        auth,
        'user.scope.changed',
        id,
        `Changed access scope of ${name}`,
        await this.scopeSnapshot(current),
        await this.scopeSnapshot(next),
      );
    }

    return this.get(auth, id);
  }

  async deactivate(auth: CustomerAuth, id: string): Promise<UserDetail> {
    const row = await this.loadAdministrable(auth, id, 'users.manage');
    if (row.status === 'inactive')
      throw conflict(ERROR_CODES.CONFLICT, 'This user is already inactive.');
    if (row.standardKey === 'admin') await this.assertAnotherActiveAdmin(id);

    await this.db.update(UserEntity, { id }, { status: 'inactive' });
    await this.sessions.revokeAllForUser(this.db, id, 'deactivated');
    await this.record(
      auth,
      'user.deactivated',
      id,
      `Deactivated ${row.firstName} ${row.lastName} (${row.username})`,
      { status: row.status },
      { status: 'inactive' },
    );
    return this.get(auth, id);
  }

  async reactivate(auth: CustomerAuth, id: string): Promise<UserDetail> {
    const row = await this.loadAdministrable(auth, id, 'users.manage');
    if (row.status !== 'inactive')
      throw conflict(ERROR_CODES.CONFLICT, 'This user is already active.');
    try {
      await this.db.update(
        UserEntity,
        { id },
        { status: 'active', lockedAt: null, failedPinAttempts: 0 },
      );
    } catch (error) {
      if (isSeatLimitError(error)) await this.recordSeatLimitReached(auth);
      throw error;
    }
    await this.record(
      auth,
      'user.reactivated',
      id,
      `Reactivated ${row.firstName} ${row.lastName} (${row.username})`,
      { status: 'inactive' },
      { status: 'active' },
    );
    return this.get(auth, id);
  }

  /** New temporary PIN; also lifts a lockout (USR-004, USR-005). */
  async resetPin(auth: CustomerAuth, id: string): Promise<UserWithCredentials> {
    const row = await this.loadAdministrable(auth, id, 'users.reset_pin');
    const temporary = await issueTemporaryPin(this.hasher, this.clock.now());
    await this.db.update(
      UserEntity,
      { id },
      {
        ...temporaryPinColumns(temporary),
        ...(row.status === 'locked'
          ? { status: 'active' as const, lockedAt: null }
          : {}),
      },
    );
    await this.sessions.revokeAllForUser(this.db, id, 'pin_reset');
    await this.record(
      auth,
      'user.pin.reset',
      id,
      `Reset the PIN of ${row.firstName} ${row.lastName} (${row.username})`,
    );
    return {
      user: await this.get(auth, id),
      credentials: this.credentials(row.username, temporary),
    };
  }

  async unlock(auth: CustomerAuth, id: string): Promise<UserDetail> {
    const row = await this.loadAdministrable(auth, id, 'users.reset_pin');
    if (row.status !== 'locked')
      throw conflict(ERROR_CODES.CONFLICT, 'This account is not locked.');
    await this.db.update(
      UserEntity,
      { id },
      { status: 'active', lockedAt: null, failedPinAttempts: 0 },
    );
    await this.record(
      auth,
      'user.unlocked',
      id,
      `Unlocked ${row.firstName} ${row.lastName} (${row.username})`,
      { status: 'locked' },
      { status: 'active' },
    );
    return this.get(auth, id);
  }

  // ----------------------------------------------------------- internals

  private visibilityCondition(actor: Actor, params: SqlParams): string {
    if (actor.orgWide) return 'true';
    const self = params.add(actor.userId);
    if (actor.standardKey === 'supervisor') {
      return `(u.id = ${self} or exists (
                select 1 from corecheck.user_teams v
                 where v.user_id = u.id and v.team_id = any(${params.add(actor.teamIds)}::uuid[])))`;
    }
    return `(u.id = ${self} or exists (
              select 1 from corecheck.user_sites v
               where v.user_id = u.id and v.site_id = any(${params.add(actor.siteIds)}::uuid[])))`;
  }

  private async loadRow(id: string, lock = false): Promise<UserRow | null> {
    const [row] = (await this.db.query(
      `${USER_SELECT} where u.id = $1 ${lock ? 'for update of u' : ''}`,
      [id],
    )) as UserRow[];
    return row ?? null;
  }

  /** The user, if it exists in this organisation and the caller may see it. */
  private async loadVisible(
    auth: CustomerAuth,
    id: string,
    lock = false,
  ): Promise<UserRow> {
    const row = await this.loadRow(id, lock);
    if (!row || !canViewUser(actorFrom(auth), toTarget(row)))
      throw notFound('User');
    return row;
  }

  private async loadAdministrable(
    auth: CustomerAuth,
    id: string,
    permission: 'users.manage' | 'users.reset_pin',
  ): Promise<UserRow> {
    const row = await this.loadVisible(auth, id, true);
    const actor = actorFrom(auth);
    const target = toTarget(row);
    if (!canAdminister(actor, target, permission))
      throw this.administerRefusal(actor, target);
    return row;
  }

  private administerRefusal(actor: Actor, target: TargetUser) {
    if (target.id === actor.userId) {
      return forbidden(
        'You cannot change your own account here. Use your profile instead.',
        ERROR_CODES.SELF_ACTION,
      );
    }
    if (target.privileged) {
      return forbidden(
        'Only an Admin can change users with privileged roles.',
        ERROR_CODES.PRIVILEGED_ROLE,
      );
    }
    if (
      !actor.permissions.has('users.manage') &&
      !actor.permissions.has('users.reset_pin')
    ) {
      return forbidden();
    }
    return outOfScope('This user has access to sites outside yours.');
  }

  private privilegedRoleRefusal(role: RoleRef) {
    if (role.archived)
      return fieldError(
        'roleId',
        `${role.name} is archived and cannot be assigned.`,
      );
    return forbidden(
      `Only an Admin can assign the privileged role ${role.name}.`,
      ERROR_CODES.PRIVILEGED_ROLE,
    );
  }

  private async loadRole(roleId: string): Promise<RoleRef> {
    const [role] = (await this.db.query(
      `select r.id, r.name, r.standard_key as "standardKey", r.archived_at as "archivedAt",
              array(select rp.permission from corecheck.role_permissions rp
                     where rp.role_id = r.id) as permissions
         from corecheck.roles r where r.id = $1`,
      [roleId],
    )) as Array<{
      id: string;
      name: string;
      standardKey: StandardRoleKey | null;
      archivedAt: Date | null;
      permissions: string[];
    }>;
    if (!role) throw fieldError('roleId', 'Choose a role.');
    return {
      id: role.id,
      name: role.name,
      standardKey: role.standardKey,
      archived: role.archivedAt !== null,
      privileged: isPrivilegedRole(role),
    };
  }

  /**
   * Every referenced site, team and discipline must exist in the organisation;
   * archived ones may be kept but not newly assigned (ORG-007).
   */
  private async validateScope(next: Scope, current: Scope): Promise<void> {
    const errors: FieldError[] = [];
    for (const { field, table, label } of SCOPE_KINDS) {
      const ids = next[field];
      if (ids.length === 0) continue;
      const rows = (await this.db.query(
        `select id, name, archived_at as "archivedAt" from corecheck.${table} where id = any($1::uuid[])`,
        [ids],
      )) as Array<{ id: string; name: string; archivedAt: Date | null }>;
      if (rows.length !== ids.length) {
        errors.push({
          field,
          message: `One or more selected ${label}s no longer exist.`,
        });
        continue;
      }
      const archived = rows.filter(
        (row) => row.archivedAt && !current[field].includes(row.id),
      );
      if (archived.length > 0) {
        errors.push({
          field,
          message: `${archived.map((row) => row.name).join(', ')} ${archived.length === 1 ? 'is' : 'are'} archived and cannot be assigned.`,
        });
      }
    }
    if (errors.length > 0) throw validationFailed(errors);
  }

  private async replaceScope(userId: string, scope: Scope): Promise<void> {
    const orgId = this.tenantDb.orgId;
    for (const { field, link, column } of SCOPE_KINDS) {
      await this.db.delete(link, { userId });
      if (scope[field].length > 0) {
        await this.db.insert(
          link,
          scope[field].map((refId) => ({ orgId, userId, [column]: refId })),
        );
      }
    }
  }

  /** Refuses an email another user in the organisation already has. */
  private async assertEmailFree(
    email: string | null | undefined,
    excludingUserId?: string,
  ): Promise<void> {
    if (!email) return;
    const taken = await this.db.query(
      `select 1 from corecheck.users
        where lower(email) = lower($1) and ($2::uuid is null or id <> $2)
        limit 1`,
      [email, excludingUserId ?? null],
    );
    if (taken.length > 0) {
      throw fieldError('email', 'Another user already has this email.');
    }
  }

  /**
   * Inserts the user under a generated username. Another request may claim
   * the same name between the check and the insert; then a new name is tried.
   */
  private async insertUser(
    input: CreateBody,
    roleId: string,
    temporary: Awaited<ReturnType<typeof issueTemporaryPin>>,
  ): Promise<{ id: string; username: string }> {
    for (let attempt = 1; ; attempt += 1) {
      const username = await generateUsername(
        this.db,
        input.firstName,
        input.lastName,
      );
      await this.db.query('savepoint insert_user');
      try {
        const result = await this.db.insert(UserEntity, {
          orgId: this.tenantDb.orgId,
          firstName: input.firstName,
          lastName: input.lastName,
          username,
          email: input.email ?? null,
          roleId,
          status: 'active',
          ...temporaryPinColumns(temporary),
        });
        await this.db.query('release savepoint insert_user');
        return { id: (result.identifiers[0] as { id: string }).id, username };
      } catch (error) {
        await this.db.query('rollback to savepoint insert_user');
        if (attempt < 3 && isUniqueViolation(error, 'users_username_key'))
          continue;
        throw error;
      }
    }
  }

  /** Refuses to leave the organisation without an active Admin. */
  private async assertAnotherActiveAdmin(
    excludingUserId: string,
  ): Promise<void> {
    const [{ count }] = (await this.db.query(
      `select count(*)::int as count
         from corecheck.users u join corecheck.roles r on r.id = u.role_id
        where r.standard_key = 'admin' and u.status = 'active' and u.id <> $1`,
      [excludingUserId],
    )) as [{ count: number }];
    if (count === 0) {
      throw conflict(
        ERROR_CODES.LAST_ADMIN,
        'Your organisation must keep at least one active Admin.',
      );
    }
  }

  /**
   * The refused change rolls back with its transaction, so the event is
   * written separately (IAD-005: the limit being reached is worth knowing).
   */
  private async recordSeatLimitReached(auth: CustomerAuth): Promise<void> {
    await this.systemDb.transaction((manager) =>
      this.audit.record(manager, {
        scope: 'tenant',
        orgId: auth.orgId,
        actor: userActor(auth),
        action: 'seat_limit.reached',
        entityType: 'organisation',
        entityId: auth.orgId,
        summary:
          'A user could not be activated because all licensed seats are in use',
      }),
    );
  }

  private record(
    auth: CustomerAuth,
    action:
      | 'user.updated'
      | 'user.role.changed'
      | 'user.scope.changed'
      | 'user.deactivated'
      | 'user.reactivated'
      | 'user.pin.reset'
      | 'user.unlocked',
    userId: string,
    summary: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'user',
      entityId: userId,
      summary,
      before,
      after,
    });
  }

  private credentials(
    username: string,
    temporary: { pin: string; expiresAt: Date },
  ): IssuedCredentials {
    return {
      username,
      temporaryPin: temporary.pin,
      expiresAt: temporary.expiresAt.toISOString(),
    };
  }

  private async scopeSnapshot(scope: Scope): Promise<Record<string, string[]>> {
    const snapshot: Record<string, string[]> = {};
    for (const { field, table } of SCOPE_KINDS) {
      const names = await this.namesOf(table, scope[field]);
      snapshot[table] = scope[field].map((id) => names.get(id) ?? id).sort();
    }
    return snapshot;
  }

  private async namesOf(
    table: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `select id, name from corecheck.${table} where id = any($1::uuid[])`,
      [ids],
    )) as IdName[];
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async scopeNames(
    rows: UserRow[],
  ): Promise<Record<ScopeField, Map<string, string>>> {
    const result = {} as Record<ScopeField, Map<string, string>>;
    for (const { field, table } of SCOPE_KINDS) {
      result[field] = await this.namesOf(table, [
        ...new Set(rows.flatMap((row) => row[field])),
      ]);
    }
    return result;
  }

  private toSummary(
    row: UserRow,
    names: Record<ScopeField, Map<string, string>>,
  ): UserSummary {
    const refs = (field: ScopeField): IdName[] =>
      row[field]
        .map((id) => ({ id, name: names[field].get(id) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      username: row.username,
      email: row.email,
      status: row.status,
      role: {
        id: row.roleId,
        name: row.roleName,
        standardKey: row.standardKey,
      },
      sites: refs('siteIds'),
      teams: refs('teamIds'),
      disciplines: refs('disciplineIds'),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async toDetail(row: UserRow, actor: Actor): Promise<UserDetail> {
    return {
      ...this.toSummary(row, await this.scopeNames([row])),
      mustChangePin: row.mustChangePin,
      failedPinAttempts: row.failedPinAttempts,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      capabilities: capabilitiesFor(actor, toTarget(row)),
    };
  }
}
