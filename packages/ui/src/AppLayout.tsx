'use client';

import {
  ActionIcon,
  AppShell,
  Avatar,
  Box,
  Burger,
  Group,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconChevronDown,
  IconChevronLeft,
  IconLogout,
  IconMenu2,
} from '@tabler/icons-react';
import {
  type ComponentType,
  type ElementType,
  type ReactNode,
  useEffect,
} from 'react';
import { COLORS } from './theme';

type IconComponent = ComponentType<{
  size?: number;
  stroke?: number;
  color?: string;
}>;

export interface NavEntry {
  label: string;
  href: string;
  icon: IconComponent;
}

export interface UserMenuEntry {
  label: string;
  icon: IconComponent;
  href?: string;
  onClick?: () => void;
}

const OPEN_WIDTH = 260;
const CLOSED_WIDTH = 72;

/**
 * The signed-in shell, same arrangement as CoreStock: a dark sidebar that
 * folds down to icons, "Main Menu" links with the active one filled, sign-out
 * at the foot, and a white header carrying the account menu.
 */
export function AppLayout({
  nav,
  isActive,
  pathname,
  linkComponent: Link,
  headerStart,
  userName,
  userDetail,
  userMenu,
  onSignOut,
  banner,
  headerActions,
  children,
}: {
  nav: NavEntry[];
  isActive: (href: string) => boolean;
  pathname: string;
  /** The host app's router link (next/link). */
  linkComponent: ElementType;
  /** Shown at the left of the header, e.g. the organisation name. */
  headerStart?: ReactNode;
  userName: string;
  userDetail: string;
  userMenu: UserMenuEntry[];
  onSignOut: () => void;
  /** Notices above every page (read-only access, expiry). */
  banner?: ReactNode;
  /** Quick actions and the notification bell, left of the account menu. */
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const isDesktop = useMediaQuery('(min-width: 62em)', true);
  const [mobileOpen, { toggle: toggleMobile, close: closeMobile }] =
    useDisclosure(false);
  const [expanded, setExpanded] = useLocalStorage({
    key: 'corecheck.sidebar-expanded',
    defaultValue: true,
  });
  useEffect(closeMobile, [pathname, closeMobile]);

  // On phones the sidebar is a full-width drawer, always showing labels.
  const showLabels = !isDesktop || expanded;
  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const navButton = (item: NavEntry) => {
    const active = isActive(item.href);
    const link = (
      <UnstyledButton
        key={item.href}
        component={Link as 'a'}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          height: 48,
          padding: showLabels ? '0 18px' : 0,
          justifyContent: showLabels ? 'flex-start' : 'center',
          borderRadius: 12,
          backgroundColor: active
            ? 'var(--mantine-color-brand-6)'
            : 'transparent',
          color: COLORS.sidebarText,
          fontWeight: active ? 600 : 500,
          fontSize: 15,
          transition: 'background-color 120ms ease',
        }}
        className="cc-nav-link"
      >
        <item.icon size={20} stroke={1.8} />
        {showLabels && <span>{item.label}</span>}
      </UnstyledButton>
    );
    return showLabels ? (
      link
    ) : (
      <Tooltip key={item.href} label={item.label} position="right" withArrow>
        {link}
      </Tooltip>
    );
  };

  return (
    <AppShell
      layout="alt"
      header={{ height: 64 }}
      navbar={{
        width: isDesktop && !expanded ? CLOSED_WIDTH : OPEN_WIDTH,
        breakpoint: 'md',
        collapsed: { mobile: !mobileOpen },
      }}
      padding={0}
      styles={{
        main: { backgroundColor: COLORS.page, minHeight: '100vh' },
        navbar: {
          backgroundColor: COLORS.sidebar,
          borderRight: 'none',
          transition: 'width 200ms ease',
        },
        header: {
          borderBottom: `1px solid ${COLORS.borderStrong}`,
          boxShadow: '0 1px 3px rgba(16, 24, 40, 0.06)',
        },
      }}
    >
      <style>{`.cc-nav-link:hover:not([aria-current="page"]) { background-color: rgba(255,255,255,0.07) !important; }`}</style>
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger
              opened={mobileOpen}
              onClick={toggleMobile}
              hiddenFrom="md"
              size="sm"
              aria-label="Toggle navigation"
            />
            {headerStart}
          </Group>
          <Group gap="sm" wrap="nowrap">
            {headerActions}
            <Menu position="bottom-end" width={240} radius="md" shadow="md">
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <Group gap="xs" wrap="nowrap">
                    <Avatar
                      radius="xl"
                      size={36}
                      color="brand"
                      variant="filled"
                    >
                      {initials}
                    </Avatar>
                    <Stack gap={0} visibleFrom="sm">
                      <Text size="sm" fw={600} c={COLORS.title} lh={1.3}>
                        {userName}
                      </Text>
                      <Text size="xs" c={COLORS.muted} lh={1.3}>
                        {userDetail}
                      </Text>
                    </Stack>
                    <IconChevronDown size={16} color={COLORS.muted} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Group gap="sm" p="sm" wrap="nowrap">
                  <Avatar radius="xl" color="brand" variant="filled">
                    {initials}
                  </Avatar>
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {userName}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {userDetail}
                    </Text>
                  </Box>
                </Group>
                <Menu.Divider />
                {userMenu.map((item) => (
                  <Menu.Item
                    key={item.label}
                    component={(item.href ? Link : 'button') as 'a'}
                    href={item.href}
                    onClick={item.onClick}
                    leftSection={<item.icon size={17} color={COLORS.muted} />}
                    c={COLORS.muted}
                    fw={500}
                  >
                    {item.label}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconLogout size={17} />}
                  onClick={onSignOut}
                  c={COLORS.muted}
                  fw={500}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar aria-label="Main menu">
        <Group
          h={64}
          px={showLabels ? 'md' : 0}
          justify={showLabels ? 'space-between' : 'center'}
          wrap="nowrap"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          {showLabels && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/logo-white.png"
              alt="CoreCheck"
              style={{ height: 22, width: 'auto', maxWidth: 170 }}
            />
          )}
          {isDesktop && (
            <ActionIcon
              onClick={() => setExpanded((value) => !value)}
              radius="xl"
              size={32}
              variant="white"
              color="dark"
              aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {expanded ? (
                <IconChevronLeft size={18} />
              ) : (
                <IconMenu2 size={18} />
              )}
            </ActionIcon>
          )}
        </Group>
        <AppShell.Section grow component={ScrollArea} px={8} pt="lg">
          {showLabels && (
            <Text size="xs" c={COLORS.sidebarMuted} px={10} mb={8}>
              Main Menu
            </Text>
          )}
          <Stack gap={6}>{nav.map(navButton)}</Stack>
        </AppShell.Section>
        <AppShell.Section px={8} pb="md">
          <UnstyledButton
            onClick={onSignOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              width: '100%',
              height: 48,
              padding: showLabels ? '0 18px' : 0,
              justifyContent: showLabels ? 'flex-start' : 'center',
              borderRadius: 12,
              color: COLORS.sidebarText,
              fontWeight: 500,
              fontSize: 15,
            }}
            className="cc-nav-link"
            aria-label="Sign out"
          >
            <IconLogout size={20} stroke={1.8} />
            {showLabels && <span>Logout</span>}
          </UnstyledButton>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box p={{ base: 'md', sm: 'xl' }} maw={1600}>
          {banner}
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
