import { Module } from '@nestjs/common';
import { PlantsModule } from '../plants/plants.module.js';
import { PlantConfigController } from './plant-config.controller.js';
import { PlantConfigService } from './plant-config.service.js';

@Module({
  imports: [PlantsModule],
  controllers: [PlantConfigController],
  providers: [PlantConfigService],
  exports: [PlantConfigService],
})
export class PlantConfigModule {}
