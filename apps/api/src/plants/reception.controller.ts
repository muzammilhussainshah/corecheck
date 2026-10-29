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
  assignReceptionSchema,
  MAX_DOCUMENT_BYTES,
  type PlantReception,
  type ReceptionCheck,
  returnReceptionSchema,
  saveReceptionAnswersSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody } from '../common/validation.js';
import type { UploadedFile as Upload } from './documents.service.js';
import { ReceptionService } from './reception.service.js';

@Controller()
export class ReceptionController {
  constructor(private readonly reception: ReceptionService) {}

  @Get('plants/:id/reception')
  @RequirePermissions('plant.view')
  forPlant(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
  ): Promise<PlantReception> {
    return this.reception.forPlant(auth, plantId);
  }

  @Post('plants/:id/reception')
  @RequirePermissions('plant.view', 'reception.assign_template')
  assign(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
    @ValidBody(assignReceptionSchema)
    body: z.output<typeof assignReceptionSchema>,
  ): Promise<PlantReception> {
    return this.reception.assign(auth, plantId, body.templateId);
  }

  @Put('receptions/:id/answers')
  @RequirePermissions('reception.complete')
  saveAnswers(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
    @ValidBody(saveReceptionAnswersSchema)
    body: z.output<typeof saveReceptionAnswersSchema>,
  ): Promise<ReceptionCheck> {
    return this.reception.saveAnswers(auth, id, body.answers);
  }

  @Post('receptions/:id/questions/:questionId/evidence')
  @RequirePermissions('reception.complete')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 },
    }),
  )
  addEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
    @Param('questionId') questionId: string,
    @UploadedFile() file: Upload,
  ): Promise<ReceptionCheck> {
    return this.reception.addEvidence(auth, id, questionId, file);
  }

  @Post('receptions/:id/evidence/:evidenceId/remove')
  @HttpCode(200)
  @RequirePermissions('reception.complete')
  removeEvidence(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
    @IdParam('Photo', 'evidenceId') evidenceId: string,
  ): Promise<ReceptionCheck> {
    return this.reception.removeEvidence(auth, id, evidenceId);
  }

  @Get('receptions/:id/evidence/:evidenceId/file')
  @RequirePermissions('plant.view')
  async evidenceFile(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
    @IdParam('Photo', 'evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.reception.evidenceFile(auth, id, evidenceId);
    res.setHeader('X-Filename', encodeURIComponent(file.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.body.length,
    });
  }

  @Post('receptions/:id/submit')
  @HttpCode(200)
  @RequirePermissions('reception.complete')
  submit(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
  ): Promise<PlantReception> {
    return this.reception.submit(auth, id);
  }

  @Post('receptions/:id/approve')
  @HttpCode(200)
  @RequirePermissions('reception.approve')
  approve(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
  ): Promise<PlantReception> {
    return this.reception.approve(auth, id);
  }

  @Post('receptions/:id/return')
  @HttpCode(200)
  @RequirePermissions('reception.approve')
  returnForCorrection(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
    @ValidBody(returnReceptionSchema)
    body: z.output<typeof returnReceptionSchema>,
  ): Promise<PlantReception> {
    return this.reception.returnForCorrection(auth, id, body.comment);
  }

  @Post('receptions/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('reception.assign_template')
  cancel(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reception') id: string,
  ): Promise<PlantReception> {
    return this.reception.cancel(auth, id);
  }
}
