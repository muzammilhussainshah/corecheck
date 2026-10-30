'use client';

import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Input,
  List,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { schemaResolver, useForm } from '@mantine/form';
import { IconAlertTriangle, IconCalendar } from '@tabler/icons-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  type ApiError,
  createPlantSchema,
  type CustomField,
  type CustomValue,
  type PlantDetail,
  type PlantDuplicates,
  type PlantOwnership,
  type PlantSaved,
  updatePlantSchema,
} from '@corecheck/shared';
import { COLORS, showApiErrors } from '@corecheck/ui';
import {
  useCreatePlantMutation,
  useLazyPlantDuplicatesQuery,
  useUpdatePlantMutation,
} from '../../lib/api';
import { usePlantOptions } from '../../lib/plant-options';
import { useSession } from '../../lib/session';

export interface PlantFormValues {
  assetId: string;
  plantNumber: string;
  serialNumber: string;
  name: string;
  plantTypeId: string;
  categoryId: string;
  make: string;
  model: string;
  ownership: PlantOwnership | '';
  companyId: string;
  siteId: string;
  areaId: string;
  disciplineIds: string[];
  customValues: Record<string, CustomValue | ''>;
}

const valuesOf = (plant?: PlantDetail): PlantFormValues => ({
  assetId: plant?.assetId ?? '',
  plantNumber: plant?.plantNumber ?? '',
  serialNumber: plant?.serialNumber ?? '',
  name: plant?.name ?? '',
  plantTypeId: plant?.plantType.id ?? '',
  categoryId: plant?.category?.id ?? '',
  make: plant?.make ?? '',
  model: plant?.model ?? '',
  ownership: plant?.ownership ?? '',
  companyId: plant?.company.id ?? '',
  siteId: plant?.site.id ?? '',
  areaId: plant?.area?.id ?? '',
  disciplineIds: plant?.disciplines.map((item) => item.id) ?? [],
  customValues: plant?.customValues ?? {},
});

/** Blank custom values are left out rather than saved as empty text. */
const filledCustomValues = (values: PlantFormValues['customValues']) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== ''),
  ) as Record<string, CustomValue>;

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <Box
    p="md"
    style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16,
      backgroundColor: COLORS.panel,
    }}
  >
    <Title order={4} fz={16} c={COLORS.title}>
      {title}
    </Title>
    {description && (
      <Text size="sm" c={COLORS.muted} mt={2}>
        {description}
      </Text>
    )}
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="md">
      {children}
    </SimpleGrid>
  </Box>
);

/** Plant sharing a Plant or Serial Number: a warning, never a block (PLT-004). */
export const DuplicateWarning = ({
  duplicates,
}: {
  duplicates: PlantDuplicates | undefined;
}) => {
  if (!duplicates) return null;
  const matches = [...duplicates.plantNumber, ...duplicates.serialNumber];
  const unique = matches.filter(
    (plant, index) => matches.findIndex((m) => m.id === plant.id) === index,
  );
  if (unique.length === 0 && duplicates.outsideScope === 0) return null;
  return (
    <Alert
      color="yellow"
      icon={<IconAlertTriangle size={18} />}
      title="Possible duplicate"
    >
      <Text size="sm">
        Plant with the same Plant Number or Serial Number already exists. Check
        it is not the same item before saving; a separate plant needs its own
        System Asset ID.
      </Text>
      {unique.length > 0 && (
        <List size="sm" mt="xs">
          {unique.map((plant) => (
            <List.Item key={plant.id}>
              <Anchor
                component={Link}
                href={`/plant/${plant.id}`}
                target="_blank"
              >
                {plant.assetId}
              </Anchor>{' '}
              · {plant.name} · {plant.site.name}
            </List.Item>
          ))}
        </List>
      )}
      {duplicates.outsideScope > 0 && (
        <Text size="sm" mt="xs">
          {duplicates.outsideScope} more at sites you are not assigned to.
        </Text>
      )}
    </Alert>
  );
};

