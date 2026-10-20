import type { ReactNode } from 'react';
import { AuthLayout, Pill } from '@corecheck/ui';

/** Frame for the sign-in, MFA and password screens of the internal portal. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthLayout
      title={title}
      description={description}
      badge={
        <div style={{ marginBottom: 12 }}>
          <Pill tone="info">Internal admin</Pill>
        </div>
      }
    >
      {children}
    </AuthLayout>
  );
}
