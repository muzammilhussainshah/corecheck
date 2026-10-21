'use client';

import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Group,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPrinter,
  IconShieldLock,
} from '@tabler/icons-react';
import type { IssuedCredentials } from '@corecheck/shared';
import { formatDateTime } from './format';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Opens a plain page with just the sign-in details and prints it. */
const printCredentials = (
  name: string,
  credentials: IssuedCredentials,
  expires: string,
) => {
  const page = window.open('', '_blank', 'width=480,height=520');
  if (!page) return;
  page.document.write(`<!doctype html><title>CoreCheck sign-in details</title>
    <body style="font-family:system-ui,sans-serif;padding:32px">
      <h2>CoreCheck sign-in details</h2>
      <p>${escapeHtml(name)}</p>
      <p>Username: <strong style="font-size:20px">${escapeHtml(credentials.username)}</strong></p>
      <p>Temporary PIN: <strong style="font-size:20px;letter-spacing:4px">${escapeHtml(credentials.temporaryPin)}</strong></p>
      <p>Use it by ${escapeHtml(expires)}. You will choose your own PIN when you first sign in.</p>
    </body>`);
  page.document.close();
  page.focus();
  page.print();
};

/**
 * The username and temporary PIN, shown once to the person who created or
 * reset the account. Only the PIN's hash is stored, so it cannot be shown
 * again — a new reset is the only way to get another.
 */
export const CredentialsCard = ({
  credentials,
  personName,
  timeZone,
}: {
  credentials: IssuedCredentials;
  personName: string;
  timeZone?: string;
}) => {
  // The PIN stays masked on screen until the viewer asks to see it.
  const [pinShown, setPinShown] = useState(false);
  const expires = formatDateTime(credentials.expiresAt, timeZone);
  const rows: Array<[string, string]> = [
    ['Username', credentials.username],
    ['Temporary PIN', credentials.temporaryPin],
  ];
  return (
    <Stack gap="md">
      <Alert
        color="yellow"
        icon={<IconShieldLock size={18} />}
        title="Shown only once"
      >
        Give these details to {personName} in person or through a secure
        channel. They must choose their own PIN when they first sign in.
      </Alert>
      <Paper withBorder p="md">
        <Table withRowBorders={false}>
          <Table.Tbody>
            {rows.map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td w={150}>
                  <Text c="dimmed" size="sm">
                    {label}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Text
                      ff="monospace"
                      fw={700}
                      size="lg"
                      lts={label === 'Temporary PIN' ? 3 : undefined}
                    >
                      {label === 'Temporary PIN' && !pinShown
                        ? '●'.repeat(value.length)
                        : value}
                    </Text>
                    {label === 'Temporary PIN' && (
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={() => setPinShown((shown) => !shown)}
                        aria-label={pinShown ? 'Hide PIN' : 'Show PIN'}
                      >
                        {pinShown ? (
                          <IconEyeOff size={16} />
                        ) : (
                          <IconEye size={16} />
                        )}
                      </ActionIcon>
                    )}
                    <CopyButton value={value}>
                      {({ copied, copy }) => (
                        <Button
                          variant="subtle"
                          size="compact-sm"
                          onClick={copy}
                          leftSection={
                            copied ? (
                              <IconCheck size={14} />
                            ) : (
                              <IconCopy size={14} />
                            )
                          }
                          aria-label={`Copy ${label.toLowerCase()}`}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td>
                <Text c="dimmed" size="sm">
                  Valid until
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{expires}</Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>
      <Group>
        <Button
          variant="default"
          leftSection={<IconPrinter size={16} />}
          onClick={() => printCredentials(personName, credentials, expires)}
        >
          Print
        </Button>
      </Group>
    </Stack>
  );
};