/** One input for a custom field, by its type (PLT-008). */
const CustomFieldInput = ({
  field,
  inputProps,
}: {
  field: CustomField;
  inputProps: ReturnType<
    ReturnType<typeof useForm<PlantFormValues>>['getInputProps']
  >;
}) => {
  const common = {
    label: field.label,
    required: field.required,
    error: inputProps.error,
  };
  // A field added after the plant was saved has no value yet.
  const value = (inputProps.value as CustomValue | undefined) ?? '';
  switch (field.fieldType) {
    case 'number':
      return <NumberInput {...common} {...inputProps} value={value} />;
    case 'date':
      return (
        <DateInput
          {...common}
          valueFormat="D MMM YYYY"
          leftSection={<IconCalendar size={16} />}
          clearable
          value={(inputProps.value as string) || null}
          onChange={(value) => inputProps.onChange(value ?? '')}
        />
      );
    case 'select':
      return (
        <Select
          {...common}
          data={field.options}
          clearable={!field.required}
          value={(inputProps.value as string) || null}
          onChange={(value) => inputProps.onChange(value ?? '')}
        />
      );
    default:
      return <TextInput {...common} {...inputProps} value={value} />;
  }
};

/**
 * Registering or editing plant (FRD 7.1). The fields the FRD requires for
 * initial registration are marked; everything else can be added later
 * (PLT-007). Possible duplicates are checked as Plant and Serial Numbers are
 * entered.
 */
