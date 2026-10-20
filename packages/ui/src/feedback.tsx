import { Alert, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import type { ApiError } from '@corecheck/shared';

/**
 * Toasts exactly as on CoreStock: react-toastify's light theme, top right,
 * a coloured icon and progress bar on white, closing after three seconds.
 * Only the font and the corner clipping are adjusted.
 */
const TOAST_CSS = `
:root {
  --toastify-font-family: inherit;
  --toastify-toast-bd-radius: 8px;
}
/* The toast clips its own progress bar so the bar follows the rounded
   corners instead of poking past them. */
.Toastify__toast { overflow: hidden; font-size: 15px; }
`;

/** Mount once near the root of each app. */
export const Toaster = () => (
  <>
    <style>{TOAST_CSS}</style>
    <ToastContainer
      position="top-right"
      autoClose={3000}
      newestOnTop
      closeOnClick
      pauseOnHover
      pauseOnFocusLoss
      draggable
      theme="light"
    />
  </>
);

export const notifySuccess = (message: string): void => {
  toast.success(message);
};

export const notifyInfo = (message: string): void => {
  toast.info(message);
};

// The reference helps support trace a server fault; expected refusals
// (wrong PIN, no permission) read better without it.
const errorText = (error: ApiError): string =>
  error.requestId && (error.statusCode >= 500 || error.statusCode === 0)
    ? `${error.message} (Reference ${error.requestId.slice(0, 8)})`
    : error.message;

export const notifyError = (error: ApiError): void => {
  // One toast per message: a retried action does not stack duplicates.
  toast.error(errorText(error), { toastId: `error:${errorText(error)}` });
};

/**
 * Shows field errors next to their inputs (VAL-002). The toast for the failure
 * comes from actionToasts. Field names follow the API's dotted paths.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const showApiErrors = (
  form: UseFormReturnType<any>,
  error: ApiError,
): void => {
  if (!error.fieldErrors?.length) return;
  form.setErrors(
    Object.fromEntries(
      error.fieldErrors.map((item) => [item.field, item.message]),
    ),
  );
};

export const ErrorAlert = ({
  error,
  title = 'Could not load this',
}: {
  error: ApiError;
  title?: string;
}) => (
  <Alert color="red" icon={<IconAlertTriangle size={18} />} title={title}>
    {error.message}
    {error.requestId && (
      <Text size="xs" c="dimmed" mt={4}>
        Reference {error.requestId.slice(0, 8)}
      </Text>
    )}
  </Alert>
);

/** Explains why a list is empty and offers the next step (LST-005). */
export const EmptyState = ({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) => (
  <Stack align="center" gap="xs" py="xl">
    <ThemeIcon variant="light" size={48} radius="xl" color="gray">
      <IconInbox size={26} />
    </ThemeIcon>
    <Title order={4} ta="center">
      {title}
    </Title>
    {message && (
      <Text c="dimmed" ta="center" maw={420}>
        {message}
      </Text>
    )}
    {action}
  </Stack>
);

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export const confirmAction = ({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
}: ConfirmOptions): void => {
  modals.openConfirmModal({
    title,
    children:
      typeof message === 'string' ? <Text size="sm">{message}</Text> : message,
    labels: { confirm: confirmLabel, cancel: 'Cancel' },
    confirmProps: { color: danger ? 'red' : undefined },
    onConfirm: () => void onConfirm(),
  });
};
