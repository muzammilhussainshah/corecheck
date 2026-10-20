'use client';

import { Button, PasswordInput, Stack } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { z } from 'zod';
import {
  type ApiError,
  changeStaffPasswordSchema,
  STAFF_PASSWORD_MIN_LENGTH,
  type StaffMe,
} from '@corecheck/shared';
import { showApiErrors } from '@corecheck/ui';
import { useChangePasswordMutation } from '../lib/api';

const formSchema = changeStaffPasswordSchema
  .and(z.object({ confirmPassword: z.string() }))
  .refine((values) => values.confirmPassword === values.newPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords do not match.',
  });

export function ChangePasswordForm({
  onChanged,
}: {
  onChanged: (staff: StaffMe) => void;
}) {
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const form = useForm({
    initialValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    validate: schemaResolver(formSchema, { sync: true }),
  });
  const submit = form.onSubmit(async ({ currentPassword, newPassword }) => {
    const result = await changePassword({ currentPassword, newPassword });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onChanged(result.data);
  });
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          required
          {...form.getInputProps('currentPassword')}
        />
        <PasswordInput
          label="New password"
          description={`At least ${STAFF_PASSWORD_MIN_LENGTH} characters. A passphrase of several words works well.`}
          autoComplete="new-password"
          required
          {...form.getInputProps('newPassword')}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          {...form.getInputProps('confirmPassword')}
        />
        <Button type="submit" loading={isLoading}>
          Change password
        </Button>
      </Stack>
    </form>
  );
}
