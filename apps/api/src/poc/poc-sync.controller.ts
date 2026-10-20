import { createReadStream } from 'node:fs';
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
  POC_MAX_EVIDENCE_BYTES,
  type PocCheck,
  pocCreateCheckSchema,
  pocEvidenceFieldsSchema,
  type PocEvidence,
  type PocPullResponse,
  pocPushSchema,
  type PocPushResponse,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody } from '../common/validation.js';
import { PocSyncService } from './poc-sync.service.js';

/** Offline synchronisation proof of concept (Milestone 1). */
@Controller('poc')
export class PocSyncController {
  constructor(private readonly poc: PocSyncService) {}

  @Get('sync')
  @RequirePermissions('checks.view')
  pull(@CurrentAuth() auth: CustomerAuth): Promise<PocPullResponse> {
    return this.poc.pull(auth);
  }

  @Post('sync')
  @HttpCode(200)
  @RequirePermissions('checks.perform')
  push(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(pocPushSchema) body: z.output<typeof pocPushSchema>,
  ): Promise<PocPushResponse> {
    return this.poc.push(auth, body.mutations);
  }

  /** Creates demo work to complete on a device; assigning work is a Supervisor task. */
  @Post('checks')
  @RequirePermissions('schedules.assign')
  createCheck(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(pocCreateCheckSchema)
    body: z.output<typeof pocCreateCheckSchema>,
  ): Promise<PocCheck> {
    return this.poc.createCheck(auth, body);
  }

  @Post('checks/:id/evidence')
  @RequirePermissions('checks.perform')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: POC_MAX_EVIDENCE_BYTES, files: 1 },
    }),
  )
  uploadEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Check') checkId: string,
    @ValidBody(pocEvidenceFieldsSchema)
    fields: z.output<typeof pocEvidenceFieldsSchema>,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ): Promise<PocEvidence> {
    return this.poc.uploadEvidence(auth, checkId, fields, file);
  }

  @Get('evidence/:id')
  @RequirePermissions('checks.view')
  async evidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Evidence') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { path, contentType } = await this.poc.evidenceFile(auth, id);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(path), {
      type: contentType,
      disposition: 'inline',
    });
  }
}
