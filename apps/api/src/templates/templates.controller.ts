import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  type CheckTemplateDetail,
  type CheckTemplateSummary,
  createTemplateSchema,
  listTemplatesQuerySchema,
  saveTemplateDraftSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { TemplatesService } from './templates.service.js';

/** Template routes; the service checks the template permissions. */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listTemplatesQuerySchema)
    query: z.output<typeof listTemplatesQuerySchema>,
  ): Promise<CheckTemplateSummary[]> {
    return this.templates.list(auth, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createTemplateSchema)
    body: z.output<typeof createTemplateSchema>,
  ): Promise<CheckTemplateDetail> {
    return this.templates.create(auth, body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Template') id: string,
  ): Promise<CheckTemplateDetail> {
    return this.templates.get(auth, id);
  }

  @Put(':id/draft')
  saveDraft(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Template') id: string,
    @ValidBody(saveTemplateDraftSchema)
    body: z.output<typeof saveTemplateDraftSchema>,
  ): Promise<CheckTemplateDetail> {
    return this.templates.saveDraft(auth, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Template') id: string,
  ): Promise<CheckTemplateDetail> {
    return this.templates.publish(auth, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Template') id: string,
  ): Promise<CheckTemplateDetail> {
    return this.templates.setArchived(auth, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Template') id: string,
  ): Promise<CheckTemplateDetail> {
    return this.templates.setArchived(auth, id, false);
  }
}
