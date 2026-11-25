'use client';

import { Card } from '@mantine/core';
import { useState } from 'react';
import type { ApiError, PlantDetail } from '@corecheck/shared';
import { DEFAULT_PAGE_SIZE, EmptyState, ErrorAlert } from '@corecheck/ui';
import { DefectsTable } from '../checks/DefectsTable';
import { useDefectsQuery } from '../../lib/api';
import { useSession } from '../../lib/session';

/** The plant's Defects, open ones first (DEF-004). */
export function PlantDefectsTab({ plant }: { plant: PlantDetail }) {
  const { me } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { data, isFetching, error } = useDefectsQuery({ plantId: plant.id, page, pageSize });
  if (error) return <ErrorAlert error={error as ApiError} />;
  return (
    <Card withBorder p={0}>
      <DefectsTable
        rows={data?.items}
        loading={isFetching}
        showPlant={false}
        timeZone={me?.organisation.timeZone}
        empty={
          <EmptyState
            title="No Defects"
            message="Defects are raised by failed answers to questions with a defect trigger."
          />
        }
        pagination={
          data && {
            page,
            pageSize,
            total: data.total,
            onChange: setPage,
            onPageSizeChange: (size: number) => {
              setPageSize(size);
              setPage(1);
            },
          }
        }
      />
    </Card>
  );
}
