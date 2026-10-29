import { Module } from '@nestjs/common';
import { PlantOutputService } from './plant-output.service.js';
import { PlantsController } from './plants.controller.js';
import { PlantsService } from './plants.service.js';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, PlantOutputService],
  exports: [PlantsService],
})
export class PlantsModule {}