export function PlantForm({
  plant,
  onSaved,
  onCancel,
}: {
  plant?: PlantDetail;
  onSaved: (saved: PlantSaved) => void;
  onCancel: () => void;
}) {
  const { me } = useSession();
  const editing = !!plant;
  const [createPlant, creating] = useCreatePlantMutation();
  const [updatePlant, updating] = useUpdatePlantMutation();
  const [checkDuplicates, duplicates] = useLazyPlantDuplicatesQuery();
  const form = useForm<PlantFormValues>({
    initialValues: valuesOf(plant),
    validate: schemaResolver(editing ? updatePlantSchema : createPlantSchema, {
      sync: true,
    }),
  });
  const options = usePlantOptions(
    {
      plantTypeId: plant?.plantType.id,
      categoryId: plant?.category?.id,
      companyId: plant?.company.id,
      siteId: plant?.site.id,
      areaId: plant?.area?.id,
      disciplineIds: plant?.disciplines.map((item) => item.id),
    },
    form.values.ownership,
    form.values.siteId,
  );
  const lockIdentifiers = editing && !plant.capabilities.editIdentifiers;

  /** A select bound to a form id: blank shows as "nothing chosen". */
  const selectProps = (
    key: 'plantTypeId' | 'categoryId' | 'companyId' | 'siteId' | 'areaId',
  ) => ({
    ...form.getInputProps(key),
    value: form.values[key] || null,
    onChange: (value: string | null) => form.setFieldValue(key, value ?? ''),
  });

  const lookForDuplicates = () => {
    const { plantNumber, serialNumber } = form.getValues();
    if (!plantNumber.trim() && !serialNumber.trim()) return;
    void checkDuplicates({
      plantNumber: plantNumber.trim() || undefined,
      serialNumber: serialNumber.trim() || undefined,
      excludeId: plant?.id,
    });
  };

  const submit = form.onSubmit(async (values) => {
    const body = {
      ...values,
      ownership: values.ownership as PlantOwnership,
      customValues: filledCustomValues(values.customValues),
    };
    const result = editing
      ? await updatePlant({ id: plant.id, ...body })
      : await createPlant(body);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    onSaved(result.data);
  });

  return (
    <Paper withBorder shadow="sm" p="lg">
      <form onSubmit={submit} noValidate>
        <Stack gap="lg">
          <Section
            title="Identity"
            description="System Asset ID is the one unique identifier. Leave it blank to have one generated."
          >
            <TextInput
              label="Equipment name"
              placeholder="e.g. 20t tracked excavator"
              required
              {...form.getInputProps('name')}
            />
            <TextInput
              label="System Asset ID"
              placeholder={editing ? undefined : 'Generated if left blank'}
              required={editing}
              disabled={lockIdentifiers}
              description={
                lockIdentifiers
                  ? 'Changing it needs the Manage identifiers permission.'
                  : undefined
              }
              {...form.getInputProps('assetId')}
            />
            <TextInput
              label="Plant Number"
              placeholder="Fleet or plant number"
              {...form.getInputProps('plantNumber')}
              onBlur={lookForDuplicates}
            />
            <TextInput
              label="Serial Number"
              {...form.getInputProps('serialNumber')}
              onBlur={lookForDuplicates}
            />
          </Section>
          <DuplicateWarning duplicates={duplicates.data} />

          <Section title="Classification">
            <Select
              label="Plant type"
              placeholder="Select type"
              required
              searchable
              data={options.types}
              nothingFoundMessage="Add plant types under Manage › Plant types"
              {...selectProps('plantTypeId')}
            />
            <Select
              label="Category"
              placeholder="Optional"
              searchable
              clearable
              data={options.categories}
              {...selectProps('categoryId')}
              onChange={(value) =>
                form.setFieldValue('categoryId', value ?? '')
              }
            />
            <TextInput label="Make" {...form.getInputProps('make')} />
            <TextInput label="Model" {...form.getInputProps('model')} />
            <MultiSelect
              label="Disciplines"
              placeholder="Optional"
              searchable
              data={options.disciplines}
              {...form.getInputProps('disciplineIds')}
            />
          </Section>

          <Section title="Ownership">
            <Input.Wrapper
              label="Ownership"
              required
              error={form.errors.ownership}
            >
              <SegmentedControl
                fullWidth
                data={[
                  { value: 'owned', label: 'Owned' },
                  { value: 'hired', label: 'Hired' },
                ]}
                value={form.values.ownership || ''}
                onChange={(value) => {
                  form.setFieldValue('ownership', value as PlantOwnership);
                  // An owner cannot be a hire company, and the other way round.
                  form.setFieldValue('companyId', '');
                }}
              />
            </Input.Wrapper>
            <Select
              label={
                form.values.ownership === 'owned'
                  ? 'Owner'
                  : form.values.ownership === 'hired'
                    ? 'Hire company'
                    : 'Owner or hire company'
              }
              placeholder={
                form.values.ownership
                  ? 'Select company'
                  : 'Choose ownership first'
              }
              required
              searchable
              disabled={!form.values.ownership}
              data={options.companies}
              nothingFoundMessage="Add companies under Manage › Companies"
              {...selectProps('companyId')}
            />
          </Section>

          <Section title="Location">
            <Select
              label="Site"
              placeholder="Select site"
              required
              searchable
              disabled={lockIdentifiers}
              description={
                lockIdentifiers
                  ? 'Moving plant needs the Manage identifiers permission.'
                  : me?.scope.orgWide
                    ? undefined
                    : 'Only your own sites are listed.'
              }
              data={options.sites}
              {...selectProps('siteId')}
              onChange={(value) => {
                form.setFieldValue('siteId', value ?? '');
                form.setFieldValue('areaId', '');
              }}
            />
            <Select
              label="Area / location"
              placeholder={
                form.values.siteId ? 'Optional' : 'Choose a site first'
              }
              searchable
              clearable
              disabled={!form.values.siteId}
              data={options.areas}
              {...selectProps('areaId')}
              onChange={(value) => form.setFieldValue('areaId', value ?? '')}
            />
          </Section>

          {options.customFields.length > 0 && (
            <Section title="Additional details">
              {options.customFields.map((field) => (
                <CustomFieldInput
                  key={field.id}
                  field={field}
                  inputProps={form.getInputProps(`customValues.${field.id}`)}
                />
              ))}
            </Section>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={creating.isLoading || updating.isLoading}
            >
              {editing ? 'Save changes' : 'Register plant'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
