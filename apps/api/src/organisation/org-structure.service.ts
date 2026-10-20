import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import type {
  Area,
  AuditAction,
  createAreaSchema,
  createDisciplineSchema,
  createSiteSchema,
  createTeamSchema,
  Discipline,
  Site,
  Team,
  updateSiteSchema,
  updateTeamSchema,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { fieldError, notFound } from '../common/errors.js';
import {
  AreaEntity,
  DisciplineEntity,
  SiteEntity,
  TeamEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

type SiteInput = z.output<typeof createSiteSchema>;
type SiteUpdate = z.output<typeof updateSiteSchema>;
type AreaInput = z.output<typeof createAreaSchema>;
type TeamInput = z.output<typeof createTeamSchema>;
type TeamUpdate = z.output<typeof updateTeamSchema>;
type DisciplineInput = z.output<typeof createDisciplineSchema>;

const KINDS = {
  site: { entity: SiteEntity, label: 'Site' },
  area: { entity: AreaEntity, label: 'Area' },
  team: { entity: TeamEntity, label: 'Team' },
  discipline: { entity: DisciplineEntity, label: 'Discipline' },
} as const;

type Kind = keyof typeof KINDS;
type KindEntity = SiteEntity | AreaEntity | TeamEntity | DisciplineEntity;

/** Blank optional text is stored as null rather than an empty string. */
const blankToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value === '' ? null : value;

/**
 * Sites with their areas, teams and disciplines (FRD 15). Archiving keeps
 * history and assignments but blocks new assignment (ORG-007). Users whose
 * role is not organisation-wide see only the sites assigned to them; teams
 * and disciplines are organisation-wide reference lists.
 */
@Injectable()
export class OrgStructureService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  // ------------------------------------------------------------------ sites

  async listSites(
    auth: CustomerAuth,
    includeArchived: boolean,
  ): Promise<Site[]> {
    const conditions = [includeArchived ? 'true' : 's.archived_at is null'];
    const params: unknown[] = [];
    if (!auth.orgWideScope) {
      params.push(auth.siteIds);
      conditions.push(`s.id = any($${params.length}::uuid[])`);
    }
    const rows = (await this.db.query(
      `select s.id, s.name, s.code, s.address, s.archived_at as "archivedAt",
              (select count(*)::int from corecheck.site_areas a
                where a.site_id = s.id and a.archived_at is null) as "areaCount"
         from corecheck.sites s
        where ${conditions.join(' and ')}
        order by lower(s.name)`,
      params,
    )) as Array<Omit<Site, 'archivedAt'> & { archivedAt: Date | null }>;
    return rows.map((row) => ({
      ...row,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }

  async createSite(auth: CustomerAuth, input: SiteInput): Promise<Site> {
    const result = await this.db.insert(SiteEntity, {
      orgId: this.tenantDb.orgId,
      name: input.name,
      code: blankToNull(input.code) ?? null,
      address: blankToNull(input.address) ?? null,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.record(
      auth,
      'site.created',
      'site',
      id,
      `Created site ${input.name}`,
    );
    return this.getSite(auth, id);
  }

  async updateSite(
    auth: CustomerAuth,
    id: string,
    input: SiteUpdate,
  ): Promise<Site> {
    const site = await this.load('site', id);
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.code === undefined ? {} : { code: blankToNull(input.code) }),
      ...(input.address === undefined
        ? {}
        : { address: blankToNull(input.address) }),
    };
    await this.applyUpdate(auth, 'site', site, changes, 'site.updated');
    return this.getSite(auth, id);
  }

  async setSiteArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<Site> {
    await this.setArchived(auth, 'site', id, archived);
    return this.getSite(auth, id);
  }

  private async getSite(auth: CustomerAuth, id: string): Promise<Site> {
    const site = (await this.listSites(auth, true)).find(
      (candidate) => candidate.id === id,
    );
    if (!site) throw notFound('Site');
    return site;
  }

  // ------------------------------------------------------------------ areas

  async listAreas(
    auth: CustomerAuth,
    siteId: string,
    includeArchived: boolean,
  ): Promise<Area[]> {
    await this.getSite(auth, siteId);
    const areas = await this.db.find(AreaEntity, {
      where: { siteId },
      order: { name: 'ASC' },
    });
    return areas
      .filter((area) => includeArchived || area.archivedAt === null)
      .map((area) => this.toArea(area));
  }

  async createArea(
    auth: CustomerAuth,
    siteId: string,
    input: AreaInput,
  ): Promise<Area> {
    const site = await this.load('site', siteId);
    if (site.archivedAt)
      throw fieldError('name', 'Restore the site before adding areas to it.');
    const result = await this.db.insert(AreaEntity, {
      orgId: this.tenantDb.orgId,
      siteId,
      name: input.name,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.record(
      auth,
      'area.created',
      'area',
      id,
      `Created area ${input.name} at ${site.name}`,
    );
    return this.toArea(await this.load('area', id));
  }

  async updateArea(
    auth: CustomerAuth,
    id: string,
    input: AreaInput,
  ): Promise<Area> {
    const area = await this.load('area', id);
    await this.applyUpdate(
      auth,
      'area',
      area,
      { name: input.name },
      'area.updated',
    );
    return this.toArea(await this.load('area', id));
  }

  async setAreaArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<Area> {
    await this.setArchived(auth, 'area', id, archived);
    return this.toArea(await this.load('area', id));
  }

  // ------------------------------------------------------------------ teams

  async listTeams(includeArchived: boolean): Promise<Team[]> {
    const rows = (await this.db.query(
      `select t.id, t.name, t.description, t.archived_at as "archivedAt",
              (select count(*)::int from corecheck.user_teams ut
                 join corecheck.users u on u.id = ut.user_id
                where ut.team_id = t.id and u.status <> 'inactive') as "memberCount"
         from corecheck.teams t
        ${includeArchived ? '' : 'where t.archived_at is null'}
        order by lower(t.name)`,
    )) as Array<Omit<Team, 'archivedAt'> & { archivedAt: Date | null }>;
    return rows.map((row) => ({
      ...row,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }

  async createTeam(auth: CustomerAuth, input: TeamInput): Promise<Team> {
    const result = await this.db.insert(TeamEntity, {
      orgId: this.tenantDb.orgId,
      name: input.name,
      description: blankToNull(input.description) ?? null,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.record(
      auth,
      'team.created',
      'team',
      id,
      `Created team ${input.name}`,
    );
    return this.getTeam(id);
  }

  async updateTeam(
    auth: CustomerAuth,
    id: string,
    input: TeamUpdate,
  ): Promise<Team> {
    const team = await this.load('team', id);
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: blankToNull(input.description) }),
    };
    await this.applyUpdate(auth, 'team', team, changes, 'team.updated');
    return this.getTeam(id);
  }

  async setTeamArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<Team> {
    await this.setArchived(auth, 'team', id, archived);
    return this.getTeam(id);
  }

  private async getTeam(id: string): Promise<Team> {
    const team = (await this.listTeams(true)).find(
      (candidate) => candidate.id === id,
    );
    if (!team) throw notFound('Team');
    return team;
  }

  // ------------------------------------------------------------ disciplines

  async listDisciplines(includeArchived: boolean): Promise<Discipline[]> {
    const rows = (await this.db.query(
      `select d.id, d.name, d.archived_at as "archivedAt",
              (select count(*)::int from corecheck.user_disciplines ud
                 join corecheck.users u on u.id = ud.user_id
                where ud.discipline_id = d.id and u.status <> 'inactive') as "memberCount"
         from corecheck.disciplines d
        ${includeArchived ? '' : 'where d.archived_at is null'}
        order by lower(d.name)`,
    )) as Array<Omit<Discipline, 'archivedAt'> & { archivedAt: Date | null }>;
    return rows.map((row) => ({
      ...row,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }

  async createDiscipline(
    auth: CustomerAuth,
    input: DisciplineInput,
  ): Promise<Discipline> {
    const result = await this.db.insert(DisciplineEntity, {
      orgId: this.tenantDb.orgId,
      name: input.name,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.record(
      auth,
      'discipline.created',
      'discipline',
      id,
      `Created discipline ${input.name}`,
    );
    return this.getDiscipline(id);
  }

  async updateDiscipline(
    auth: CustomerAuth,
    id: string,
    input: DisciplineInput,
  ): Promise<Discipline> {
    const discipline = await this.load('discipline', id);
    await this.applyUpdate(
      auth,
      'discipline',
      discipline,
      { name: input.name },
      'discipline.updated',
    );
    return this.getDiscipline(id);
  }

  async setDisciplineArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<Discipline> {
    await this.setArchived(auth, 'discipline', id, archived);
    return this.getDiscipline(id);
  }

  private async getDiscipline(id: string): Promise<Discipline> {
    const discipline = (await this.listDisciplines(true)).find(
      (candidate) => candidate.id === id,
    );
    if (!discipline) throw notFound('Discipline');
    return discipline;
  }

  // ---------------------------------------------------------------- shared

  private async load<K extends Kind>(kind: K, id: string): Promise<KindEntity> {
    const { entity, label } = KINDS[kind];
    const row = await this.db.findOneBy(entity, { id });
    if (!row) throw notFound(label);
    return row;
  }

  private async applyUpdate(
    auth: CustomerAuth,
    kind: Kind,
    current: KindEntity,
    changes: Record<string, string | null | undefined>,
    action: AuditAction,
  ): Promise<void> {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const existing = (current as unknown as Record<string, unknown>)[key];
      if (value !== undefined && value !== existing) {
        before[key] = existing;
        after[key] = value;
      }
    }
    if (Object.keys(after).length === 0) return;
    await this.db.update(KINDS[kind].entity, { id: current.id }, after);
    await this.record(
      auth,
      action,
      kind,
      current.id,
      `Updated ${kind} ${String(after.name ?? current.name)}`,
      before,
      after,
    );
  }

  private async setArchived(
    auth: CustomerAuth,
    kind: Kind,
    id: string,
    archived: boolean,
  ): Promise<void> {
    const current = await this.load(kind, id);
    if ((current.archivedAt !== null) === archived) return;
    await this.db.update(
      KINDS[kind].entity,
      { id },
      { archivedAt: archived ? this.clock.now() : null },
    );
    await this.record(
      auth,
      `${kind}.${archived ? 'archived' : 'restored'}` as AuditAction,
      kind,
      id,
      `${archived ? 'Archived' : 'Restored'} ${kind} ${current.name}`,
    );
  }

  private record(
    auth: CustomerAuth,
    action: AuditAction,
    entityType: Kind,
    entityId: string,
    summary: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType,
      entityId,
      summary,
      before,
      after,
    });
  }

  private toArea(area: KindEntity): Area {
    const { id, siteId, name, archivedAt } = area as AreaEntity;
    return { id, siteId, name, archivedAt: archivedAt?.toISOString() ?? null };
  }
}
