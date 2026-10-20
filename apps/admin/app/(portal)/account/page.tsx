'use client';

import { Card, Stack, Text, Title } from '@mantine/core';
import { STAFF_ROLE_LABELS } from '@corecheck/shared';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { ChangePasswordForm } from '../../../components/ChangePasswordForm';
import { useMeQuery } from '../../../lib/api';

export default function AccountPage() {
  const { data: me } = useMeQuery();
  if (!me) return null;
  return (
    <>
      <AppPageHeader
        title="My account"
        description={`${me.name} · ${me.email} · ${STAFF_ROLE_LABELS[me.staffRole]}`}
      />
      <Card withBorder maw={520}>
        <Stack>
          <Title order={4}>Change password</Title>
          {me.mfaEnabled && (
            <Text size="sm" c="dimmed">
              Two-factor authentication is on for your account.
            </Text>
          )}
          <ChangePasswordForm onChanged={() => undefined} />
        </Stack>
      </Card>
    </>
  );
}
