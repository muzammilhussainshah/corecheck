'use client';

import { Group, Text } from '@mantine/core';
import {
  IconBuildingSkyscraper,
  IconListDetails,
  IconUserCog,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { STAFF_ROLE_LABELS } from '@corecheck/shared';
import {
  AppLayout,
  COLORS,
  type NavEntry,
  PageLoader,
  Pill,
} from '@corecheck/ui';
import { api, useLogoutMutation, useMeQuery } from '../lib/api';

const NAV: Array<NavEntry & { ownerOnly: boolean }> = [
  {
    label: 'Organisations',
    href: '/organisations',
    icon: IconBuildingSkyscraper,
    ownerOnly: false,
  },
  { label: 'Staff', href: '/staff', icon: IconUsers, ownerOnly: true },
  {
    label: 'Audit trail',
    href: '/audit',
    icon: IconListDetails,
    ownerOnly: false,
  },
  {
    label: 'My account',
    href: '/account',
    icon: IconUserCog,
    ownerOnly: false,
  },
];

/** The internal portal's frame: the same CoreStock-style shell as the customer app. */
export function PortalFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useDispatch();
  const { data: me } = useMeQuery();
  const [logout] = useLogoutMutation();

  const pending = me && (!me.mfaVerified || me.mustChangePassword);
  useEffect(() => {
    if (!me) return;
    if (!me.mfaVerified) router.replace('/mfa');
    else if (me.mustChangePassword) router.replace('/change-password');
  }, [me, router]);

  if (!me || pending) return <PageLoader label="CoreCheck Admin" />;

  const signOut = async () => {
    await logout();
    dispatch(api.util.resetApiState());
    router.replace('/login?reason=SIGNED_OUT');
  };

  return (
    <AppLayout
      nav={NAV.filter((item) => !item.ownerOnly || me.staffRole === 'owner')}
      isActive={(href) => pathname === href || pathname.startsWith(`${href}/`)}
      pathname={pathname}
      linkComponent={Link}
      headerStart={
        <Group gap="sm" wrap="nowrap">
          <Text fw={600} c={COLORS.title}>
            Internal administration
          </Text>
          <Pill tone="info">Staff only</Pill>
        </Group>
      }
      userName={me.name}
      userDetail={`${STAFF_ROLE_LABELS[me.staffRole]} · ${me.email}`}
      userMenu={[{ label: 'My account', icon: IconUserCog, href: '/account' }]}
      onSignOut={signOut}
    >
      <Suspense fallback={<PageLoader label="CoreCheck Admin" />}>
        {children}
      </Suspense>
    </AppLayout>
  );
}
