import { Module } from '@nestjs/common';
import { TemplateImportsController } from './template-imports.controller.js';
import { TemplateImportsService } from './template-imports.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({
  controllers: [TemplatesController, TemplateImportsController],
  providers: [TemplatesService, TemplateImportsService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
