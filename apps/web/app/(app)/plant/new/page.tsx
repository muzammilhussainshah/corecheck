'use client';

import { useRouter } from 'next/navigation';
import { EmptyState } from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import { PlantForm } from '../../../../components/plant/PlantForm';
import { useSession } from '../../../../lib/session';

/** Registers plant as Pending Reception (PLT-006, PLC-003). */
export default function NewPlantPage() {
  const router = useRouter();
  const { can } = useSession();

  return (
    <>
      <AppPageHeader
        crumbs={[{ label: 'Plant', href: '/plant' }, { label: 'Add plant' }]}
        title="Register plant"
        description="New plant starts as Pending Reception until it passes reception and is approved."
      />
      {can('plant.create') ? (
        <PlantForm
          onSaved={(saved) => router.push(`/plant/${saved.plant.id}`)}
          onCancel={() => router.push('/plant')}
        />
      ) : (
        <EmptyState
          title="You cannot register plant"
          message="Ask an Admin for the permission to create plant."
        />
      )}
    </>
  );
}
