import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { changePinSchema, type MeResponse } from '@corecheck/shared';
import { changePin, RequestFailed } from '../api';
import { Banner, Button, Field, styles } from '../ui';

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** Replace a temporary PIN before anything else (USR-AC-02). */
export function ChangePinScreen({
  me,
  onChanged,
}: {
  me: MeResponse;
  onChanged: (me: MeResponse) => void;
}) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = changePinSchema.safeParse({ currentPin, newPin });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    if (confirmPin !== newPin)
      return setError('The two new PINs do not match.');
    setBusy(true);
    setError(null);
    try {
      onChanged(await changePin(parsed.data));
    } catch (failure) {
      setError(
        failure instanceof RequestFailed
          ? failure.error.message
          : 'Could not change your PIN.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, styles.authContent]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Choose your PIN</Text>
      <Text style={styles.dimmed}>
        Welcome, {me.user.firstName}. Replace your temporary PIN with one only
        you know.
      </Text>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field
        label="Temporary PIN"
        value={currentPin}
        onChangeText={(v) => setCurrentPin(digits(v))}
        keyboardType="number-pad"
        secureTextEntry
      />
      <Field
        label="New PIN"
        value={newPin}
        onChangeText={(v) => setNewPin(digits(v))}
        keyboardType="number-pad"
        secureTextEntry
      />
      <Field
        label="Confirm new PIN"
        value={confirmPin}
        onChangeText={(v) => setConfirmPin(digits(v))}
        keyboardType="number-pad"
        secureTextEntry
      />
      <Button title="Set my PIN" onPress={submit} loading={busy} />
    </ScrollView>
  );
}
