import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  assignCheckSchema,
  type CheckDetail,
  type CheckSummary,
  createCheckSchema,
  listChecksQuerySchema,
  MAX_DOCUMENT_BYTES,
  type Paginated,
  reasonSchema,
  rescheduleCheckSchema,
  reviewCheckSchema,
  saveCheckAnswersSchema,
  type DashboardSummary,
  type WorkSummary,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import type { UploadedFile as Upload } from '../plants/documents.service.js';
import { CheckExportService } from './check-export.service.js';
import { ChecksService } from './checks.service.js';
import { DashboardService } from './dashboard.service.js';
import { ListExportService } from './list-export.service.js';

const file = (
  res: Response,
  output: { body: Buffer; fileName?: string; filename?: string; contentType: string },
): StreamableFile => {
  res.setHeader(
    'X-Filename',
    encodeURIComponent(output.fileName ?? output.filename ?? 'file'),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(output.body, {
    type: output.contentType,
    length: output.body.length,
  });
};

/** Check routes; the service checks scope, assignment and status. */
@Controller()
export class ChecksController {
  constructor(
    private readonly checks: ChecksService,
    private readonly exporter: CheckExportService,
    private readonly dashboard: DashboardService,
    private readonly lists: ListExportService,
  ) {}

  @Get('dashboard')
  dashboardSummary(@CurrentAuth() auth: CustomerAuth): Promise<DashboardSummary> {
    return this.dashboard.summary(auth);
  }

  @Get('work/summary')
  summary(@CurrentAuth() auth: CustomerAuth): Promise<WorkSummary> {
    return this.checks.summary(auth);
  }

  @Get('checks')
  @RequirePermissions('checks.view')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listChecksQuerySchema) query: z.output<typeof listChecksQuerySchema>,
  ): Promise<Paginated<CheckSummary>> {
    return this.checks.list(auth, query);
  }

  /** The list as shown, with its filters, as CSV (LST-004). */
  @Get('checks/export')
  @RequirePermissions('checks.view', 'reports.export')
  async exportList(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listChecksQuerySchema) query: z.output<typeof listChecksQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return file(res, await this.lists.checksCsv(auth, query));
  }

  @Post('checks')
  @RequirePermissions('schedules.assign')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createCheckSchema) body: z.output<typeof createCheckSchema>,
  ): Promise<CheckDetail> {
    return this.checks.create(auth, body);
  }

  @Get('checks/:id')
  @RequirePermissions('checks.view')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
  ): Promise<CheckDetail> {
    return this.checks.get(auth, id);
  }

  @Put('checks/:id/answers')
  saveAnswers(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(saveCheckAnswersSchema) body: z.output<typeof saveCheckAnswersSchema>,
  ): Promise<CheckDetail> {
    return this.checks.saveAnswers(auth, id, body);
  }

  @Post('checks/:id/questions/:questionId/evidence')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } }),
  )
  addEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @Param('questionId') questionId: string,
    @UploadedFile() upload: Upload,
  ): Promise<CheckDetail> {
    return this.checks.addEvidence(auth, id, questionId, upload);
  }

  @Post('checks/:id/evidence/:evidenceId/remove')
  @HttpCode(200)
  removeEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @IdParam('File', 'evidenceId') evidenceId: string,
  ): Promise<CheckDetail> {
    return this.checks.removeEvidence(auth, id, evidenceId);
  }

  @Get('checks/:id/evidence/:evidenceId/file')
  @RequirePermissions('checks.view')
  async evidenceFile(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @IdParam('File', 'evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return file(res, await this.checks.evidenceFile(auth, id, evidenceId));
  }

  @Post('checks/:id/submit')
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
  ): Promise<CheckDetail> {
    return this.checks.submit(auth, id);
  }

  @Post('checks/:id/review')
  @HttpCode(200)
  review(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(reviewCheckSchema) body: z.output<typeof reviewCheckSchema>,
  ): Promise<CheckDetail> {
    return this.checks.review(auth, id, body);
  }

  @Post('checks/:id/reopen')
  @HttpCode(200)
  @RequirePermissions('checks.reopen')
  reopen(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(reasonSchema) body: z.output<typeof reasonSchema>,
  ): Promise<CheckDetail> {
    return this.checks.reopen(auth, id, body.reason);
  }

  @Post('checks/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('checks.cancel')
  cancel(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(reasonSchema) body: z.output<typeof reasonSchema>,
  ): Promise<CheckDetail> {
    return this.checks.cancel(auth, id, body.reason);
  }

  @Post('checks/:id/assign')
  @HttpCode(200)
  @RequirePermissions('schedules.assign')
  assign(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(assignCheckSchema) body: z.output<typeof assignCheckSchema>,
  ): Promise<CheckDetail> {
    return this.checks.assign(auth, id, body);
  }

  @Post('checks/:id/reschedule')
  @HttpCode(200)
  @RequirePermissions('schedules.reschedule')
  reschedule(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @ValidBody(rescheduleCheckSchema) body: z.output<typeof rescheduleCheckSchema>,
  ): Promise<CheckDetail> {
    return this.checks.reschedule(auth, id, body.dueOn, body.reason);
  }

  @Get('checks/:id/export')
  @RequirePermissions('checks.export')
  async export(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const detail = await this.checks.recordExport(auth, id);
    return file(res, await this.exporter.pdf(auth, detail));
  }
}
