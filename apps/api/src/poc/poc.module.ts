import { Module } from '@nestjs/common';
import { PocSyncController } from './poc-sync.controller.js';
import { PocSyncService } from './poc-sync.service.js';

@Module({
  controllers: [PocSyncController],
  providers: [PocSyncService],
})
export class PocModule {}
