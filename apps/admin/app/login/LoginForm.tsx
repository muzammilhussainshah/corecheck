'use client';

import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { IconInfoCircle, IconLock } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  ERROR_CODES,
  staffLoginSchema,
} from '@corecheck/shared';
import { AuthCard } from '../../components/AuthCard';
import { useLoginMutation } from '../../lib/api';

const REASONS: Record<string, string> = {
  [ERROR_CODES.SESSION_EXPIRED]: 'Your session expired. Please sign in again.',
  [ERROR_CODES.SESSION_REVOKED]: 'Your session ended. Please sign in again.',
  SIGNED_OUT: 'You have signed out.',
};

export function LoginForm() {
  const router = useRouter();
  const [login, { isLoading }] = useLoginMutation();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const reason = useSearchParams().get('reason');
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: schemaResolver(staffLoginSchema, { sync: true }),
  });

  const submit = form.onSubmit(async (values) => {
    setFailure(null);
    const result = await login(values);
    if (result.error) {
      setFailure(result.error as ApiError);
      form.setFieldValue('password', '');
      return;
    }
    const { next, staff } = result.data;
    if (next !== 'done') router.replace('/mfa');
    else
      router.replace(
        staff.mustChangePassword ? '/change-password' : '/organisations',
      );
  });

  return (
    <AuthCard
      title="Sign in"
      description="Internal access for CoreCheck staff only."
    >
      {reason && REASONS[reason] && !failure && (
        <Alert color="blue" icon={<IconInfoCircle size={18} />}>
          {REASONS[reason]}
        </Alert>
      )}
      {failure && (
        <Alert color="red" icon={<IconLock size={18} />} role="alert">
          {failure.message}
        </Alert>
      )}
      <form onSubmit={submit} noValidate>
        <Stack>
          <TextInput
            label="Email"
            placeholder="Enter your email"
            type="email"
            autoComplete="username"
            required
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Password"
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            {...form.getInputProps('password')}
          />
          <Button type="submit" loading={isLoading} fullWidth>
            Continue
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
