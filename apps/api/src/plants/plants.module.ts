import { Module } from '@nestjs/common';
import { ComplianceSweepService } from './compliance-sweep.service.js';
import { ComplianceService } from './compliance.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { PlantOutputService } from './plant-output.service.js';
import { PlantsController } from './plants.controller.js';
import { PlantsService } from './plants.service.js';

@Module({
  controllers: [PlantsController, DocumentsController],
  providers: [
    PlantsService,
    PlantOutputService,
    ComplianceService,
    ComplianceSweepService,
    DocumentsService,
  ],
  exports: [PlantsService, ComplianceService, ComplianceSweepService],
})
export class PlantsModule {}
