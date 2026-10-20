import { Inject } from '@nestjs/common';
import type { Env } from './env.js';

/** Injection token for the validated environment. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export const InjectConfig = () => Inject(APP_CONFIG);

export type AppConfig = Env;
