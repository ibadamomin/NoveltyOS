import { router } from 'expo-router';
import { useState } from 'react';
import Constants from 'expo-constants';
import { Alert, Image, Text, View } from 'react-native';
import { Button, Card, colors, Field, ListRow, Screen } from '../components/ui';
import type { Settings } from '../lib/db';
import { useSettings } from '../lib/settings-context';

export default function SettingsScreen() {
  const { settings, update } = useSettings();
  const [s, setS] = useState<Settings>(settings);
  const set = (k: keyof Settings) => (v: string) => setS((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!s.businessName.trim()) return Alert.alert('Business name required');
    if (s.taxRate && isNaN(Number(s.taxRate))) return Alert.alert('Tax rate must be a number, e.g. 8.25');
    await update({ ...s, businessName: s.businessName.trim() });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen>
      <Card style={{ paddingVertical: 4 }}>
        <ListRow icon="cloud-outline" title="Cloud backup & sync" subtitle="Back up your records and use more than one phone" onPress={() => router.push('/account')} />
      </Card>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>These details appear on every invoice and receipt.</Text>
      <Card>
        <Field label="Business name" value={s.businessName} onChangeText={set('businessName')} />
        <Field label="Address" value={s.address} onChangeText={set('address')} multiline />
        <Field label="Phone" value={s.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Email" value={s.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
      </Card>
      <Card>
        <Field label="Sales tax %" value={s.taxRate} onChangeText={set('taxRate')} keyboardType="decimal-pad" hint="Use 0 if you don't charge sales tax." />
        <Field label="Currency symbol" value={s.currency} onChangeText={set('currency')} maxLength={3} />
        <Field label="Receipt footer" value={s.footer} onChangeText={set('footer')} />
      </Card>
      <Button title="Save settings" icon="checkmark" onPress={save} />
      <View style={{ alignItems: 'center', marginTop: 32, opacity: 0.85 }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 56, height: 51 }} accessibilityLabel="noveltyOS logo" />
        <Text style={{ fontWeight: '800', color: colors.primary, marginTop: 6 }}>noveltyOS</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </View>
    </Screen>
  );
}
