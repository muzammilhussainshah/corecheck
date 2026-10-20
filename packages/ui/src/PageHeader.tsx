import { Anchor, Box, Group, Stack, Text, Title } from '@mantine/core';
import { IconChevronsRight } from '@tabler/icons-react';
import { Fragment, type ReactNode } from 'react';
import { COLORS } from './theme';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail, title, explanation and the page's main actions, laid out
 * as on CoreStock pages: "Dashboard » Manage » Add New" with the current page
 * in the brand colour.
 */
export const PageHeader = ({
  title,
  description,
  actions,
  crumbs,
  renderLink,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Router-aware link renderer from the host app. */
  renderLink?: (href: string, label: string) => ReactNode;
}) => (
  <Stack gap="sm" mb="lg">
    {crumbs && crumbs.length > 0 && (
      <Group gap={4} wrap="wrap" component="nav" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {crumb.href && !last ? (
                renderLink ? (
                  <Box fz="sm" fw={500}>
                    {renderLink(crumb.href, crumb.label)}
                  </Box>
                ) : (
                  <Anchor href={crumb.href} fz="sm" fw={500} c={COLORS.muted}>
                    {crumb.label}
                  </Anchor>
                )
              ) : (
                <Text
                  fz="sm"
                  fw={500}
                  c={last ? 'brand.7' : COLORS.muted}
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </Text>
              )}
              {!last && (
                <IconChevronsRight size={16} color={COLORS.muted} stroke={2} />
              )}
            </Fragment>
          );
        })}
      </Group>
    )}
    <Group justify="space-between" align="center" wrap="wrap" gap="md">
      <Stack gap={4} style={{ minWidth: 0 }}>
        <Title order={2} fz={{ base: 22, sm: 24 }} c={COLORS.title} lh={1.3}>
          {title}
        </Title>
        {description && (
          <Text fz="sm" fw={500} c={COLORS.muted} maw={760}>
            {description}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="sm" wrap="wrap">
          {actions}
        </Group>
      )}
    </Group>
  </Stack>
);
