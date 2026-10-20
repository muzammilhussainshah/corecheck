import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { CheckView } from '../model';
import { Banner, Button, colors, styles } from '../ui';

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  lastSyncedAt: Date | null;
  message: string | null;
}

const statusLabel = (view: CheckView): { text: string; color: string } => {
  if (view.rejection) return { text: 'Needs attention', color: colors.danger };
  if (view.check.status === 'submitted')
    return { text: 'Submitted', color: colors.success };
  if (view.submitQueued)
    return { text: 'Submitted · waiting to sync', color: colors.warning };
  if (view.pendingChanges > 0)
    return { text: 'Changes waiting to sync', color: colors.warning };
  return { text: 'Open', color: colors.dimmed };
};

/** Downloaded checks with the device's connection and sync state (MOB-005). */
export function ChecksScreen({
  views,
  status,
  pending,
  userName,
  onOpen,
  onSync,
  onSignOut,
}: {
  views: CheckView[];
  status: SyncStatus;
  pending: number;
  userName: string;
  onOpen: (id: string) => void;
  onSync: () => void;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={[styles.content, styles.headerContent]}>
        <View style={styles.rowBetween}>
          <Text style={styles.brand}>CoreCheck</Text>
          <Pressable accessibilityRole="button" onPress={onSignOut}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
        </View>
        <Text style={styles.dimmed}>Signed in as {userName}</Text>
        <Banner tone={status.online ? 'info' : 'warning'}>
          {status.online
            ? 'Online'
            : 'Offline — your work is saved on this device and will sync automatically.'}
          {'\n'}
          {pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.`
            : 'Everything is synced.'}
          {status.lastSyncedAt
            ? `\nLast synced ${status.lastSyncedAt.toLocaleTimeString()}`
            : ''}
        </Banner>
        {status.message && <Banner tone="warning">{status.message}</Banner>}
        <Button
          title={status.syncing ? 'Syncing…' : 'Sync now'}
          onPress={onSync}
          variant="secondary"
          loading={status.syncing}
          disabled={!status.online}
        />
      </View>
      <FlatList
        data={views}
        keyExtractor={(view) => view.check.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={status.syncing} onRefresh={onSync} />
        }
        ListEmptyComponent={
          <Text style={styles.dimmed}>
            No checks downloaded for your sites yet. Pull down to sync.
          </Text>
        }
        renderItem={({ item }) => {
          const label = statusLabel(item);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpen(item.check.id)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{item.check.plantLabel}</Text>
              <Text style={styles.dimmed}>
                {item.check.title} · {item.check.site.name}
              </Text>
              <Text style={[styles.strong, { color: label.color }]}>
                {label.text}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
