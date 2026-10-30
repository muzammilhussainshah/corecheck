import {
  Accordion,
  Box,
  Button,
  CloseButton,
  Drawer,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconFilter, IconSearch, IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { COLORS } from './theme';

/**
 * The white card a register lives in: toolbar on top (search left, filters
 * right), then the table and its pagination.
 */
export const TableCard = ({
  toolbar,
  children,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
}) => (
  <Paper
    withBorder
    radius="lg"
    shadow="xs"
    // Grows to fill a column layout (Manage), so short lists keep the
    // same footprint as long ones.
    style={{
      borderColor: COLORS.borderStrong,
      overflow: 'hidden',
      flex: '1 0 auto',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    {toolbar && (
      <Group
        justify="space-between"
        wrap="wrap"
        gap="sm"
        p="md"
        style={{ borderBottom: `1px solid ${COLORS.borderStrong}` }}
      >
        {toolbar}
      </Group>
    )}
    {children}
  </Paper>
);

export const SearchInput = ({
  value,
  onChange,
  placeholder = 'Search',
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
}) => (
  <TextInput
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    placeholder={placeholder}
    aria-label={label ?? placeholder}
    leftSection={<IconSearch size={16} color={COLORS.muted} />}
    rightSection={
      value ? (
        <CloseButton
          size="sm"
          aria-label="Clear search"
          onClick={() => onChange('')}
        />
      ) : null
    }
    w={{ base: '100%', xs: 300 }}
  />
);

const CountBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <Box
      component="span"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 999,
        backgroundColor: 'var(--mantine-color-brand-7)',
        color: 'white',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {count}
    </Box>
  ) : null;

/**
 * "Filters" pill as on CoreStock: opens the side panel, shows how many
 * filters are applied, and a cross clears them all.
 */
export const FilterButton = ({
  count,
  onOpen,
  onClear,
}: {
  count: number;
  onOpen: () => void;
  onClear: () => void;
}) => {
  const active = count > 0;
  return (
    <Group
      gap={0}
      wrap="nowrap"
      style={{
        height: 38,
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${active ? 'var(--mantine-color-brand-5)' : COLORS.borderStrong}`,
        backgroundColor: active ? 'var(--mantine-color-brand-0)' : 'white',
      }}
    >
      <UnstyledButton
        onClick={onOpen}
        px="md"
        h="100%"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 600,
          fontSize: 14,
          color: active ? 'var(--mantine-color-brand-8)' : '#111827',
        }}
      >
        <IconFilter size={16} />
        Filters
        <CountBadge count={count} />
      </UnstyledButton>
      {active && (
        <UnstyledButton
          onClick={onClear}
          aria-label="Clear all filters"
          h="100%"
          px={10}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderLeft: '1px solid var(--mantine-color-brand-2)',
            color: 'var(--mantine-color-brand-8)',
          }}
        >
          <IconX size={15} />
        </UnstyledButton>
      )}
    </Group>
  );
};

export interface FilterSection {
  key: string;
  label: string;
  /** Values chosen in this section, for its badge. */
  count: number;
  content: ReactNode;
}

/**
 * The right-hand filter panel: one collapsible section per filter, Apply and
 * Clear all at the foot. Sections with a value start open.
 */
export const FilterPanel = ({
  opened,
  onClose,
  sections,
  onApply,
  onClear,
}: {
  opened: boolean;
  onClose: () => void;
  sections: FilterSection[];
  onApply: () => void;
  onClear: () => void;
}) => {
  const selected = sections.reduce((sum, section) => sum + section.count, 0);
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={400}
      padding={0}
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.05 }}
      styles={{
        body: { height: '100%', display: 'flex', flexDirection: 'column' },
      }}
    >
      <Group
        justify="space-between"
        px="lg"
        py="md"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <Group gap={8}>
          <Text fz="xl" fw={600} c={COLORS.title}>
            Filters
          </Text>
          <CountBadge count={selected} />
        </Group>
        <CloseButton onClick={onClose} aria-label="Close filters" />
      </Group>
      <Box style={{ flex: 1, overflowY: 'auto' }} px="lg" py="sm">
        <Accordion
          multiple
          defaultValue={sections
            .filter((section) => section.count > 0)
            .map((section) => section.key)}
          chevronPosition="right"
          styles={{
            item: { borderBottom: `1px solid ${COLORS.border}` },
            control: { paddingInline: 0 },
            content: { paddingInline: 0 },
          }}
        >
          {sections.map((section) => (
            <Accordion.Item key={section.key} value={section.key}>
              <Accordion.Control>
                <Group gap={8}>
                  <Text fw={600} c="#111827">
                    {section.label}
                  </Text>
                  <CountBadge count={section.count} />
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">{section.content}</Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Box>
      <Group
        grow
        px="lg"
        py="md"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        <Button variant="default" onClick={onClear}>
          Clear all
        </Button>
        <Button onClick={onApply}>Apply filters</Button>
      </Group>
    </Drawer>
  );
};

/** Small number card above a register; clicking it filters the list. */
export const StatCard = ({
  label,
  value,
  icon,
  selected,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) => (
  <UnstyledButton
    onClick={onClick}
    aria-pressed={onClick ? !!selected : undefined}
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      padding: 16,
      borderRadius: 16,
      backgroundColor: 'white',
      border: `1px solid ${selected ? 'var(--mantine-color-brand-5)' : COLORS.border}`,
      boxShadow: '0 1px 2px rgba(16, 24, 40, 0.05)',
      cursor: onClick ? 'pointer' : 'default',
      gap: 8,
      width: '100%',
    }}
  >
    <Box style={{ minWidth: 0 }}>
      <Text c={COLORS.muted} fw={500} mb={8} lh={1.3}>
        {label}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text fz={24} fw={700} c="#1E293B" lh={1.2}>
          {value}
        </Text>
      ) : (
        <Box fz={22} fw={700} c="#1E293B" lh={1.35}>
          {value}
        </Box>
      )}
    </Box>
    {icon && (
      <Box
        visibleFrom="sm"
        style={{
          flexShrink: 0,
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
        {icon}
      </Box>
    )}
  </UnstyledButton>
);
