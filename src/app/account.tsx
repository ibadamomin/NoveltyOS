import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Image, Share, Text, View } from 'react-native';
import { Button, Card, colors, Field, ListRow, Screen, SectionTitle, Segmented } from '../components/ui';
import { useCloud, type LinkMode } from '../lib/cloud-context';
import { countUnsynced, getMeta, hasLocalData } from '../lib/db';
import { formatDateTime } from '../lib/money';
import { useSettings } from '../lib/settings-context';
import { createBusiness, joinBusiness, myBusinesses, supabase, type Business } from '../lib/supabase';

const ask = (title: string, message: string, buttons: { text: string; value: string; destructive?: boolean }[]) =>
  new Promise<string | null>((resolve) =>
    Alert.alert(title, message, [
      ...buttons.map((b) => ({ text: b.text, style: b.destructive ? ('destructive' as const) : undefined, onPress: () => resolve(b.value) })),
      { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
    ]),
  );

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function AccountScreen() {
  const { status } = useCloud();
  return (
    <Screen>
      {status === 'not-configured' ? (
        <Card>
          <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 6 }}>Cloud sync is not set up</Text>
          <Text style={{ color: colors.muted }}>
            This copy of noveltyOS works fully offline. To enable cloud backup and multi-phone sync, the app needs to be built with
            the Supabase settings described in the README (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY).
          </Text>
        </Card>
      ) : status === 'signed-out' ? (
        <AuthForm />
      ) : status === 'no-business' ? (
        <ChooseBusiness />
      ) : (
        <Connected />
      )}
    </Screen>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (!email.trim()) return Alert.alert('Enter your email');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    });

  const signUp = () =>
    run(async () => {
      if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
      const { data, error } = await supabase!.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      if (!data.session) {
        Alert.alert('Check your email', 'We sent you a confirmation link. Open it, then come back and sign in.');
        setMode('signin');
      }
    });

  const sendReset = () =>
    run(async () => {
      const { error } = await supabase!.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setCodeSent(true);
    });

  const finishReset = () =>
    run(async () => {
      if (password.length < 8) throw new Error('Use at least 8 characters for your new password.');
      const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
      if (error) throw error;
      const { error: e2 } = await supabase!.auth.updateUser({ password });
      if (e2) throw e2;
      Alert.alert('Password changed', 'You are now signed in.');
    });

  return (
    <>
      <Card style={{ alignItems: 'center' }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 96, height: 88 }} accessibilityLabel="noveltyOS logo" />
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.primary, marginTop: 8 }}>noveltyOS</Text>
        <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 8 }}>Back up & sync your business</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 4 }}>
          Keep your records safe if you lose your phone, and use noveltyOS on more than one phone.
        </Text>
      </Card>
      {mode !== 'reset' && (
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'signin', label: 'Sign in' },
            { value: 'signup', label: 'Create account' },
          ]}
        />
      )}
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        {mode === 'reset' && codeSent && (
          <Field label="Code from the email" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" />
        )}
        {(mode !== 'reset' || codeSent) && (
          <Field
            label={mode === 'reset' ? 'New password' : 'Password'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            hint={mode === 'signin' ? undefined : 'At least 8 characters'}
          />
        )}
        {mode === 'signin' && <Button title="Sign in" icon="log-in-outline" onPress={signIn} loading={busy} />}
        {mode === 'signup' && <Button title="Create account" icon="person-add-outline" onPress={signUp} loading={busy} />}
        {mode === 'reset' &&
          (codeSent ? (
            <Button title="Set new password" icon="key-outline" onPress={finishReset} loading={busy} />
          ) : (
            <Button title="Email me a reset code" icon="mail-outline" onPress={sendReset} loading={busy} />
          ))}
      </Card>
      {mode === 'signin' && <Button title="Forgot password?" variant="ghost" onPress={() => setMode('reset')} />}
      {mode === 'reset' && (
        <Button
          title="Back to sign in"
          variant="ghost"
          onPress={() => {
            setMode('signin');
            setCodeSent(false);
          }}
        />
      )}
    </>
  );
}

function ChooseBusiness() {
  const db = useSQLiteContext();
  const { session, linkBusiness, signOut } = useCloud();
  const { settings } = useSettings();
  const [list, setList] = useState<Business[] | null>(null);
  const [name, setName] = useState(settings.businessName === 'My Business' ? '' : settings.businessName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    myBusinesses()
      .then(setList)
      .catch((e) => {
        setList([]);
        Alert.alert('Could not load your businesses', errMsg(e));
      });
  }, []);

  const link = async (b: Business, created: boolean) => {
    let mode: LinkMode = created ? 'upload-all' : 'merge';
    const linkedBefore = await getMeta(db, 'business_id');
    if (!created && linkedBefore !== b.id && (await hasLocalData(db))) {
      const choice = await ask(
        'This phone already has records',
        `Add them to "${b.name}", or replace them with "${b.name}"'s records from the cloud?`,
        [
          { text: `Add to ${b.name}`, value: 'merge' },
          { text: 'Replace with cloud', value: 'replace', destructive: true },
        ],
      );
      if (!choice) return;
      mode = choice as LinkMode;
    }
    await linkBusiness(b, mode);
  };

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>Signed in as {session?.user.email}</Text>
      {list && list.length > 0 && (
        <>
          <SectionTitle>Your businesses</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {list.map((b) => (
              <ListRow key={b.id} icon="storefront-outline" title={b.name} onPress={() => withBusy('pick', () => link(b, false))} />
            ))}
          </Card>
        </>
      )}
      <SectionTitle>Start a new business</SectionTitle>
      <Card>
        <Field label="Business name" value={name} onChangeText={setName} placeholder="e.g. Garage Goodies" />
        <Button
          title="Create & upload this phone's records"
          icon="cloud-upload-outline"
          loading={busy === 'create'}
          onPress={() =>
            withBusy('create', async () => {
              if (!name.trim()) throw new Error('Enter a business name.');
              await link(await createBusiness(name.trim()), true);
            })
          }
        />
      </Card>
      <SectionTitle>Join a business</SectionTitle>
      <Card>
        <Field label="Invite code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="8-character code from the owner" />
        <Button
          title="Join"
          icon="enter-outline"
          variant="secondary"
          loading={busy === 'join'}
          onPress={() =>
            withBusy('join', async () => {
              if (!code.trim()) throw new Error('Enter the invite code.');
              await link(await joinBusiness(code), false);
            })
          }
        />
      </Card>
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </>
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
    </>
  );
}
