import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  type AuditEvent,
  createPlantSchema,
  exportPlantsQuerySchema,
  listAuditQuerySchema,
  listPlantsQuerySchema,
  type Paginated,
  type PlantDetail,
  type PlantDuplicates,
  plantDuplicatesQuerySchema,
  plantQrLabelsQuerySchema,
  type PlantSaved,
  type PlantSummary,
  restrictPlantSchema,
  returnToServiceSchema,
  updatePlantSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { notFound } from '../common/errors.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { type FileOutput, PlantOutputService } from './plant-output.service.js';
import { PlantsService } from './plants.service.js';

/** QR tokens are 22 url-safe characters; anything else names no plant. */
class QrTokenPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw notFound('Plant');
    return value;
  }
}

/**
 * A generated file for the web app, which fetches it and saves it under the
 * name in X-Filename. No Content-Disposition on purpose: Chrome takes a
 * binary "attachment" response away from fetch() as a download of its own,
 * leaving the page an empty 204.
 */
const download = (file: FileOutput, res: Response): StreamableFile => {
  res.setHeader('X-Filename', encodeURIComponent(file.filename));
  return new StreamableFile(file.body, {
    type: file.contentType,
    length: file.body.length,
  });
};

@Controller('plants')
export class PlantsController {
  constructor(
    private readonly plants: PlantsService,
    private readonly output: PlantOutputService,
  ) {}

  @Get()
  @RequirePermissions('plant.view')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listPlantsQuerySchema)
    query: z.output<typeof listPlantsQuerySchema>,
  ): Promise<Paginated<PlantSummary>> {
    return this.plants.list(auth, query);
  }

  @Get('duplicates')
  @RequirePermissions('plant.view')
  duplicates(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(plantDuplicatesQuerySchema)
    query: z.output<typeof plantDuplicatesQuerySchema>,
  ): Promise<PlantDuplicates> {
    return this.plants.duplicates(auth, query);
  }

  @Get('export')
  @RequirePermissions('plant.view', 'plant.export')
  async export(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(exportPlantsQuerySchema)
    query: z.output<typeof exportPlantsQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return download(await this.output.export(auth, query), res);
  }

  @Get('qr-labels')
  @RequirePermissions('plant.view', 'plant.qr')
  async labels(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(plantQrLabelsQuerySchema)
    query: z.output<typeof plantQrLabelsQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return download(await this.output.labels(auth, query), res);
  }

  @Get('qr/:token')
  @RequirePermissions('plant.view')
  resolveQr(
    @CurrentAuth() auth: CustomerAuth,
    @Param('token', new QrTokenPipe()) token: string,
  ): Promise<{ id: string }> {
    return this.plants.resolveQr(auth, token);
  }

  @Post()
  @RequirePermissions('plant.create')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createPlantSchema) body: z.output<typeof createPlantSchema>,
  ): Promise<PlantSaved> {
    return this.plants.create(auth, body);
  }

  @Get(':id')
  @RequirePermissions('plant.view')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
  ): Promise<PlantDetail> {
    return this.plants.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('plant.view')
  update(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
    @ValidBody(updatePlantSchema) body: z.output<typeof updatePlantSchema>,
  ): Promise<PlantSaved> {
    return this.plants.update(auth, id, body);
  }

  @Get(':id/history')
  @RequirePermissions('plant.view')
  history(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
    @ValidQuery(listAuditQuerySchema)
    query: z.output<typeof listAuditQuerySchema>,
  ): Promise<Paginated<AuditEvent>> {
    return this.plants.history(auth, id, query);
  }

  @Post(':id/restrict')
  @HttpCode(200)
  @RequirePermissions('plant.view', 'plant_status.restrict')
  restrict(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
    @ValidBody(restrictPlantSchema) body: z.output<typeof restrictPlantSchema>,
  ): Promise<PlantDetail> {
    return this.plants.restrict(auth, id, body);
  }

  @Post(':id/return-to-service')
  @HttpCode(200)
  @RequirePermissions('plant.view', 'plant_status.return_to_service')
  returnToService(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
    @ValidBody(returnToServiceSchema)
    body: z.output<typeof returnToServiceSchema>,
  ): Promise<PlantDetail> {
    return this.plants.returnToService(auth, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('plant.view', 'plant.archive')
  archive(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
  ): Promise<PlantDetail> {
    return this.plants.setArchived(auth, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('plant.view', 'plant.archive')
  restore(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') id: string,
  ): Promise<PlantDetail> {
    return this.plants.setArchived(auth, id, false);
  }
}
