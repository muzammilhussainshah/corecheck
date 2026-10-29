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
  type DocumentRegisterRow,
  listDocumentsQuerySchema,
  MAX_DOCUMENT_BYTES,
  type Paginated,
  type PlantDocument,
  type PlantDocuments,
  rejectDocumentSchema,
  replaceDocumentSchema,
  uploadDocumentSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import {
  DocumentsService,
  type UploadedFile as Upload,
} from './documents.service.js';

/** One file per request; a little over the limit so the API can say why. */
const fileUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 10 },
    }),
  );

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('plants/:id/documents')
  @RequirePermissions('plant.view', 'documents.view')
  forPlant(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
  ): Promise<PlantDocuments> {
    return this.documents.forPlant(auth, plantId);
  }

  @Post('plants/:id/documents')
  @RequirePermissions('plant.view', 'documents.upload')
  @fileUpload()
  upload(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
    @ValidBody(uploadDocumentSchema)
    fields: z.output<typeof uploadDocumentSchema>,
    @UploadedFile() file: Upload,
  ): Promise<PlantDocument> {
    return this.documents.upload(auth, plantId, fields, file);
  }

  @Get('documents')
  @RequirePermissions('documents.view')
  register(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listDocumentsQuerySchema)
    query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<Paginated<DocumentRegisterRow>> {
    return this.documents.register(auth, query);
  }

  @Post('documents/:id/versions')
  @RequirePermissions('documents.upload')
  @fileUpload()
  replace(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
    @ValidBody(replaceDocumentSchema)
    fields: z.output<typeof replaceDocumentSchema>,
    @UploadedFile() file: Upload,
  ): Promise<PlantDocument> {
    return this.documents.replace(auth, id, fields, file);
  }

  @Post('documents/:id/verify')
  @HttpCode(200)
  @RequirePermissions('documents.verify')
  verify(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
  ): Promise<PlantDocument> {
    return this.documents.verify(auth, id);
  }

  @Post('documents/:id/reject')
  @HttpCode(200)
  @RequirePermissions('documents.verify')
  reject(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
    @ValidBody(rejectDocumentSchema)
    body: z.output<typeof rejectDocumentSchema>,
  ): Promise<PlantDocument> {
    return this.documents.reject(auth, id, body.reason);
  }

  @Post('documents/:id/archive')
  @HttpCode(200)
  @RequirePermissions('documents.manage')
  archive(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
  ): Promise<PlantDocument> {
    return this.documents.setArchived(auth, id, true);
  }

  @Post('documents/:id/restore')
  @HttpCode(200)
  @RequirePermissions('documents.manage')
  restore(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
  ): Promise<PlantDocument> {
    return this.documents.setArchived(auth, id, false);
  }

  /** The file of one version, after the scope check (DOC-AC-03). */
  @Get('documents/:id/versions/:versionId/file')
  @RequirePermissions('documents.view')
  async file(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Document') id: string,
    @IdParam('Document', 'versionId') versionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.file(auth, id, versionId);
    res.setHeader('X-Filename', encodeURIComponent(file.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.body.length,
    });
  }
}
