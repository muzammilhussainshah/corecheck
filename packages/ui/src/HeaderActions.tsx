'use client';

import {
  ActionIcon,
  Button,
  Group,
  Indicator,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { IconBell, IconBellCheck, IconChevronDown } from '@tabler/icons-react';
import type { ComponentType, ElementType } from 'react';
import { COLORS } from './theme';

export interface QuickAction {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; stroke?: number; color?: string }>;
}

/**
 * "Quick actions" as on CoreStock: a short menu of things this person can
 * start from anywhere. Built from their permissions by the host app, so it
 * never offers a screen they would be turned away from; with nothing to offer
 * there is no button at all.
 */
export const QuickActions = ({
  actions,
  linkComponent: Link,
}: {
  actions: QuickAction[];
  linkComponent: ElementType;
}) => {
  if (actions.length === 0) return null;
  return (
    <Menu position="bottom-end" width={230} radius="md" shadow="md">
      <Menu.Target>
        <Button rightSection={<IconChevronDown size={18} />} visibleFrom="xs">
          Quick actions
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Quick Actions</Menu.Label>
        {actions.map((action) => (
          <Menu.Item
            key={action.href}
            component={Link as 'a'}
            href={action.href}
            leftSection={
              <action.icon size={19} stroke={1.6} color={COLORS.muted} />
            }
            c={COLORS.muted}
            fw={500}
            py={10}
          >
            {action.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};

/**
 * The bell beside the account menu. Alerts (overdue checks, Defects, expiring
 * documents) arrive with the notifications release; until then it says so.
 */
export interface BellItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * The header bell: unread count and the latest notifications (NTF-002, in
 * app). Opening one marks it read; "Mark all read" clears the count.
 */
export const NotificationBell = ({
  items = [],
  unread = 0,
  onOpen,
  onMarkAllRead,
  formatTime = (iso: string) => iso,
}: {
  items?: BellItem[];
  unread?: number;
  onOpen?: (item: BellItem) => void;
  onMarkAllRead?: () => void;
  formatTime?: (iso: string) => string;
}) => (
  <Popover position="bottom-end" width={360} radius="md" shadow="md">
    <Popover.Target>
      <Indicator
        label={unread > 99 ? '99+' : unread}
        size={18}
        disabled={unread === 0}
        color="red"
        offset={4}
      >
        <ActionIcon
          variant="default"
          size={40}
          radius="md"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          style={{ borderColor: COLORS.border }}
        >
          <IconBell size={20} stroke={1.6} color={COLORS.secondaryText} />
        </ActionIcon>
      </Indicator>
    </Popover.Target>
    <Popover.Dropdown p={0}>
      {items.length === 0 ? (
        <Stack align="center" gap={6} p="lg">
          <ThemeIcon variant="light" size={44} radius="xl">
            <IconBellCheck size={22} />
          </ThemeIcon>
          <Text fw={600} c={COLORS.title}>
            You&apos;re all caught up
          </Text>
          <Text size="sm" c={COLORS.muted} ta="center">
            Alerts for overdue checks, Defects and approvals appear here.
          </Text>
        </Stack>
      ) : (
        <>
          <Group justify="space-between" px="md" py="sm">
            <Text fw={600} c={COLORS.title}>
              Notifications
            </Text>
            {unread > 0 && onMarkAllRead && (
              <Button variant="subtle" size="compact-xs" onClick={onMarkAllRead}>
                Mark all read
              </Button>
            )}
          </Group>
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {items.map((item) => (
                <UnstyledButton
                  key={item.id}
                  onClick={() => onOpen?.(item)}
                  px="md"
                  py="sm"
                  style={{
                    borderTop: `1px solid ${COLORS.border}`,
                    backgroundColor: item.readAt ? undefined : 'var(--mantine-color-brand-0)',
                  }}
                >
                  <Text size="sm" fw={item.readAt ? 500 : 700} c={COLORS.title}>
                    {item.title}
                  </Text>
                  <Text size="xs" c={COLORS.muted} lineClamp={2}>
                    {item.body}
                  </Text>
                  <Text size="xs" c={COLORS.muted} mt={2}>
                    {formatTime(item.createdAt)}
                  </Text>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </>
      )}
    </Popover.Dropdown>
  </Popover>
);
