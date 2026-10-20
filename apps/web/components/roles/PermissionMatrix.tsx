'use client';

import {
  Badge,
  Checkbox,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  PERMISSION_AREAS,
  PERMISSIONS,
  type PermissionCode,
  PRIVILEGED_PERMISSIONS,
} from '@corecheck/shared';

/**
 * The permission catalogue grouped by area (FRD Appendix C). Read-only for
 * standard roles; editable for custom ones.
 */
export function PermissionMatrix({
  value,
  onChange,
  readOnly,
}: {
  value: PermissionCode[];
  onChange?: (next: PermissionCode[]) => void;
  readOnly?: boolean;
}) {
  const selected = new Set(value);
  const toggle = (codes: PermissionCode[], on: boolean) => {
    const next = new Set(selected);
    for (const code of codes) {
      if (on) next.add(code);
      else next.delete(code);
    }
    onChange?.([...next]);
  };

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      {PERMISSION_AREAS.map((area) => {
        const permissions = PERMISSIONS.filter(
          (permission) => permission.area === area.key,
        );
        const codes = permissions.map(
          (permission) => permission.code,
        ) as PermissionCode[];
        const held = codes.filter((code) => selected.has(code)).length;
        return (
          <Paper key={area.key} withBorder p="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Title order={5}>{area.label}</Title>
                {readOnly ? (
                  <Text size="xs" c="dimmed">
                    {held} of {codes.length}
                  </Text>
                ) : (
                  <Checkbox
                    size="xs"
                    label="All"
                    checked={held === codes.length}
                    indeterminate={held > 0 && held < codes.length}
                    onChange={(event) =>
                      toggle(codes, event.currentTarget.checked)
                    }
                  />
                )}
              </Group>
              {permissions.map((permission) => (
                <Checkbox
                  key={permission.code}
                  checked={selected.has(permission.code)}
                  disabled={readOnly}
                  onChange={(event) =>
                    toggle([permission.code], event.currentTarget.checked)
                  }
                  label={
                    <Group gap={6}>
                      <span>{permission.label}</span>
                      {PRIVILEGED_PERMISSIONS.includes(permission.code) && (
                        <Badge size="xs" variant="light" color="orange">
                          Privileged
                        </Badge>
                      )}
                    </Group>
                  }
                />
              ))}
            </Stack>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
