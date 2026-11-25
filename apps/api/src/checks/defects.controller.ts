import {
  Controller,
  Get,
  HttpCode,
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
  assignDefectSchema,
  closeDefectSchema,
  type DefectDetail,
  type DefectSummary,
  listDefectsQuerySchema,
  MAX_DOCUMENT_BYTES,
  type Paginated,
  reasonSchema,
  recordDefectWorkSchema,
  startVerificationSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import type { UploadedFile as Upload } from '../plants/documents.service.js';
import { DefectsService } from './defects.service.js';
import { ListExportService } from './list-export.service.js';

/** Defect routes; the service checks scope and assignment. */
@Controller('defects')
export class DefectsController {
  constructor(
    private readonly defects: DefectsService,
    private readonly lists: ListExportService,
  ) {}

  /** The list as shown, with its filters, as CSV (LST-004). */
  @Get('export')
  @RequirePermissions('defects.view', 'reports.export')
  async exportList(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listDefectsQuerySchema) query: z.output<typeof listDefectsQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const output = await this.lists.defectsCsv(auth, query);
    res.setHeader('X-Filename', encodeURIComponent(output.filename));
    return new StreamableFile(output.body, {
      type: output.contentType,
      length: output.body.length,
    });
  }

  @Get()
  @RequirePermissions('defects.view')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listDefectsQuerySchema) query: z.output<typeof listDefectsQuerySchema>,
  ): Promise<Paginated<DefectSummary>> {
    return this.defects.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions('defects.view')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
  ): Promise<DefectDetail> {
    return this.defects.get(auth, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('defects.assign')
  assign(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @ValidBody(assignDefectSchema) body: z.output<typeof assignDefectSchema>,
  ): Promise<DefectDetail> {
    return this.defects.assign(auth, id, body);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('defects.start')
  start(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
  ): Promise<DefectDetail> {
    return this.defects.start(auth, id);
  }

  @Post(':id/work')
  @HttpCode(200)
  @RequirePermissions('defects.record_work')
  recordWork(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @ValidBody(recordDefectWorkSchema) body: z.output<typeof recordDefectWorkSchema>,
  ): Promise<DefectDetail> {
    return this.defects.recordWork(auth, id, body);
  }

  @Post(':id/evidence')
  @RequirePermissions('defects.record_work')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } }),
  )
  addEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @UploadedFile() upload: Upload,
  ): Promise<DefectDetail> {
    return this.defects.addEvidence(auth, id, upload);
  }

  @Post(':id/evidence/:evidenceId/remove')
  @HttpCode(200)
  @RequirePermissions('defects.record_work')
  removeEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @IdParam('File', 'evidenceId') evidenceId: string,
  ): Promise<DefectDetail> {
    return this.defects.removeEvidence(auth, id, evidenceId);
  }

  @Get(':id/evidence/:evidenceId/file')
  @RequirePermissions('defects.view')
  async evidenceFile(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @IdParam('File', 'evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const output = await this.defects.evidenceFile(auth, id, evidenceId);
    res.setHeader('X-Filename', encodeURIComponent(output.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(output.body, {
      type: output.contentType,
      length: output.body.length,
    });
  }

  @Post(':id/verification')
  @HttpCode(200)
  @RequirePermissions('defects.verify')
  startVerification(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @ValidBody(startVerificationSchema) body: z.output<typeof startVerificationSchema>,
  ): Promise<DefectDetail> {
    return this.defects.startVerification(auth, id, body.templateId);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('defects.close')
  close(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @ValidBody(closeDefectSchema) body: z.output<typeof closeDefectSchema>,
  ): Promise<DefectDetail> {
    return this.defects.close(auth, id, body.note);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('defects.reopen')
  reopen(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Defect') id: string,
    @ValidBody(reasonSchema) body: z.output<typeof reasonSchema>,
  ): Promise<DefectDetail> {
    return this.defects.reopen(auth, id, body.reason);
  }
}
