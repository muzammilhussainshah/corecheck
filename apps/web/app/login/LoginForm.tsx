'use client';

import { Alert, Button, Stack, Text, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { IconInfoCircle, IconLock } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type ApiError,
  customerLoginSchema,
  ERROR_CODES,
} from '@corecheck/shared';
import { AuthLayout, CodeInput, COLORS } from '@corecheck/ui';
import { useLoginMutation } from '../../lib/api';

/** Why the user is back on this page, from ?reason=. */
const REASONS: Record<string, string> = {
  [ERROR_CODES.SESSION_EXPIRED]: 'Your session expired. Please sign in again.',
  [ERROR_CODES.SESSION_REPLACED]:
    'You were signed out because your account signed in on another device.',
  [ERROR_CODES.SESSION_REVOKED]: 'Your session ended. Please sign in again.',
  [ERROR_CODES.ACCOUNT_LOCKED]:
    'Your account is locked. Contact your administrator.',
  [ERROR_CODES.ACCOUNT_INACTIVE]:
    'Your account has been deactivated. Contact your administrator.',
  [ERROR_CODES.ORG_SUSPENDED]:
    "Your organisation's CoreCheck account is suspended. Please contact the CoreCheck team.",
  SIGNED_OUT: 'You have signed out.',
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, { isLoading }] = useLoginMutation();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [pinFocus, setPinFocus] = useState(0);
  const reason = params.get('reason');
  const [waking, setWaking] = useState(false);

  // Wake the API while the user types; if it is slow to answer, say so.
  useEffect(() => {
    let done = false;
    const slow = setTimeout(() => !done && setWaking(true), 3000);
    fetch('/api/health')
      .catch(() => undefined)
      .finally(() => {
        done = true;
        clearTimeout(slow);
        setWaking(false);
      });
    return () => clearTimeout(slow);
  }, []);

  const form = useForm({
    initialValues: { username: '', pin: '' },
    validate: schemaResolver(customerLoginSchema, { sync: true }),
  });

  const submit = form.onSubmit(async (values) => {
    setFailure(null);
    const result = await login(values);
    if (result.error) {
      setFailure(result.error as ApiError);
      form.setFieldValue('pin', '');
      setPinFocus((n) => n + 1);
      return;
    }
    // Every sign-in starts on the Dashboard.
    router.replace(result.data.me.mustChangePin ? '/change-pin' : '/');
  });

  const remaining = failure?.details?.remainingAttempts as number | undefined;

  return (
    <AuthLayout
      title="Welcome Back!"
      description="Enter your username and PIN to sign in to CoreCheck."
    >
      <Stack gap="lg">
        {waking && !failure && (
          <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
            Connecting to CoreCheck. The server is starting up, which can take
            up to a minute.
          </Alert>
        )}
        {reason && REASONS[reason] && !failure && (
          <Alert color="blue" icon={<IconInfoCircle size={18} />}>
            {REASONS[reason]}
          </Alert>
        )}
        {failure && (
          <Alert color="red" icon={<IconLock size={18} />} role="alert">
            {failure.message}
            {remaining !== undefined && remaining > 0 && (
              <Text size="sm" mt={4}>
                {remaining} {remaining === 1 ? 'attempt' : 'attempts'} left
                before your account is locked.
              </Text>
            )}
          </Alert>
        )}

        <form onSubmit={submit} noValidate>
          <Stack gap="md">
            <TextInput
              label="Username"
              placeholder="Enter your username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              {...form.getInputProps('username')}
            />
            <CodeInput
              label="PIN"
              secret
              focusKey={pinFocus}
              {...form.getInputProps('pin')}
            />
            <Button type="submit" loading={isLoading} fullWidth>
              Sign in
            </Button>
          </Stack>
        </form>
        <Text size="sm" c={COLORS.muted} ta="center">
          Forgotten your PIN or locked out? Ask your administrator or manager to
          reset it.
        </Text>
      </Stack>
    </AuthLayout>
  );
}
