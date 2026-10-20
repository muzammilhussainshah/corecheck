import type { CookieOptions, Request, Response } from 'express';

/**
 * Session cookies. Web and admin each run on their own origin and reach the
 * API through a same-origin /api rewrite, so the cookies are host-only,
 * httpOnly (unreadable by page scripts) and SameSite=Strict (never sent on
 * cross-site requests, which also rules out CSRF).
 */
export const CUSTOMER_COOKIE = 'cc_session';
export const STAFF_COOKIE = 'cc_staff_session';

const options = (secure: boolean, maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'strict',
  path: '/',
  ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
});

export const setSessionCookie = (
  res: Response,
  name: string,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void => {
  res.cookie(
    name,
    token,
    options(secure, Math.max(0, expiresAt.getTime() - Date.now())),
  );
};

export const clearSessionCookie = (
  res: Response,
  name: string,
  secure: boolean,
): void => {
  res.clearCookie(name, options(secure));
};

/** The session token from the Authorization header (mobile) or the cookie (web). */
export const readSessionToken = (
  req: Request,
  cookieName: string,
): string | null => {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[cookieName] || null;
};
