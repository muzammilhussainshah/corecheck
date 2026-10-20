'use client';

import { useRouter } from 'next/navigation';
import { AuthLayout, PageLoader } from '@corecheck/ui';
import { ChangePinForm } from '../../components/ChangePinForm';
import { useMeQuery } from '../../lib/api';

/** The forced first step after signing in with a temporary PIN (USR-003). */
export default function ChangePinPage() {
  const router = useRouter();
  const { data: me } = useMeQuery();

  if (!me) {
    return <PageLoader />;
  }

  return (
    <AuthLayout
      title={me.mustChangePin ? 'Choose your PIN' : 'Change your PIN'}
      description={
        me.mustChangePin
          ? `Welcome, ${me.user.firstName}. Replace your temporary PIN with one only you know.`
          : 'Enter your current PIN, then your new one twice.'
      }
    >
      <ChangePinForm
        temporary={me.mustChangePin}
        onChanged={() => router.replace('/')}
      />
    </AuthLayout>
  );
}
