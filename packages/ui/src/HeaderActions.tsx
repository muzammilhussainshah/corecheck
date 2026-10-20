'use client';

import {
  ActionIcon,
  Button,
  Menu,
  Popover,
  Stack,
  Text,
  ThemeIcon,
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
export const NotificationBell = () => (
  <Popover position="bottom-end" width={300} radius="md" shadow="md">
    <Popover.Target>
      <ActionIcon
        variant="default"
        size={40}
        radius="md"
        aria-label="Notifications"
        style={{ borderColor: COLORS.border }}
      >
        <IconBell size={20} stroke={1.6} color={COLORS.secondaryText} />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown p="lg">
      <Stack align="center" gap={6}>
        <ThemeIcon variant="light" size={44} radius="xl">
          <IconBellCheck size={22} />
        </ThemeIcon>
        <Text fw={600} c={COLORS.title}>
          You&apos;re all caught up
        </Text>
        <Text size="sm" c={COLORS.muted} ta="center">
          Alerts for overdue checks, Defects and expiring documents will appear
          here.
        </Text>
      </Stack>
    </Popover.Dropdown>
  </Popover>
);
