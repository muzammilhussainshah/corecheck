import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';
import {
  APP_NAME,
  customerLoginSchema,
  type MeResponse,
} from '@corecheck/shared';
import { getServer, login, RequestFailed, setServer } from '../api';
import { Banner, Button, Field, styles } from '../ui';

export function LoginScreen({
  notice,
  onSignedIn,
}: {
  notice: string | null;
  onSignedIn: (me: MeResponse) => void;
}) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [server, setServerField] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getServer().then(setServerField);
  }, []);

  const submit = async () => {
    const parsed = customerLoginSchema.safeParse({
      username,
      pin,
      client: 'mobile',
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setServer(server);
      onSignedIn(await login(parsed.data.username, parsed.data.pin));
    } catch (failure) {
      setError(
        failure instanceof RequestFailed
          ? failure.error.message
          : 'Could not sign in.',
      );
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, styles.authContent]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.dimmed}>
          Use the username and PIN your administrator gave you.
        </Text>
        {notice && !error && <Banner tone="info">{notice}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="PIN"
          value={pin}
          onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        <Button title="Sign in" onPress={submit} loading={busy} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowServer((value) => !value)}
        >
          <Text style={styles.dimmed}>
            {showServer ? 'Hide server' : 'Server settings'}
          </Text>
        </Pressable>
        {showServer && (
          <Field
            label="Server address"
            value={server}
            onChangeText={setServerField}
            autoCapitalize="none"
            keyboardType="url"
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
