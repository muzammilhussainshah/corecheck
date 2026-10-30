import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Put,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  listStructureQuerySchema,
  type PlantSettings,
  plantSettingsSchema,
  type PlantType,
  setRequiredDocumentsSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth } from '../auth/decorators.js';
import { notFound } from '../common/errors.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import {
  type ConfigKindKey,
  isConfigKind,
  PlantConfigService,
} from './plant-config.service.js';

/** The list named in the URL; anything else is simply not found. */
class KindPipe implements PipeTransform<string, ConfigKindKey> {
  transform(value: string): ConfigKindKey {
    if (!isConfigKind(value)) throw notFound('Page');
    return value;
  }
}
const Kind = () => Param('kind', new KindPipe());

type ListQuery = z.output<typeof listStructureQuerySchema>;

/**
 * /config/<list> for every plant configuration list. Who may read or change
 * each list depends on the list, so the service checks the permission rather
 * than a route decorator (still before any data is touched).
 */
@Controller('config')
export class PlantConfigController {
  constructor(private readonly config: PlantConfigService) {}

  @Put('plant-types/:id/required-documents')
  setRequiredDocuments(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant type') id: string,
    @ValidBody(setRequiredDocumentsSchema)
    body: z.output<typeof setRequiredDocumentsSchema>,
  ): Promise<PlantType> {
    return this.config.setRequiredDocuments(auth, id, body.documentTypeIds);
  }

  @Get('plant-settings')
  plantSettings(@CurrentAuth() auth: CustomerAuth): Promise<PlantSettings> {
    return this.config.plantSettings(auth);
  }

  @Put('plant-settings')
  savePlantSettings(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(plantSettingsSchema) body: PlantSettings,
  ): Promise<PlantSettings> {
    return this.config.savePlantSettings(auth, body);
  }

  @Get(':kind')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @Kind() kind: ConfigKindKey,
    @ValidQuery(listStructureQuerySchema) query: ListQuery,
  ): Promise<unknown[]> {
    return this.config.list(auth, kind, query.includeArchived);
  }

  @Post(':kind')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @Kind() kind: ConfigKindKey,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.config.create(auth, kind, body);
  }

  @Patch(':kind/:id')
  update(
    @CurrentAuth() auth: CustomerAuth,
    @Kind() kind: ConfigKindKey,
    @IdParam('Item') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.config.update(auth, kind, id, body);
  }

  @Post(':kind/:id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: CustomerAuth,
    @Kind() kind: ConfigKindKey,
    @IdParam('Item') id: string,
  ): Promise<unknown> {
    return this.config.setArchived(auth, kind, id, true);
  }

  @Post(':kind/:id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: CustomerAuth,
    @Kind() kind: ConfigKindKey,
    @IdParam('Item') id: string,
  ): Promise<unknown> {
    return this.config.setArchived(auth, kind, id, false);
  }
}
