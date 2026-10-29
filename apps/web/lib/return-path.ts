/**
 * The page to return to after signing in, if it is a page of this app. Only
 * same-site paths are accepted ("/plant/1", not "//evil.example" or
 * "https://…"), so the parameter cannot send anyone to another site.
 */
export const safeReturnPath = (value: string | null): string | null => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || /[\r\n]/.test(value)) return null;
  if (value.startsWith('/login') || value.startsWith('/change-pin'))
    return null;
  return value;
};

/** The login URL for a session that ended while on the current page. */
export const loginUrl = (reason: string): string => {
  const here = `${window.location.pathname}${window.location.search}`;
  const next = safeReturnPath(here);
  return `/login?reason=${encodeURIComponent(reason)}${
    next && next !== '/' ? `&next=${encodeURIComponent(next)}` : ''
  }`;
};
