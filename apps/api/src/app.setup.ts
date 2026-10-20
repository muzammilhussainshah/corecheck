import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from './common/request.js';
import type { AppConfig } from './config/app-config.js';

/** Responses carry customer data: never cache them, frame them or sniff them. */
const securityHeaders = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** HTTP set-up shared by the server and the integration tests. */
export const configureApp = (
  app: NestExpressApplication,
  config: AppConfig,
): void => {
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', true);
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
};
