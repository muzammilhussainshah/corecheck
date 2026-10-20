'use client';

import { useRouter } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';

export default function ChangePasswordPage() {
  const router = useRouter();
  return (
    <AuthCard
      title="Choose a new password"
      description="Replace the temporary password you were given."
    >
      <ChangePasswordForm onChanged={() => router.replace('/organisations')} />
    </AuthCard>
  );
}
