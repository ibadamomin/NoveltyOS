import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { Share, Text, View } from 'react-native';
import { ask, DeleteAccountButton } from '../components/AuthScreens';
import { Button, Card, colors, Screen, SectionTitle } from '../components/ui';
import { useCloud } from '../lib/cloud-context';
import { countUnsynced } from '../lib/db';
import { formatDateTime } from '../lib/money';

/** Signed-in account: sync status, invite code, sign out, delete account. (Sign-in itself happens before the app opens.) */
export default function AccountScreen() {
  return (
    <Screen>
      <Connected />
    </Screen>
  );
}

function Connected() {
  const db = useSQLiteContext();
  const { status, session, business, lastSynced, error, unsynced, syncNow, signOut } = useCloud();

  const badge =
    status === 'syncing'
      ? { icon: 'sync' as const, text: 'Syncing…', color: colors.primary }
      : status === 'synced'
        ? { icon: 'checkmark-circle' as const, text: 'Backed up', color: colors.good }
        : status === 'offline'
          ? { icon: 'cloud-offline-outline' as const, text: 'Offline — will sync when back online', color: colors.warn }
          : { icon: 'alert-circle' as const, text: 'Sync problem', color: colors.danger };

  const confirmSignOut = async () => {
    await syncNow();
    const pending = await countUnsynced(db);
    const choice = await ask(
      'Sign out?',
      pending
        ? `${pending} change(s) haven't reached the cloud yet and will be lost. Connect to the internet first if you can.`
        : 'Records are removed from this phone but stay safe in the cloud. Sign in again any time to get them back.',
      [{ text: 'Sign out', value: 'yes', destructive: true }],
    );
    if (choice) await signOut();
  };

  return (
    <>
      <Card>
        <Text style={{ color: colors.muted, fontWeight: '600' }}>Business</Text>
        <Text style={{ fontSize: 22, fontWeight: '800' }}>{business?.name}</Text>
        <Text style={{ color: colors.muted, marginTop: 2 }}>Signed in as {session?.user.email}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <Ionicons name={badge.icon} size={22} color={badge.color} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: badge.color, flex: 1 }}>{badge.text}</Text>
        </View>
        {lastSynced && <Text style={{ color: colors.muted, marginTop: 4 }}>Last synced {formatDateTime(lastSynced)}</Text>}
        {unsynced > 0 && <Text style={{ color: colors.warn, marginTop: 4 }}>{unsynced} change(s) waiting to upload</Text>}
        {error && status === 'error' && <Text style={{ color: colors.danger, marginTop: 4 }}>{error}</Text>}
        <Button title="Sync now" icon="sync" small variant="secondary" onPress={syncNow} loading={status === 'syncing'} style={{ marginTop: 12 }} />
      </Card>

      <SectionTitle>Add another phone or employee</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted }}>On the other phone: install noveltyOS, create an account, then choose “Join a business” and enter:</Text>
        <Text selectable style={{ fontSize: 30, fontWeight: '800', letterSpacing: 4, textAlign: 'center', marginVertical: 12 }}>
          {business?.invite_code}
        </Text>
        <Button
          title="Share invite code"
          icon="share-outline"
          small
          onPress={() => Share.share({ message: `Join ${business?.name} on noveltyOS with invite code ${business?.invite_code}` })}
        />
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={confirmSignOut} style={{ marginTop: 8 }} />
      <DeleteAccountButton />
    </>
  );
}
