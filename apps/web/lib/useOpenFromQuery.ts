'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Opens a page's "add" form when it is reached with ?new=1, which is how the
 * header's Quick actions start one. The flag is then dropped from the URL so
 * a refresh does not reopen the form.
 */
export function useOpenFromQuery(open: () => void): void {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    openRef.current();
    router.replace(pathname);
  }, [wantsNew, router, pathname]);
}
