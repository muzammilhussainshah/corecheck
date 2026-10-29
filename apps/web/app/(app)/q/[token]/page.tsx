'use client';

import { Button, Card, Center, Loader } from '@mantine/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EmptyState } from '@corecheck/ui';
import { useResolvePlantQrQuery } from '../../../../lib/api';

/**
 * Where a plant QR code points. The code carries only a random token; the
 * plant opens only for a signed-in user who may see it (PLT-AC-04). Signed-out
 * scanners are sent to sign in and brought back here.
 */
export default function QrPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data, error } = useResolvePlantQrQuery(token);

  useEffect(() => {
    if (data) router.replace(`/plant/${data.id}`);
  }, [data, router]);

  if (error)
    return (
      <Card withBorder maw={560} mx="auto" mt="xl">
        <EmptyState
          title="This code does not open a plant you can see"
          message="The plant may be at a site you are not assigned to, or the label may belong to another organisation."
          action={
            <Button component={Link} href="/plant" variant="light">
              Go to the plant register
            </Button>
          }
        />
      </Card>
    );
  return (
    <Center py="xl">
      <Loader />
    </Center>
  );
}
