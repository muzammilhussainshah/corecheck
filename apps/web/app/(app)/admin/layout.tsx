'use client';

import { Box, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { COLORS } from '@corecheck/ui';
import { ADMIN_NAV } from '../../../lib/navigation';
import { useSession } from '../../../lib/session';

/**
 * Manage, as on CoreStock: one page with the sections in a rail on the left
 * and the chosen section beside it. Detail and add pages (a user, a role, a
 * new user) take the full width with a breadcrumb instead.
 */
export default function ManageLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { canAny } = useSession();
  const sections = ADMIN_NAV.filter(
    (item) => !item.anyOf || canAny(...item.anyOf),
  );
  const onSection = sections.some((item) => item.href === pathname);
  if (!onSection) return <>{children}</>;

  return (
    <Stack gap="lg">
      <Box>
        <Title order={2} fz={{ base: 22, sm: 24 }} c={COLORS.title}>
          Manage
        </Title>
        <Text fz="sm" fw={500} c={COLORS.muted} mt={4}>
          Configure your CoreCheck workspace: users, roles, sites, teams,
          disciplines and the security audit.
        </Text>
      </Box>
      <Paper
        withBorder
        shadow="sm"
        p={{ base: 'sm', md: 'md' }}
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          borderColor: COLORS.border,
          // Fill the screen below the header and title on every section, so
          // the card keeps one size whether a list is long, short or loading.
          minHeight: 'calc(100vh - 230px)',
        }}
      >
        <style>{`@media (max-width: 62em) { .cc-manage-rail { flex-direction: row !important; flex: 1 1 100% !important; overflow-x: auto; } .cc-manage-rail a { white-space: nowrap; flex: 0 0 auto; } }`}</style>
        <Box
          component="nav"
          aria-label="Manage sections"
          className="cc-manage-rail"
          p="sm"
          style={{
            flex: '0 0 210px',
            maxWidth: '100%',
            alignSelf: 'flex-start',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            backgroundColor: COLORS.panel,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {sections.map((item) => {
            const active = item.href === pathname;
            return (
              <UnstyledButton
                key={item.href}
                component={Link}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                px="sm"
                py={10}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderRadius: 10,
                  fontWeight: 500,
                  fontSize: 15,
                  color: active ? 'white' : COLORS.muted,
                  backgroundColor: active
                    ? 'var(--mantine-color-brand-6)'
                    : 'transparent',
                }}
              >
                <item.icon size={18} stroke={1.8} />
                {item.label}
              </UnstyledButton>
            );
          })}
        </Box>
        {/* A column that fills the card's height, so a section's table can
            stretch to the bottom whatever its row count. */}
        <Box
          style={{
            flex: '1 1 600px',
            minWidth: 0,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </Box>
      </Paper>
    </Stack>
  );
}
