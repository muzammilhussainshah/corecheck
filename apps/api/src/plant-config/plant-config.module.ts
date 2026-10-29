import { Module } from '@nestjs/common';
import { PlantConfigController } from './plant-config.controller.js';
import { PlantConfigService } from './plant-config.service.js';

@Module({
  controllers: [PlantConfigController],
  providers: [PlantConfigService],
  exports: [PlantConfigService],
})
export class PlantConfigModule {}
