import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  type Area,
  createAreaSchema,
  createDisciplineSchema,
  createSiteSchema,
  createTeamSchema,
  type Discipline,
  listStructureQuerySchema,
  type Site,
  type Team,
  updateAreaSchema,
  updateDisciplineSchema,
  updateSiteSchema,
  updateTeamSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { OrgStructureService } from './org-structure.service.js';

type ListQuery = z.output<typeof listStructureQuerySchema>;
const ListQuery = () => ValidQuery(listStructureQuerySchema);

const VIEW = 'org_structure.view';
const MANAGE = 'org_structure.manage';

@Controller()
export class OrgStructureController {
  constructor(private readonly structure: OrgStructureService) {}

  // ------------------------------------------------------------------ sites

  @Get('sites')
  @RequirePermissions(VIEW)
  listSites(
    @CurrentAuth() auth: CustomerAuth,
    @ListQuery() query: ListQuery,
  ): Promise<Site[]> {
    return this.structure.listSites(auth, query.includeArchived);
  }

  @Post('sites')
  @RequirePermissions(MANAGE)
  createSite(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createSiteSchema) body: z.output<typeof createSiteSchema>,
  ): Promise<Site> {
    return this.structure.createSite(auth, body);
  }

  @Patch('sites/:id')
  @RequirePermissions(MANAGE)
  updateSite(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Site') id: string,
    @ValidBody(updateSiteSchema) body: z.output<typeof updateSiteSchema>,
  ): Promise<Site> {
    return this.structure.updateSite(auth, id, body);
  }

  @Post('sites/:id/archive')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  archiveSite(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Site') id: string,
  ): Promise<Site> {
    return this.structure.setSiteArchived(auth, id, true);
  }

  @Post('sites/:id/restore')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  restoreSite(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Site') id: string,
  ): Promise<Site> {
    return this.structure.setSiteArchived(auth, id, false);
  }

  // ------------------------------------------------------------------ areas

  @Get('sites/:id/areas')
  @RequirePermissions(VIEW)
  listAreas(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Site') siteId: string,
    @ListQuery() query: ListQuery,
  ): Promise<Area[]> {
    return this.structure.listAreas(auth, siteId, query.includeArchived);
  }

  @Post('sites/:id/areas')
  @RequirePermissions(MANAGE)
  createArea(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Site') siteId: string,
    @ValidBody(createAreaSchema) body: z.output<typeof createAreaSchema>,
  ): Promise<Area> {
    return this.structure.createArea(auth, siteId, body);
  }

  @Patch('areas/:id')
  @RequirePermissions(MANAGE)
  updateArea(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Area') id: string,
    @ValidBody(updateAreaSchema) body: z.output<typeof updateAreaSchema>,
  ): Promise<Area> {
    return this.structure.updateArea(auth, id, body);
  }

  @Post('areas/:id/archive')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  archiveArea(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Area') id: string,
  ): Promise<Area> {
    return this.structure.setAreaArchived(auth, id, true);
  }

  @Post('areas/:id/restore')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  restoreArea(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Area') id: string,
  ): Promise<Area> {
    return this.structure.setAreaArchived(auth, id, false);
  }

  // ------------------------------------------------------------------ teams

  @Get('teams')
  @RequirePermissions(VIEW)
  listTeams(@ListQuery() query: ListQuery): Promise<Team[]> {
    return this.structure.listTeams(query.includeArchived);
  }

  @Post('teams')
  @RequirePermissions(MANAGE)
  createTeam(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createTeamSchema) body: z.output<typeof createTeamSchema>,
  ): Promise<Team> {
    return this.structure.createTeam(auth, body);
  }

  @Patch('teams/:id')
  @RequirePermissions(MANAGE)
  updateTeam(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Team') id: string,
    @ValidBody(updateTeamSchema) body: z.output<typeof updateTeamSchema>,
  ): Promise<Team> {
    return this.structure.updateTeam(auth, id, body);
  }

  @Post('teams/:id/archive')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  archiveTeam(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Team') id: string,
  ): Promise<Team> {
    return this.structure.setTeamArchived(auth, id, true);
  }

  @Post('teams/:id/restore')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  restoreTeam(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Team') id: string,
  ): Promise<Team> {
    return this.structure.setTeamArchived(auth, id, false);
  }

  // ------------------------------------------------------------ disciplines

  @Get('disciplines')
  @RequirePermissions(VIEW)
  listDisciplines(@ListQuery() query: ListQuery): Promise<Discipline[]> {
    return this.structure.listDisciplines(query.includeArchived);
  }

  @Post('disciplines')
  @RequirePermissions(MANAGE)
  createDiscipline(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createDisciplineSchema)
    body: z.output<typeof createDisciplineSchema>,
  ): Promise<Discipline> {
    return this.structure.createDiscipline(auth, body);
  }

  @Patch('disciplines/:id')
  @RequirePermissions(MANAGE)
  updateDiscipline(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Discipline') id: string,
    @ValidBody(updateDisciplineSchema)
    body: z.output<typeof updateDisciplineSchema>,
  ): Promise<Discipline> {
    return this.structure.updateDiscipline(auth, id, body);
  }

  @Post('disciplines/:id/archive')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  archiveDiscipline(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Discipline') id: string,
  ): Promise<Discipline> {
    return this.structure.setDisciplineArchived(auth, id, true);
  }

  @Post('disciplines/:id/restore')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  restoreDiscipline(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Discipline') id: string,
  ): Promise<Discipline> {
    return this.structure.setDisciplineArchived(auth, id, false);
  }
}
