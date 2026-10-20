import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { CustomerAuth, StaffAuth } from '../auth/auth-context.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates the response, the logs and any support query. */
      requestId: string;
      /** Set by the auth guard on customer routes. */
      auth?: CustomerAuth;
      /** Set by the auth guard on internal staff routes. */
      staff?: StaffAuth;
    }
  }
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Gives every request an id, reusing a well-formed one from the caller. */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = req.header('x-request-id');
  req.requestId =
    incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
});
