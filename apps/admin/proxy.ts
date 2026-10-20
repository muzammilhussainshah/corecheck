import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];
const SESSION_COOKIE = 'cc_staff_session';

/**
 * Sends visitors without a session cookie to sign in before any page renders.
 * This is only an optimistic check: every API request is authorised by the
 * API itself, which also handles expired or revoked sessions.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isPublic || request.cookies.has(SESSION_COOKIE))
    return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search =
    pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the API rewrite, Next.js internals and static files.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)',
  ],
};
