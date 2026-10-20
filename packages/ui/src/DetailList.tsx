import { Box, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export interface DetailItem {
  label: string;
  value: ReactNode;
}

/**
 * Read-only label/value pairs, labels in a fixed column so every details
 * panel lines up the same way. Stacks on narrow screens.
 */
export const DetailList = ({
  items,
  labelWidth = 170,
}: {
  items: DetailItem[];
  labelWidth?: number;
}) => (
  <Box
    component="dl"
    m={0}
    style={{
      display: 'grid',
      gridTemplateColumns: `minmax(110px, ${labelWidth}px) minmax(0, 1fr)`,
      columnGap: 'var(--mantine-spacing-md)',
      rowGap: 'var(--mantine-spacing-sm)',
    }}
  >
    {items.map((item) => (
      <Box key={item.label} style={{ display: 'contents' }}>
        <Text component="dt" size="sm" c="dimmed">
          {item.label}
        </Text>
        <Text
          component="dd"
          size="sm"
          m={0}
          style={{ overflowWrap: 'anywhere' }}
        >
          {item.value}
        </Text>
      </Box>
    ))}
  </Box>
);
