import { Card, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconClockHour4 } from '@tabler/icons-react';
import { COLORS } from '@corecheck/ui';

/** Placeholder for workspace areas delivered in later releases. */
export function ComingSoon({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <Card withBorder shadow="xs" p="xl" maw={680}>
      <Stack gap="sm" align="flex-start">
        <ThemeIcon variant="light" size={48} radius="md">
          <IconClockHour4 size={26} />
        </ThemeIcon>
        <Title order={2} fz={24} c={COLORS.title}>
          {title}
        </Title>
        <Text c={COLORS.muted} fw={500}>
          {summary}
        </Text>
        <Text size="sm" c={COLORS.body}>
          This area is coming in an upcoming CoreCheck release.
        </Text>
      </Stack>
    </Card>
  );
}
