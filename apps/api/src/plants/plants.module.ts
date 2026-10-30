import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module.js';
import { ComplianceSweepService } from './compliance-sweep.service.js';
import { ComplianceService } from './compliance.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';
import { MetersController } from './meters.controller.js';
import { MetersService } from './meters.service.js';
import { PlantOutputService } from './plant-output.service.js';
import { PlantsController } from './plants.controller.js';
import { PlantsService } from './plants.service.js';
import { ReceptionController } from './reception.controller.js';
import { ReceptionService } from './reception.service.js';

@Module({
  imports: [TemplatesModule],
  controllers: [
    PlantsController,
    DocumentsController,
    ReceptionController,
    MetersController,
    ImportsController,
  ],
  providers: [
    PlantsService,
    PlantOutputService,
    ComplianceService,
    ComplianceSweepService,
    DocumentsService,
    ReceptionService,
    MetersService,
    ImportsService,
  ],
  exports: [PlantsService, ComplianceService, ComplianceSweepService],
})
export class PlantsModule {}
