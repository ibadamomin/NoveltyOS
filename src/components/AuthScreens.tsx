import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCloud, type LinkMode } from '../lib/cloud-context';
import { getMeta, hasLocalData } from '../lib/db';
import { useSettings } from '../lib/settings-context';
import { createBusiness, joinBusiness, myBusinesses, supabase, type Business } from '../lib/supabase';
import { Button, Card, colors, Field, keyboardDismissMode, ListRow, SectionTitle, Segmented } from './ui';

export const ask = (title: string, message: string, buttons: { text: string; value: string; destructive?: boolean }[]) =>
  new Promise<string | null>((resolve) =>
    Alert.alert(title, message, [
      ...buttons.map((b) => ({ text: b.text, style: b.destructive ? ('destructive' as const) : undefined, onPress: () => resolve(b.value) })),
      { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
    ]),
  );

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Nothing in the app is reachable until the user is signed in and linked to a business.
 * All business data lives in the cloud; the phone keeps only a synced working copy so
 * scanning and selling keep working with a weak signal.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useCloud();
  if (status === 'loading') return <Splash />;
  if (status === 'not-configured') return <Shell><NotConfigured /></Shell>;
  if (status === 'signed-out') return <Shell><AuthForm /></Shell>;
  if (status === 'no-business') return <Shell><ChooseBusiness /></Shell>;
  return <>{children}</>;
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <StatusBar style="dark" />
      <Image source={require('../../assets/logo.png')} style={{ width: 140, height: 128 }} accessibilityLabel="noveltyOS logo" />
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={keyboardDismissMode}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <View style={{ alignItems: 'center', marginBottom: 24 }}>
      <Image source={require('../../assets/logo.png')} style={{ width: 110, height: 100 }} accessibilityLabel="noveltyOS logo" />
      <Text style={{ fontSize: 30, fontWeight: '800', color: colors.primary, marginTop: 10 }}>noveltyOS</Text>
      <Text style={{ fontSize: 16, color: colors.muted, marginTop: 4, textAlign: 'center' }}>{subtitle}</Text>
    </View>
  );
}

function NotConfigured() {
  return (
    <>
      <Brand subtitle="Inventory, sales & invoices" />
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 6 }}>This build isn&apos;t connected to the cloud</Text>
        <Text style={{ color: colors.muted }}>
          noveltyOS needs its cloud settings to sign in. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY to the .env file
          (or to the EAS environment variables for app builds), then restart. See the README.
        </Text>
      </Card>
    </>
  );
}

type AuthMode = 'signin' | 'signup' | 'verify' | 'reset';

/** Same rule the Supabase project should enforce (Authentication → Providers → Email → password requirements). */
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters for your password.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers in your password.';
  return null;
}

const RESEND_WAIT_SECONDS = 60;

