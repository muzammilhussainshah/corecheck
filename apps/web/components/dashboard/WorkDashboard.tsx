'use client';

import {
  Anchor,
  Box,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconClockExclamation,
} from '@tabler/icons-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  auditActionLabel,
  TEMPLATE_PURPOSE_LABELS,
} from '@corecheck/shared';
import { COLORS, formatDateTime, Pill } from '@corecheck/ui';
import { useDashboardQuery } from '../../lib/api';
import { useSession } from '../../lib/session';

/** One dashboard figure; it opens its list with the same filters (DSH-AC-01). */
function Figure({
  label,
  value,
  href,
  alert,
}: {
  label: ReactNode;
  value: number;
  href: string;
  /** Needs attention: an icon and bold text, never colour alone (DSH-AC-04). */
  alert?: boolean;
}) {
  const flagged = alert && value > 0;
  return (
    <UnstyledButton
      component={Link}
      href={href}
      p="sm"
      style={{
        borderRadius: 12,
        border: `1px solid ${flagged ? 'var(--mantine-color-red-4)' : COLORS.border}`,
        backgroundColor: flagged ? 'var(--mantine-color-red-0)' : COLORS.panel,
        display: 'block',
      }}
    >
      <Group gap={6} wrap="nowrap">
        {flagged && <IconAlertTriangle size={16} color="var(--mantine-color-red-7)" aria-hidden />}
        <Text size="sm" c={COLORS.muted} fw={500}>
          {label}
        </Text>
      </Group>
      <Text fz={24} fw={700} c={flagged ? 'red.8' : '#1E293B'} lh={1.3}>
        {value}
      </Text>
    </UnstyledButton>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card withBorder shadow="xs">
      <Title order={3} fz={18} c={COLORS.title} mb="md">
        {title}
      </Title>
      {children}
    </Card>
  );
}

/**
 * The work part of the dashboard (FRD 6): plant awaiting reception or
 * review, plant Online/Offline, due and overdue checks, checks needing
 * attention, open Defects by severity, document exceptions, recently
 * completed checks and recent plant status changes, all within the user's
 * scope and opening their lists already filtered.
 */
