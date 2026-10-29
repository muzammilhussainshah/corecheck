'use client';

import { Center, Loader } from '@mantine/core';
import { useParams, useRouter } from 'next/navigation';
import type { ApiError } from '@corecheck/shared';
import { EmptyState, ErrorAlert } from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import { PlantForm } from '../../../../../components/plant/PlantForm';
import { usePlantQuery } from '../../../../../lib/api';

export default function EditPlantPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data: plant, error } = usePlantQuery(id);

  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!plant)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Plant', href: '/plant' },
          { label: plant.assetId, href: `/plant/${plant.id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${plant.name}`}
        description={plant.assetId}
      />
      {plant.capabilities.edit ? (
        <PlantForm
          plant={plant}
          onSaved={() => router.push(`/plant/${plant.id}`)}
          onCancel={() => router.push(`/plant/${plant.id}`)}
        />
      ) : (
        <EmptyState
          title="You cannot edit this plant"
          message={
            plant.archivedAt
              ? 'It is archived. Restore it first.'
              : 'Once plant is submitted, its details can be changed only by someone allowed to edit plant.'
          }
        />
      )}
    </>
  );
}
