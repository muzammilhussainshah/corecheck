import './config/load-env-file.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
const config = app.get<AppConfig>(APP_CONFIG);
configureApp(app, config);
await app.listen(config.PORT);
