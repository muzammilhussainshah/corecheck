/**
 * Code shared by the api, web, admin and mobile apps.
 *
 * Anything that must mean the same thing everywhere lives here: permission
 * codes, status values and labels, request validation and response types.
 * FRD NAV-005 requires web and mobile to use the same terminology and status
 * labels, so those are defined once here rather than in each app.
 */
export const APP_NAME = 'CoreCheck';

export * from './api-types.js';
export * from './audit.js';
export * from './errors.js';
export * from './permissions.js';
export * from './pin.js';
export * from './plant-import.js';
export * from './poc.js';
export * from './reception.js';
export * from './roles.js';
export * from './schemas.js';
export * from './statuses.js';