export function WorkDashboard() {
  const { me, canAny } = useSession();
  const { data } = useDashboardQuery(undefined, {
    skip: !canAny('plant.view', 'checks.view', 'defects.view', 'documents.view'),
  });
  if (!data || !me) return null;
  const tz = me.organisation.timeZone;
  const { period, checks, plant, defects, documents } = data;
  const due = (from: string, to: string, label: string) =>
    `/checks?view=due&dueFrom=${from}&dueTo=${to}&label=${encodeURIComponent(label)}`;
  const recent = (extra: string, label: string) =>
    `/checks?view=all&submittedFrom=${period.recentFrom}&${extra}&label=${encodeURIComponent(label)}`;
  return (
    <Stack gap="lg">
      {checks && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Section title="Due checks">
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
              <Figure label="Due today" value={checks.dueToday} href={due(period.today, period.today, 'Due today')} />
              <Figure label="Due this week" value={checks.dueThisWeek} href={due(period.today, period.weekEnd, 'Due this week')} />
              <Figure label="Due this month" value={checks.dueThisMonth} href={due(period.today, period.monthEnd, 'Due this month')} />
              <Figure
                label={
                  <Group gap={4} component="span">
                    <IconClockExclamation size={14} aria-hidden /> Overdue
                  </Group>
                }
                value={checks.overdue}
                href="/checks?view=overdue"
                alert
              />
              <Figure label="My work" value={checks.mine} href="/checks?view=mine" />
            </SimpleGrid>
          </Section>
          <Section title="Needs attention">
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
              <Figure label="Awaiting review" value={checks.awaitingReview} href="/checks?view=review" />
              <Figure
                label="Failed checks (7 days)"
                value={checks.failedRecently}
                href={recent('failed=true', 'Failed in the last 7 days')}
                alert
              />
              <Figure
                label="Raised Defects (7 days)"
                value={checks.raisedDefectsRecently}
                href={recent('withDefects=true', 'Raised Defects in the last 7 days')}
                alert
              />
              {plant && (
                <>
                  <Figure label="Pending Reception" value={plant.pendingReception} href="/plant?status=pending_reception" />
                  <Figure label="Reception awaiting approval" value={plant.awaitingApproval} href="/plant?status=awaiting_approval" />
                </>
              )}
            </SimpleGrid>
          </Section>
        </SimpleGrid>
      )}
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {plant && (
          <Section title="Plant">
            <SimpleGrid cols={2} spacing="sm">
              <Figure label="Approved/Online" value={plant.online} href="/plant?status=approved" />
              <Figure label="Restricted/Offline" value={plant.offline} href="/plant?status=restricted" alert />
            </SimpleGrid>
          </Section>
        )}
        {defects && (
          <Section title="Open Defects">
            <SimpleGrid cols={3} spacing="sm">
              <Figure
                label={
                  <Group gap={4} component="span">
                    <IconAlertTriangle size={14} aria-hidden /> Critical
                  </Group>
                }
                value={defects.critical}
                href="/defects?status=active&severity=critical"
                alert
              />
              <Figure label="Major" value={defects.major} href="/defects?status=active&severity=major" />
              <Figure label="Minor" value={defects.minor} href="/defects?status=active&severity=minor" />
            </SimpleGrid>
            {defects.assignedToMe > 0 && (
              <Anchor component={Link} href="/defects?mine=true" size="sm" mt="sm" display="block">
                {defects.assignedToMe} assigned to you
              </Anchor>
            )}
          </Section>
        )}
        {documents && (
          <Section title="Mandatory documents">
            <SimpleGrid cols={3} spacing="sm">
              <Figure label="Plant not valid" value={documents.plantNotValid} href="/plant?compliance=non_compliant" alert />
              <Figure label="Expired" value={documents.expired} href="/documents?state=expired" alert />
              <Figure label="Expiring soon" value={documents.approachingExpiry} href="/documents?state=approaching_expiry" />
            </SimpleGrid>
          </Section>
        )}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {checks && (
          <Section title="Recently completed checks">
            {data.recentlyCompleted.length === 0 ? (
              <Text size="sm" c="dimmed">
                No completed checks yet.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={600}>
                <Table verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Plant</Table.Th>
                      <Table.Th>Check</Table.Th>
                      <Table.Th>Completed</Table.Th>
                      <Table.Th>Result</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.recentlyCompleted.map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>
                          <Anchor component={Link} href={`/plant/${item.plant.id}`} size="sm" fw={600}>
                            {item.plant.assetId}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Anchor component={Link} href={`/checks/${item.id}`} size="sm">
                            {item.template}
                          </Anchor>
                          <Text size="xs" c="dimmed">
                            {TEMPLATE_PURPOSE_LABELS[item.purpose]}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{item.completedBy}</Text>
                          <Text size="xs" c="dimmed">
                            {formatDateTime(item.completedAt, tz)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          {item.failures > 0 ? (
                            <Pill tone="danger">Failed ({item.failures})</Pill>
                          ) : (
                            <Pill tone="success">Passed</Pill>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Section>
        )}
        {plant && (
          <Section title="Recent plant status changes">
            {data.statusChanges.length === 0 ? (
              <Text size="sm" c="dimmed">
                No status changes yet.
              </Text>
            ) : (
              <Stack gap={8}>
                {data.statusChanges.map((change, index) => (
                  <Box key={index}>
                    <Group gap={6}>
                      <Anchor component={Link} href={`/plant/${change.plant.id}?tab=history`} size="sm" fw={600}>
                        {change.plant.assetId}
                      </Anchor>
                      <Text size="sm" fw={500}>
                        {auditActionLabel(change.action)}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {formatDateTime(change.at, tz)}
                      {change.by ? ` · ${change.by}` : ''} — {change.summary}
                    </Text>
                  </Box>
                ))}
              </Stack>
            )}
          </Section>
        )}
      </SimpleGrid>
    </Stack>
  );
}
