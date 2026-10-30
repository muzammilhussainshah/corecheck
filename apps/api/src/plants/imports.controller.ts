import {
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  PLANT_IMPORT_MAX_BYTES,
  type PlantImportDetail,
  type PlantImportSummary,
  updateImportRowSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody } from '../common/validation.js';
import { ImportsService } from './imports.service.js';
import type { FileOutput } from './plant-output.service.js';

const send = (file: FileOutput, res: Response): StreamableFile => {
  res.setHeader('X-Filename', encodeURIComponent(file.filename));
  return new StreamableFile(file.body, {
    type: file.contentType,
    length: file.body.length,
  });
};

@Controller('plant-imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('template')
  @RequirePermissions('plant.import')
  async template(
    @CurrentAuth() auth: CustomerAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(await this.imports.template(auth), res);
  }

  @Get()
  @RequirePermissions('plant.import')
  list(@CurrentAuth() auth: CustomerAuth): Promise<PlantImportSummary[]> {
    return this.imports.list(auth);
  }

  @Post()
  @RequirePermissions('plant.import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PLANT_IMPORT_MAX_BYTES + 1, files: 1 },
    }),
  )
  upload(
    @CurrentAuth() auth: CustomerAuth,
    @UploadedFile()
    file: { buffer: Buffer; size: number; originalname?: string } | undefined,
  ): Promise<PlantImportDetail> {
    return this.imports.upload(auth, file);
  }

  @Get(':id')
  @RequirePermissions('plant.import')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
  ): Promise<PlantImportDetail> {
    return this.imports.get(auth, id);
  }

  @Patch(':id/rows/:rowId')
  @RequirePermissions('plant.import')
  updateRow(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
    @IdParam('Row', 'rowId') rowId: string,
    @ValidBody(updateImportRowSchema)
    body: z.output<typeof updateImportRowSchema>,
  ): Promise<PlantImportDetail> {
    return this.imports.updateRow(auth, id, rowId, body);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @RequirePermissions('plant.import', 'plant.create')
  commit(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
  ): Promise<PlantImportDetail> {
    return this.imports.commit(auth, id);
  }

  @Get(':id/report')
  @RequirePermissions('plant.import')
  async report(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(await this.imports.report(auth, id), res);
  }
}