function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Count down before another code can be requested (protects inboxes and the email quota).
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const cleanEmail = email.trim().toLowerCase();

  const run = async (fn: () => Promise<void>) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return Alert.alert('Enter a valid email address');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const goVerify = async (sendNewCode: boolean) => {
    setCode('');
    setMode('verify');
    if (sendNewCode) {
      const { error } = await supabase!.auth.resend({ type: 'signup', email: cleanEmail });
      if (error) throw error;
    }
    setResendIn(RESEND_WAIT_SECONDS);
  };

  const signIn = () =>
    run(async () => {
      if (!password) throw new Error('Enter your password.');
      const { error } = await supabase!.auth.signInWithPassword({ email: cleanEmail, password });
      if (error && /not confirmed/i.test(error.message)) {
        await goVerify(true);
        Alert.alert('Confirm your email', `We've emailed a new code to ${cleanEmail}. Enter it to finish signing in.`);
        return;
      }
      if (error) throw new Error('Wrong email or password.');
    });

  const signUp = () =>
    run(async () => {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      const { data, error } = await supabase!.auth.signUp({ email: cleanEmail, password });
      if (error) throw error;
      if (!data.session) await goVerify(false); // Supabase emailed a confirmation code
    });

  const verify = () =>
    run(async () => {
      if (!/^\d{6,10}$/.test(code)) throw new Error('Enter the code from the email.');
      const { error } = await supabase!.auth.verifyOtp({ email: cleanEmail, token: code, type: 'signup' });
      if (error) throw new Error('That code is wrong or has expired. Check the latest email, or send a new code.');
      // Signed in: the gate moves on to business setup automatically.
    });

  const resendCode = () =>
    run(async () => {
      if (resendIn > 0) return;
      await goVerify(true);
      Alert.alert('Code sent', `Check ${cleanEmail} for a new code.`);
    });

  const sendReset = () =>
    run(async () => {
      const { error } = await supabase!.auth.resetPasswordForEmail(cleanEmail);
      if (error) throw error;
      setResetCodeSent(true);
      setResendIn(RESEND_WAIT_SECONDS);
      // Same message whether or not the account exists, so nobody can test which emails are registered.
      Alert.alert('Check your email', `If ${cleanEmail} has a noveltyOS account, we've sent it a reset code.`);
    });

  const finishReset = () =>
    run(async () => {
      if (!/^\d{6,10}$/.test(code)) throw new Error('Enter the code from the email.');
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      const { error } = await supabase!.auth.verifyOtp({ email: cleanEmail, token: code, type: 'recovery' });
      if (error) throw new Error('That code is wrong or has expired. Request a new one.');
      const { error: e2 } = await supabase!.auth.updateUser({ password });
      if (e2) throw e2;
    });

  const passwordField = (label: string, hint?: string) => (
    <>
      <Field
        label={label}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        textContentType={mode === 'signin' ? 'password' : 'newPassword'}
        hint={hint}
        style={{ marginBottom: 4 }}
      />
      <Button
        title={showPassword ? 'Hide password' : 'Show password'}
        variant="ghost"
        small
        onPress={() => setShowPassword((v) => !v)}
        style={{ alignSelf: 'flex-start', marginBottom: 10, paddingHorizontal: 0 }}
      />
    </>
  );

  const codeField = (
    <Field
      label="Code from the email"
      value={code}
      onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={10}
      placeholder="123456"
    />
  );

  const resendButton = (
    <Button
      title={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
      variant="ghost"
      disabled={resendIn > 0}
      onPress={mode === 'reset' ? sendReset : resendCode}
    />
  );

  const PASSWORD_HINT = 'At least 8 characters, with letters and numbers';

  if (mode === 'verify') {
    return (
      <>
        <Brand subtitle="Confirm your email" />
        <Card>
          <Text style={{ fontSize: 16, marginBottom: 14 }}>
            We emailed a code to <Text style={{ fontWeight: '700' }}>{cleanEmail}</Text>. Enter it below.
          </Text>
          {codeField}
          <Button title="Confirm & continue" icon="checkmark-circle" onPress={verify} loading={busy} />
        </Card>
        {resendButton}
        <Button title="Use a different email" variant="ghost" onPress={() => setMode('signup')} />
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 8, fontSize: 13 }}>
          Can&apos;t find it? Check your spam folder. Only the newest code works.
        </Text>
      </>
    );
  }

  if (mode === 'reset') {
    return (
      <>
        <Brand subtitle="Reset your password" />
        <Card>
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          {resetCodeSent && (
            <>
              {codeField}
              {passwordField('New password', PASSWORD_HINT)}
            </>
          )}
          {resetCodeSent ? (
            <Button title="Set new password" icon="key-outline" onPress={finishReset} loading={busy} />
          ) : (
            <Button title="Email me a reset code" icon="mail-outline" onPress={sendReset} loading={busy} />
          )}
        </Card>
        {resetCodeSent && resendButton}
        <Button
          title="Back to sign in"
          variant="ghost"
          onPress={() => {
            setMode('signin');
            setResetCodeSent(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <Brand subtitle="Inventory, sales & invoices for small sellers" />
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
        ]}
      />
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
        {mode === 'signin' ? passwordField('Password') : passwordField('Password', PASSWORD_HINT)}
        {mode === 'signin' ? (
          <Button title="Sign in" icon="log-in-outline" onPress={signIn} loading={busy} />
        ) : (
          <Button title="Create account" icon="person-add-outline" onPress={signUp} loading={busy} />
        )}
      </Card>
      {mode === 'signin' && <Button title="Forgot password?" variant="ghost" onPress={() => setMode('reset')} />}
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
  const autoTried = useRef(false);

  const link = async (b: Business, created: boolean) => {
    let mode: LinkMode = created ? 'upload-all' : 'merge';
    const linkedBefore = await getMeta(db, 'business_id');
    // Records made on this phone before it was linked to any business (older app versions).
    if (!created && !linkedBefore && (await hasLocalData(db))) {
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

  useEffect(() => {
    myBusinesses()
      .then(async (rows) => {
        setList(rows);
        // Returning user with one business: go straight in.
        if (rows.length === 1 && !autoTried.current) {
          autoTried.current = true;
          const linkedBefore = await getMeta(db, 'business_id');
          if (linkedBefore === rows[0].id || !(await hasLocalData(db))) await linkBusiness(rows[0], 'merge');
        }
      })
      .catch((e) => {
        setList([]);
        Alert.alert('Could not load your businesses', errMsg(e));
      });
  }, [db, linkBusiness]);

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

  if (list === null) {
    return (
      <View style={{ alignItems: 'center', gap: 16 }}>
        <Brand subtitle={`Signed in as ${session?.user.email ?? ''}`} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Brand subtitle={`Signed in as ${session?.user.email ?? ''}`} />
      {list.length > 0 && (
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
          title="Create business"
          icon="storefront-outline"
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
      <DeleteAccountButton />
    </>
  );
}

export function DeleteAccountButton() {
  const { deleteAccount } = useCloud();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    const first = await ask(
      'Delete your account?',
      'This permanently deletes your login. If you own a business, that business and ALL its cloud records (products, sales, customers, payments) are deleted for everyone in it. Records are also removed from this phone. This cannot be undone.',
      [{ text: 'Continue', value: 'yes', destructive: true }],
    );
    if (!first) return;
    const second = await ask('Are you absolutely sure?', 'Your account and data will be deleted now.', [
      { text: 'Delete my account', value: 'yes', destructive: true },
    ]);
    if (!second) return;
    setBusy(true);
    try {
      await deleteAccount();
      Alert.alert('Account deleted', 'Your account and its data have been deleted.');
    } catch (e) {
      Alert.alert('Could not delete account', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return <Button title="Delete account" variant="ghost" icon="trash-outline" onPress={confirm} loading={busy} style={{ marginTop: 16 }} />;
}
