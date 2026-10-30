'use client';

import {
  Box,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowRight,
  IconId,
  IconMapPin,
  IconRocket,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';
import { COLORS, Pill, StatCard } from '@corecheck/ui';
import { useSeatUsageQuery, useSitesQuery } from '../../lib/api';
import { ADMIN_NAV } from '../../lib/navigation';
import { useSession } from '../../lib/session';

/** "Good morning" etc. at the user's own hour of day. */
const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
};

/** Today in the organisation's zone, e.g. "Sunday, October 19". */
const today = (timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());

export default function DashboardPage() {
  const { me, can, canAny } = useSession();
  const { data: seats } = useSeatUsageQuery(undefined, {
    skip: !can('users.view'),
  });
  const { data: sites } = useSitesQuery(undefined, {
    skip: !can('org_structure.view'),
  });
  if (!me) return null;

  const shortcuts = ADMIN_NAV.filter(
    (item) => !item.anyOf || canAny(...item.anyOf),
  );
  const siteNames = me.scope.orgWide
    ? 'All sites'
    : (sites ?? []).map((site) => site.name).join(', ') ||
      'No sites assigned yet';

  return (
    <Stack gap="lg">
      <Card withBorder shadow="xs">
        <Text fz="sm" c={COLORS.muted} fw={500}>
          {today(me.organisation.timeZone)}
        </Text>
        <Title order={2} fz={{ base: 22, sm: 26 }} c={COLORS.title} mt={4}>
          {greeting()}, {me.user.firstName} 👋
        </Title>
        <Text fz="sm" c={COLORS.muted} mt={4}>
          {me.organisation.name}
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
        <StatCard
          label="Your role"
          value={
            <Group gap={8} component="span">
              {me.role.name}
              {me.role.privileged && <Pill tone="info">Privileged</Pill>}
            </Group>
          }
          icon={<IconId size={20} />}
        />
        <StatCard
          label="Your sites"
          value={
            <Text
              component="span"
              fz="md"
              fw={600}
              c={COLORS.title}
              lineClamp={2}
            >
              {siteNames}
            </Text>
          }
          icon={<IconMapPin size={20} />}
        />
        {seats && (
          <Card withBorder shadow="xs" padding={16}>
            <Group justify="space-between" align="flex-start">
              <Box>
                <Text c={COLORS.muted} fw={500} mb={8}>
                  Licensed seats
                </Text>
                <Text fz={24} fw={700} c="#1E293B" lh={1.2}>
                  {seats.used} / {seats.limit}
                </Text>
              </Box>
              <Box
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--mantine-color-brand-0)',
                  color: 'var(--mantine-color-brand-7)',
                }}
              >
                <IconUsers size={20} />
              </Box>
            </Group>
            <Progress
              value={(seats.used / seats.limit) * 100}
              mt="md"
              radius="xl"
              color={seats.available === 0 ? 'red' : 'brand'}
              aria-label="Seats in use"
            />
            {seats.available === 0 && (
              <Text size="xs" c="red.7" mt={6} fw={500}>
                All seats are in use. Contact CoreCheck to add more.
              </Text>
            )}
          </Card>
        )}
        <StatCard
          label="Coming next"
          value={
            <Text component="span" fz="sm" fw={500} c={COLORS.body}>
              Checks and Defects arrive in the next release.
            </Text>
          }
          icon={<IconRocket size={20} />}
        />
      </SimpleGrid>

      {shortcuts.length > 0 && (
        <Card withBorder shadow="xs">
          <Title order={3} fz={18} c={COLORS.title} mb="md">
            Manage
          </Title>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 6 }} spacing="sm">
            {shortcuts.map((item) => (
              <UnstyledButton
                key={item.href}
                component={Link}
                href={item.href}
                p="md"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.panel,
                  color: COLORS.secondaryText,
                  fontWeight: 600,
                }}
              >
                <Group gap={10} wrap="nowrap">
                  <item.icon size={18} stroke={1.8} />
                  {item.label}
                </Group>
                <IconArrowRight size={16} color={COLORS.muted} />
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Card>
      )}
    </Stack>
  );
}
