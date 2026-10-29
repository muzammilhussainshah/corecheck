'use client';

import { Alert, Text } from '@mantine/core';
import {
  IconBulldozer,
  IconCalendarExclamation,
  IconClipboardCheck,
  IconMapPinPlus,
  IconShieldPlus,
  IconTool,
  IconUserPlus,
  IconUsersPlus,
  IconKey,
  IconLock,
  IconSettings,
  IconUser,
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useEffect } from 'react';
import {
  AppLayout,
  COLORS,
  formatDate,
  type NavEntry,
  NotificationBell,
  PageLoader,
  type QuickAction,
  QuickActions,
} from '@corecheck/ui';
import { useDispatch } from 'react-redux';
import { api, useLogoutMutation } from '../lib/api';
import { ADMIN_NAV, isActive, MAIN_NAV, type NavItem } from '../lib/navigation';
import { useSession } from '../lib/session';

/** Managers and Admins are warned this many days before expiry (IAD-006). */
const EXPIRY_WARNING_DAYS = 30;

/** Whole days from today, in the organisation's zone, to a calendar date. */
const daysUntil = (date: string, timeZone: string): number => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
};

/** The signed-in frame: CoreStock-style sidebar and header around the page. */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, can, canAny } = useSession();
  const [logout] = useLogoutMutation();
  const dispatch = useDispatch();

  useEffect(() => {
    if (me?.mustChangePin) router.replace('/change-pin');
  }, [me, router]);

  if (!me || me.mustChangePin) {
    return <PageLoader />;
  }

  const signOut = async () => {
    await logout();
    // Drop every cached response so nothing of this session outlives it.
    dispatch(api.util.resetApiState());
    router.replace('/login?reason=SIGNED_OUT');
  };

  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.anyOf || canAny(...item.anyOf));
  // Administration lives behind one "Manage" entry, as on CoreStock; it opens
  // the first section this role may see.
  const manageSections = visible(ADMIN_NAV);
  const nav: NavEntry[] = [
    ...visible(MAIN_NAV),
    ...(manageSections.length > 0
      ? [{ label: 'Manage', href: manageSections[0]!.href, icon: IconSettings }]
      : []),
  ];
  const active = (href: string) =>
    href.startsWith('/admin/')
      ? pathname.startsWith('/admin/')
      : isActive(pathname, href);

  // Only what this role may start (CoreStock rule: never offer a dead end).
  const quickActions: QuickAction[] = [
    ...(can('plant.create')
      ? [{ label: 'Add Plant', href: '/plant/new', icon: IconBulldozer }]
      : []),
    ...(can('users.manage')
      ? [{ label: 'Add User', href: '/admin/users/new', icon: IconUserPlus }]
      : []),
    ...(can('schedules.assign')
      ? [
          {
            label: 'New Check',
            href: '/checks?new=1',
            icon: IconClipboardCheck,
          },
        ]
      : []),
    ...(can('org_structure.manage')
      ? [
          {
            label: 'Add Site',
            href: '/admin/sites?new=1',
            icon: IconMapPinPlus,
          },
          {
            label: 'Add Team',
            href: '/admin/teams?new=1',
            icon: IconUsersPlus,
          },
          {
            label: 'Add Discipline',
            href: '/admin/disciplines?new=1',
            icon: IconTool,
          },
        ]
      : []),
    ...(can('roles.manage')
      ? [
          {
            label: 'New Role',
            href: '/admin/roles?new=1',
            icon: IconShieldPlus,
          },
        ]
      : []),
  ];

  const days = daysUntil(me.organisation.expiresOn, me.organisation.timeZone);
  const banner = (
    <>
      {!me.organisation.readOnly &&
        canAny('users.manage', 'org_settings.manage') &&
        days <= EXPIRY_WARNING_DAYS && (
          <Alert
            color="yellow"
            icon={<IconCalendarExclamation size={18} />}
            mb="lg"
            radius="md"
            title="Your CoreCheck account is due to expire"
          >
            {days === 0
              ? 'Access becomes read-only after today.'
              : `Access becomes read-only after ${formatDate(me.organisation.expiresOn)} (${days} ${days === 1 ? 'day' : 'days'} left).`}{' '}
            Contact CoreCheck to renew.
          </Alert>
        )}
      {me.organisation.readOnly && (
        <Alert
          color="orange"
          icon={<IconLock size={18} />}
          mb="lg"
          radius="md"
          title="Read-only access"
        >
          Your organisation&apos;s CoreCheck account expired on{' '}
          {formatDate(me.organisation.expiresOn)}. You can view and export
          information, but not make changes. Contact CoreCheck to renew.
        </Alert>
      )}
    </>
  );

  return (
    <AppLayout
      nav={nav}
      isActive={active}
      pathname={pathname}
      linkComponent={Link}
      headerStart={
        <Text fw={600} c={COLORS.title} truncate maw={360}>
          {me.organisation.name}
        </Text>
      }
      userName={`${me.user.firstName} ${me.user.lastName}`}
      userDetail={`${me.role.name} · ${me.user.username}`}
      userMenu={[
        { label: 'My Profile', icon: IconUser, href: '/profile' },
        { label: 'Change PIN', icon: IconKey, href: '/profile#pin' },
      ]}
      onSignOut={signOut}
      headerActions={
        <>
          <QuickActions actions={quickActions} linkComponent={Link} />
          <NotificationBell />
        </>
      }
      banner={banner}
    >
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </AppLayout>
  );
}
