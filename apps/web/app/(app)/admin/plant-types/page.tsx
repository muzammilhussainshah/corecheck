'use client';

import {
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Stack,
  Text,
} from '@mantine/core';
import { IconFileCertificate } from '@tabler/icons-react';
import { useState } from 'react';
import type { PlantType } from '@corecheck/shared';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import { textValue } from '../../../../components/structure/StructureManager';
import { useSetRequiredDocumentsMutation } from '../../../../lib/api';
import { useConfigList } from '../../../../lib/config';
import { useSession } from '../../../../lib/session';

/** The documents every plant of a type must hold (DOC-001). */
function RequiredDocumentsModal({
  type,
  onClose,
}: {
  type: PlantType | null;
  onClose: () => void;
}) {
  // Archived types are listed too, so one already required keeps its name.
  const { data: documentTypes } = useConfigList('document-types', {
    includeArchived: true,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [save, { isLoading }] = useSetRequiredDocumentsMutation();

  // Start from the type's current requirements each time the modal opens.
  if (type && shownFor !== type.id) {
    setShownFor(type.id);
    setSelected(type.requiredDocumentTypeIds);
  }

  const options = (documentTypes ?? [])
    .filter(
      (doc) =>
        !doc.archivedAt || type?.requiredDocumentTypeIds.includes(doc.id),
    )
    .map((doc) => ({
      value: doc.id,
      label: doc.archivedAt ? `${doc.name} (archived)` : doc.name,
    }));

  const submit = async () => {
    if (!type) return;
    const result = await save({
      plantTypeId: type.id,
      documentTypeIds: selected,
    });
    if (!result.error) onClose();
  };

  return (
    <Modal
      opened={!!type}
      onClose={() => {
        setShownFor(null);
        onClose();
      }}
      title={type ? `Mandatory documents for ${type.name}` : ''}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          A plant of this type cannot be approved, and is kept
          Restricted/Offline, while any of these is missing or expired.
        </Text>
        <MultiSelect
          label="Mandatory documents"
          placeholder={selected.length ? undefined : 'None'}
          data={options}
          value={selected}
          onChange={setSelected}
          searchable
          nothingFoundMessage="Add document types under Manage › Document types"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={isLoading}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function PlantTypesPage() {
  const { can } = useSession();
  const [requirementsOf, setRequirementsOf] = useState<PlantType | null>(null);
  const { data: documentTypes } = useConfigList('document-types', {
    includeArchived: true,
  });
  const documentName = (id: string) =>
    documentTypes?.find((doc) => doc.id === id)?.name ?? '…';

  return (
    <>
      <ConfigListPage
        kind="plant-types"
        title="Plant types"
        description="Kinds of plant, such as Excavator or Generator. Each type can require documents before its plant is approved."
        noun="Plant type"
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'description', label: 'Description' },
        ]}
        toBody={(values) => ({
          name: textValue(values.name),
          description: textValue(values.description),
        })}
        extraColumns={[
          {
            key: 'description',
            header: 'Description',
            render: (type) => <Text size="sm">{type.description ?? '—'}</Text>,
          },
          {
            key: 'documents',
            header: 'Mandatory documents',
            render: (type) => (
              <Text size="sm">
                {type.requiredDocumentTypeIds.length
                  ? type.requiredDocumentTypeIds.map(documentName).join(', ')
                  : 'None'}
              </Text>
            ),
          },
        ]}
        rowActions={(type) =>
          can('documents.configure') && (
            <Menu.Item
              leftSection={<IconFileCertificate size={16} />}
              onClick={() => setRequirementsOf(type)}
            >
              Mandatory documents
            </Menu.Item>
          )
        }
      />
      <RequiredDocumentsModal
        type={requirementsOf}
        onClose={() => setRequirementsOf(null)}
      />
    </>
  );
}
