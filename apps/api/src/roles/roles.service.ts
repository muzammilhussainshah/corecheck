import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type createRoleSchema,
  type duplicateRoleSchema,
  ERROR_CODES,
  isPermissionCode,
  isPrivilegedRole,
  type PermissionCode,
  type RoleSummary,
  type StandardRoleKey,
  type updateRoleSchema,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { conflict, forbidden, notFound } from '../common/errors.js';
import { RoleEntity, RolePermissionEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { actorFrom, canAssignRole } from '../users/access-policy.js';

type CreateBody = z.output<typeof createRoleSchema>;
type UpdateBody = z.output<typeof updateRoleSchema>;
type DuplicateBody = z.output<typeof duplicateRoleSchema>;

interface RoleRow {
  id: string;
  name: string;
  description: string;
  standardKey: StandardRoleKey | null;
  orgWideScope: boolean;
  archivedAt: Date | null;
  permissions: string[];
  activeUserCount: number;
}

const ROLE_SELECT = /* sql */ `
  select r.id, r.name, r.description, r.standard_key as "standardKey",
         r.org_wide_scope as "orgWideScope", r.archived_at as "archivedAt",
         array(select rp.permission from corecheck.role_permissions rp
                where rp.role_id = r.id order by 1) as permissions,
         (select count(*)::int from corecheck.users u
           where u.role_id = r.id and u.status in ('active', 'locked')) as "activeUserCount"
    from corecheck.roles r`;

/**
 * Standard and custom roles (FRD 4.2). Standard roles are fixed; Admins build
 * custom roles from the same permission catalogue (ROL-001), such as a
 * read-only Viewer (ROL-002, ROL-AC-04). Changes apply to every holder on
 * their next request, and are audited with the permissions added and removed
 * (ROL-006).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  /** Managers need the list to assign roles, even without roles.view. */
  async list(
    auth: CustomerAuth,
    includeArchived: boolean,
  ): Promise<RoleSummary[]> {
    this.assertCanRead(auth);
    const rows = (await this.db.query(
      `${ROLE_SELECT} ${includeArchived ? '' : 'where r.archived_at is null'}
        order by r.standard_key is null, array_position(
          array['operative','technician','supervisor','manager','admin'], r.standard_key),
          lower(r.name)`,
    )) as RoleRow[];
    return rows.map((row) => this.toSummary(row, auth));
  }

  async get(auth: CustomerAuth, id: string): Promise<RoleSummary> {
    this.assertCanRead(auth);
    return this.toSummary(await this.load(id), auth);
  }

  async create(auth: CustomerAuth, input: CreateBody): Promise<RoleSummary> {
    const result = await this.db.insert(RoleEntity, {
      orgId: this.tenantDb.orgId,
      standardKey: null,
      name: input.name,
      description: input.description,
      orgWideScope: input.orgWideScope,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.setPermissions(id, input.permissions);
    await this.record(
      auth,
      'role.created',
      id,
      `Created role ${input.name}`,
      undefined,
      {
        name: input.name,
        orgWideScope: input.orgWideScope,
        permissions: [...input.permissions].sort(),
      },
    );
    return this.get(auth, id);
  }

  async duplicate(
    auth: CustomerAuth,
    sourceId: string,
    input: DuplicateBody,
  ): Promise<RoleSummary> {
    const source = await this.load(sourceId);
    return this.create(auth, {
      name: input.name,
      description: source.description,
      orgWideScope: source.orgWideScope,
      permissions: source.permissions.filter(isPermissionCode),
    });
  }

  async update(
    auth: CustomerAuth,
    id: string,
    input: UpdateBody,
  ): Promise<RoleSummary> {
    const role = await this.loadCustom(id);
    if (role.archivedAt) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Restore this role before editing it.',
      );
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const fields: Partial<
      Pick<RoleEntity, 'name' | 'description' | 'orgWideScope'>
    > = {};
    for (const key of ['name', 'description', 'orgWideScope'] as const) {
      if (input[key] !== undefined && input[key] !== role[key]) {
        before[key] = role[key];
        after[key] = input[key];
        Object.assign(fields, { [key]: input[key] });
      }
    }
    if (Object.keys(fields).length > 0)
      await this.db.update(RoleEntity, { id }, fields);

    if (input.permissions) {
      const added = input.permissions
        .filter((p) => !role.permissions.includes(p))
        .sort();
      const removed = role.permissions
        .filter((p) => !input.permissions!.includes(p as PermissionCode))
        .sort();
      if (added.length > 0 || removed.length > 0) {
        await this.setPermissions(id, input.permissions);
        before.permissionsRemoved = removed;
        after.permissionsAdded = added;
      }
    }

    if (Object.keys(after).length > 0 || Object.keys(before).length > 0) {
      await this.record(
        auth,
        'role.updated',
        id,
        `Updated role ${input.name ?? role.name}`,
        before,
        after,
      );
    }
    return this.get(auth, id);
  }

  async archive(auth: CustomerAuth, id: string): Promise<RoleSummary> {
    const role = await this.loadCustom(id);
    if (role.archivedAt) return this.toSummary(role, auth);
    if (role.activeUserCount > 0) {
      throw conflict(
        ERROR_CODES.ROLE_IN_USE,
        `${role.activeUserCount} active user${role.activeUserCount === 1 ? ' has' : 's have'} this role. Give them another role first.`,
      );
    }
    await this.db.update(RoleEntity, { id }, { archivedAt: this.clock.now() });
    await this.record(auth, 'role.archived', id, `Archived role ${role.name}`);
    return this.get(auth, id);
  }

  async restore(auth: CustomerAuth, id: string): Promise<RoleSummary> {
    const role = await this.loadCustom(id);
    if (!role.archivedAt) return this.toSummary(role, auth);
    await this.db.update(RoleEntity, { id }, { archivedAt: null });
    await this.record(auth, 'role.restored', id, `Restored role ${role.name}`);
    return this.get(auth, id);
  }

  private assertCanRead(auth: CustomerAuth): void {
    if (
      !auth.permissions.has('roles.view') &&
      !auth.permissions.has('users.manage')
    ) {
      throw forbidden();
    }
  }

  private async load(id: string): Promise<RoleRow> {
    const [row] = (await this.db.query(`${ROLE_SELECT} where r.id = $1`, [
      id,
    ])) as RoleRow[];
    if (!row) throw notFound('Role');
    return row;
  }

  private async loadCustom(id: string): Promise<RoleRow> {
    const role = await this.load(id);
    if (role.standardKey) {
      throw forbidden(
        'Standard roles cannot be changed. Duplicate it to create a custom role instead.',
        ERROR_CODES.STANDARD_ROLE_LOCKED,
      );
    }
    return role;
  }

  private async setPermissions(
    roleId: string,
    permissions: readonly PermissionCode[],
  ): Promise<void> {
    await this.db.delete(RolePermissionEntity, { roleId });
    if (permissions.length > 0) {
      await this.db.insert(
        RolePermissionEntity,
        permissions.map((permission) => ({
          orgId: this.tenantDb.orgId,
          roleId,
          permission,
        })),
      );
    }
  }

  private record(
    auth: CustomerAuth,
    action: 'role.created' | 'role.updated' | 'role.archived' | 'role.restored',
    roleId: string,
    summary: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'role',
      entityId: roleId,
      summary,
      before,
      after,
    });
  }

  private toSummary(row: RoleRow, auth: CustomerAuth): RoleSummary {
    const privileged = isPrivilegedRole({
      standardKey: row.standardKey,
      permissions: row.permissions,
    });
    const archived = row.archivedAt !== null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      standardKey: row.standardKey,
      isStandard: row.standardKey !== null,
      orgWideScope: row.orgWideScope,
      privileged,
      permissions: row.permissions.filter(isPermissionCode),
      activeUserCount: row.activeUserCount,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      assignable:
        auth.permissions.has('users.manage') &&
        canAssignRole(actorFrom(auth), { privileged, archived }),
    };
  }
}
