import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { PermissionCode } from '@corecheck/shared';
import { fullName } from '../auth/auth-context.js';
import { UserEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

export interface Assignment {
  userId: string | null;
  teamId: string | null;
  disciplineId: string | null;
}

/**
 * Who in the organisation can do or should hear about work at a site: active
 * users whose role holds a permission and whose scope covers the site.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly tenantDb: TenantDb) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  /** Active users holding `permission` whose scope includes the site. */
  async withPermission(
    permission: PermissionCode,
    siteId: string,
  ): Promise<string[]> {
    const rows = (await this.db.query(
      `select u.id
         from corecheck.users u
         join corecheck.roles r on r.id = u.role_id
         join corecheck.role_permissions rp on rp.role_id = r.id and rp.permission = $1
        where u.status = 'active'
          and (r.org_wide_scope
               or exists (select 1 from corecheck.user_sites us
                           where us.user_id = u.id and us.site_id = $2))`,
      [permission, siteId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** The people an assignment reaches: the user, team and discipline members. */
  async reached(assignment: Assignment, siteId: string): Promise<string[]> {
    const rows = (await this.db.query(
      `select distinct u.id
         from corecheck.users u
         join corecheck.roles r on r.id = u.role_id
        where u.status = 'active'
          and (u.id = $1
               or exists (select 1 from corecheck.user_teams ut
                           where ut.user_id = u.id and ut.team_id = $2)
               or exists (select 1 from corecheck.user_disciplines ud
                           where ud.user_id = u.id and ud.discipline_id = $3))
          and (r.org_wide_scope
               or exists (select 1 from corecheck.user_sites us
                           where us.user_id = u.id and us.site_id = $4))`,
      [assignment.userId, assignment.teamId, assignment.disciplineId, siteId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Display names by user id; unknown ids read "Unknown". */
  async names(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const users = await this.db.findBy(UserEntity, { id: In(wanted) });
    return new Map(users.map((user) => [user.id, fullName(user)]));
  }
}
