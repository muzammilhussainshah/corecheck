'use client';

import { Card, SimpleGrid, Title } from '@mantine/core';
import { type DetailItem, DetailList } from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { ChangePinForm } from '../../../components/ChangePinForm';
import {
  useDisciplinesQuery,
  useSitesQuery,
  useTeamsQuery,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';

const namesOf = (
  ids: string[],
  items: { id: string; name: string }[] | undefined,
) =>
  ids
    .map((id) => items?.find((item) => item.id === id)?.name)
    .filter(Boolean)
    .join(', ') || '—';

export default function ProfilePage() {
  const { me, can } = useSession();
  const viewStructure = can('org_structure.view');
  const { data: sites } = useSitesQuery(
    { includeArchived: true },
    { skip: !viewStructure },
  );
  const { data: teams } = useTeamsQuery(
    { includeArchived: true },
    { skip: !viewStructure },
  );
  const { data: disciplines } = useDisciplinesQuery(
    { includeArchived: true },
    { skip: !viewStructure },
  );
  if (!me) return null;

  const rows: DetailItem[] = [
    { label: 'Name', value: `${me.user.firstName} ${me.user.lastName}` },
    { label: 'Username', value: me.user.username },
    { label: 'Email', value: me.user.email ?? '—' },
    { label: 'Role', value: me.role.name },
    {
      label: 'Sites',
      value: me.scope.orgWide ? 'All sites' : namesOf(me.scope.siteIds, sites),
    },
    { label: 'Teams', value: namesOf(me.scope.teamIds, teams) },
    {
      label: 'Disciplines',
      value: namesOf(me.scope.disciplineIds, disciplines),
    },
  ];

  return (
    <>
      <AppPageHeader
        title="My profile"
        description="Your details are managed by your administrator."
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card withBorder>
          <Title order={4} mb="md">
            Details
          </Title>
          <DetailList items={rows} />
        </Card>
        <Card withBorder id="pin">
          <Title order={4} mb="md">
            Change PIN
          </Title>
          <ChangePinForm temporary={false} onChanged={() => undefined} />
        </Card>
      </SimpleGrid>
    </>
  );
}
