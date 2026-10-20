'use client';

import { Button, Center, Code, Image, Stack, Text } from '@mantine/core';
import { CodeInput, PageLoader } from '@corecheck/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ApiError, MfaSetupResponse, StaffMe } from '@corecheck/shared';
import { AuthCard } from '../../components/AuthCard';
import {
  useMeQuery,
  useMfaConfirmMutation,
  useMfaSetupMutation,
  useMfaVerifyMutation,
} from '../../lib/api';

/** Second factor: enrol an authenticator app once, then a code at every sign-in. */
export default function MfaPage() {
  const router = useRouter();
  const { data: me } = useMeQuery();
  const [setup, { isLoading: settingUp }] = useMfaSetupMutation();
  const [confirm, { isLoading: confirming }] = useMfaConfirmMutation();
  const [verify, { isLoading: verifying }] = useMfaVerifyMutation();
  const [enrolment, setEnrolment] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codeFocus, setCodeFocus] = useState(0);

  // Nothing to do here when the session needs no second factor.
  useEffect(() => {
    if (me?.mfaVerified)
      router.replace(
        me.mustChangePassword ? '/change-password' : '/organisations',
      );
  }, [me, router]);

  if (!me || me.mfaVerified) return <PageLoader label="CoreCheck Admin" />;

  const done = (staff: StaffMe) =>
    router.replace(
      staff.mustChangePassword ? '/change-password' : '/organisations',
    );

  const submitCode = async () => {
    setError(null);
    const result = me.mfaEnabled
      ? await verify({ code })
      : await confirm({ code });
    if (result.error) {
      setError((result.error as ApiError).message);
      setCode('');
      setCodeFocus((n) => n + 1);
      return;
    }
    done(result.data);
  };

  const codeEntry = (
    <Stack>
      <CodeInput
        label="Authenticator code"
        focusKey={codeFocus}
        value={code}
        onChange={setCode}
        error={error}
      />
      <Button
        onClick={submitCode}
        loading={confirming || verifying}
        disabled={code.length !== 6}
      >
        {me.mfaEnabled ? 'Verify' : 'Confirm and continue'}
      </Button>
    </Stack>
  );

  if (me.mfaEnabled) {
    return (
      <AuthCard
        title="Two-factor authentication"
        description="Enter the 6-digit code from your authenticator app."
      >
        {codeEntry}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up two-factor authentication"
      description="Required for every CoreCheck staff account. Use an authenticator app such as Microsoft Authenticator or Google Authenticator."
    >
      {enrolment ? (
        <Stack>
          <Center>
            <Image
              src={enrolment.qrCodeDataUrl}
              alt="QR code for your authenticator app"
              w={200}
              h={200}
            />
          </Center>
          <Text size="sm" c="dimmed">
            Can&apos;t scan it? Enter this key instead:
          </Text>
          <Code block>{enrolment.secret}</Code>
          {codeEntry}
        </Stack>
      ) : (
        <Button
          loading={settingUp}
          onClick={async () => {
            const result = await setup();
            if ('data' in result && result.data) setEnrolment(result.data);
          }}
        >
          Show QR code
        </Button>
      )}
    </AuthCard>
  );
}
