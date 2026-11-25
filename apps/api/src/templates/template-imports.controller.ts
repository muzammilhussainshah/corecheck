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
import { z } from 'zod';
import type {
  TemplateImportDetail,
  TemplateImportSummary,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody } from '../common/validation.js';
import { TemplateImportsService } from './template-imports.service.js';

const send = (
  file: { body: Buffer; filename: string; contentType: string },
  res: Response,
): StreamableFile => {
  res.setHeader('X-Filename', encodeURIComponent(file.filename));
  return new StreamableFile(file.body, {
    type: file.contentType,
    length: file.body.length,
  });
};

const updateRowSchema = z.object({
  data: z.record(z.string().max(40), z.string().max(1000)),
});

/** Check template import (FRD 19.4); Admin-only in the standard roles. */
@Controller('template-imports')
export class TemplateImportsController {
  constructor(private readonly imports: TemplateImportsService) {}

  @Get('template')
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  async template(
    @CurrentAuth() auth: CustomerAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(await this.imports.template(auth), res);
  }

  @Get()
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  list(@CurrentAuth() auth: CustomerAuth): Promise<TemplateImportSummary[]> {
    return this.imports.list(auth);
  }

  @Post()
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1 } }),
  )
  upload(
    @CurrentAuth() auth: CustomerAuth,
    @UploadedFile()
    file: { buffer: Buffer; size: number; originalname?: string } | undefined,
  ): Promise<TemplateImportDetail> {
    return this.imports.upload(auth, file);
  }

  @Get(':id')
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
  ): Promise<TemplateImportDetail> {
    return this.imports.get(auth, id);
  }

  @Patch(':id/rows/:rowId')
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  updateRow(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
    @IdParam('Row', 'rowId') rowId: string,
    @ValidBody(updateRowSchema) body: z.output<typeof updateRowSchema>,
  ): Promise<TemplateImportDetail> {
    return this.imports.updateRow(auth, id, rowId, body.data);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  commit(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
  ): Promise<TemplateImportDetail> {
    return this.imports.commit(auth, id);
  }

  @Get(':id/report')
  @RequirePermissions('templates.manage', 'templates.configure_questions')
  async report(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Import') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(await this.imports.report(auth, id), res);
  }
}
