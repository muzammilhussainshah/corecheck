import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];
const SESSION_COOKIE = 'cc_session';

/**
 * Sends visitors without a session cookie to sign in before any page renders.
 * This is only an optimistic check: every API request is authorised by the
 * API itself, which also handles expired or revoked sessions.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isPublic || request.cookies.has(SESSION_COOKIE))
    return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  // Come back here after signing in, e.g. to a scanned plant QR code. The
  // login page accepts only same-site paths (lib/return-path.ts).
  if (pathname !== '/')
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the API rewrite, Next.js internals and static files.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)',
  ],
};
