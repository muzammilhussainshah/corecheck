import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { MeResponse } from '@corecheck/shared';
import * as api from './src/api';
import * as db from './src/db';
import { buildView, type CheckView } from './src/model';
import { ChangePinScreen } from './src/screens/ChangePinScreen';
import { CheckScreen } from './src/screens/CheckScreen';
import { ChecksScreen, type SyncStatus } from './src/screens/ChecksScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { syncNow } from './src/sync';
import { colors, styles } from './src/ui';

/**
 * A v4-format id for a queued change. It only needs to be unique per device
 * (the server uses it to recognise a resend), not unpredictable.
 */
const HEX = '0123456789abcdef';
const newId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) =>
    char === 'x'
      ? HEX[Math.floor(Math.random() * 16)]!
      : '89ab'[Math.floor(Math.random() * 4)]!,
  );

/**
 * The offline-sync proof of concept app (Milestone 1). Work is written to the
 * local database first and synchronised whenever a connection is available,
 * so a check can be completed with no signal at all (MOB-AC-01).
 */
function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [views, setViews] = useState<CheckView[]>([]);
  const [pending, setPending] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Keeps the last signed-in profile so the app can start offline. */
  const signIn = useCallback(async (profile: MeResponse) => {
    await db.setSetting('me', JSON.stringify(profile));
    setMe(profile);
  }, []);

  const [status, setStatus] = useState<SyncStatus>({
    online: true,
    syncing: false,
    lastSyncedAt: null,
    message: null,
  });

  const refresh = useCallback(async () => {
    const [checks, answers, photos, rejections, submits, outbox] =
      await Promise.all([
        db.loadChecks(),
        db.loadAnswers(),
        db.loadPhotos(),
        db.loadRejections(),
        db.queuedSubmits(),
        db.loadOutbox(),
      ]);
    setViews(
      checks.map((check) =>
        buildView(
          check,
          answers,
          photos,
          submits.has(check.id),
          rejections.find((r) => r.checkId === check.id) ?? null,
        ),
      ),
    );
    setPending(
      outbox.length + photos.filter((photo) => !photo.uploaded).length,
    );
  }, []);

  const endSession = useCallback(async (message: string) => {
    await api.clearToken();
    setMe(null);
    setOpenId(null);
    setNotice(
      `${message} Work on this device is kept and will sync after you sign in.`,
    );
  }, []);

  const sync = useCallback(async () => {
    setStatus((current) => ({ ...current, syncing: true }));
    try {
      const { removed } = await syncNow();
      setStatus((current) => ({
        ...current,
        online: true,
        syncing: false,
        lastSyncedAt: new Date(),
        message:
          removed > 0
            ? `${removed} check${removed === 1 ? ' was' : 's were'} removed: you no longer have access.`
            : null,
      }));
    } catch (error) {
      setStatus((current) => ({ ...current, syncing: false }));
      if (error instanceof api.RequestFailed && error.sessionEnded)
        await endSession(error.error.message);
      else if (error instanceof api.RequestFailed && error.offline)
        setStatus((current) => ({ ...current, online: false }));
    } finally {
      await refresh();
    }
  }, [endSession, refresh]);

  // Start: open the database and resume a saved session.
  useEffect(() => {
    (async () => {
      await db.initDatabase();
      await refresh();
      if (await api.hasToken()) {
        try {
          await signIn(await api.me());
        } catch (error) {
          if (error instanceof api.RequestFailed && error.offline) {
            // Offline at start: carry on with what is on the device.
            const saved = await db.getSetting('me');
            if (saved) setMe(JSON.parse(saved) as MeResponse);
            setStatus((current) => ({ ...current, online: false }));
          } else if (error instanceof api.RequestFailed && error.sessionEnded) {
            // Tell them why, e.g. a sign-in on another device ended it.
            await endSession(error.error.message);
          } else {
            await api.clearToken();
          }
        }
      }
      setBooting(false);
    })();
  }, [endSession, refresh, signIn]);

  // Sync when signed in, and again whenever the connection returns.
  useEffect(() => {
    if (!me || me.mustChangePin) return undefined;
    void sync();
    return NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setStatus((current) => ({ ...current, online }));
      if (online) void sync();
    });
  }, [me, sync]);

  const record = useCallback(
    async (change: () => Promise<unknown>) => {
      await change();
      await refresh();
      void sync();
    },
    [refresh, sync],
  );

  const openView = useMemo(
    () => views.find((view) => view.check.id === openId) ?? null,
    [views, openId],
  );

  const content = (() => {
    if (booting) {
      return (
        <View style={styles.centred}>
          <ActivityIndicator color={colors.brand} />
        </View>
      );
    }
    if (!me) {
      return (
        <LoginScreen
          notice={notice}
          onSignedIn={(signedIn) => {
            setNotice(null);
            void signIn(signedIn);
          }}
        />
      );
    }
    if (me.mustChangePin)
      return (
        <ChangePinScreen
          me={me}
          onChanged={(changed) => {
            void signIn(changed);
          }}
        />
      );
    if (openView) {
      const checkId = openView.check.id;
      return (
        <CheckScreen
          key={checkId}
          view={openView}
          actions={{
            back: () => setOpenId(null),
            answer: (questionKey, value) => {
              void record(() =>
                db.queueMutation({
                  id: newId(),
                  type: 'answer',
                  checkId,
                  questionKey,
                  value,
                  answeredAt: new Date().toISOString(),
                }),
              );
            },
            addPhoto: (uri) => {
              void record(() =>
                db.addPhoto({
                  id: newId(),
                  checkId,
                  questionKey: 'photo',
                  uri,
                  capturedAt: new Date().toISOString(),
                }),
              );
            },
            submit: () => {
              void record(() =>
                db.queueMutation({
                  id: newId(),
                  type: 'submit',
                  checkId,
                  submittedAt: new Date().toISOString(),
                }),
              );
            },
          }}
        />
      );
    }
    return (
      <ChecksScreen
        views={views}
        status={status}
        pending={pending}
        userName={`${me.user.firstName} ${me.user.lastName}`}
        onOpen={setOpenId}
        onSync={() => {
          void sync();
        }}
        onSignOut={async () => {
          await api.logout();
          setMe(null);
          setNotice('You have signed out.');
        }}
      />
    );
  })();

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {content}
    </SafeAreaProvider>
  );
}

export default App;
