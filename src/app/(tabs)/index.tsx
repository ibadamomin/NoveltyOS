import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ListRow, Screen, SectionTitle, Segmented, Stat, type IconName } from '../../components/ui';
import { getSummary, startOfToday, type Summary } from '../../lib/db';
import { money } from '../../lib/money';
import { useCloud } from '../../lib/cloud-context';
import { useSettings } from '../../lib/settings-context';
import { useDataVersion } from '../../lib/use-data-version';

type Period = 'today' | 'week' | 'month';

function since(p: Period) {
  if (p === 'today') return startOfToday();
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (p === 'week' ? 6 : 29));
  return d.toISOString();
}

export default function Home() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const [period, setPeriod] = useState<Period>('today');
  const [sum, setSum] = useState<Summary | null>(null);
  const version = useDataVersion();
  const { status } = useCloud();
  const cloudIcon =
    status === 'synced' ? 'cloud-done-outline' : status === 'syncing' ? 'cloud-upload-outline' : status === 'not-configured' || status === 'signed-out' || status === 'no-business' ? 'cloud-outline' : 'cloud-offline-outline';

  useFocusEffect(
    useCallback(() => {
      getSummary(db, since(period)).then(setSum);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, period, version]),
  );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: settings.businessName,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 6 }}>
              {status !== 'not-configured' && (
                <HeaderIconButton icon={cloudIcon} label="Cloud backup and sync" onPress={() => router.push('/account')} />
              )}
              <HeaderIconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
            </View>
          ),
        }}
      />

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <Button title="New Sale" icon="cart" onPress={() => router.navigate('/sell')} style={{ flex: 1 }} />
        <Button title="Receive Stock" icon="download" variant="accent" onPress={() => router.push('/receive')} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
        <Button title="Add Product" icon="add-circle-outline" variant="secondary" small onPress={() => router.push('/product/new')} style={{ flex: 1 }} />
        <Button title="Take Payment" icon="cash-outline" variant="secondary" small onPress={() => router.navigate('/people')} style={{ flex: 1 }} />
      </View>

      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: '7 days' },
          { value: 'month', label: '30 days' },
        ]}
      />

      {sum && (
        <>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Stat label={`Sales (${sum.salesCount})`} value={money(sum.salesTotal)} />
            <Stat label="Profit" value={money(sum.profit)} tone={sum.profit >= 0 ? 'good' : 'danger'} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Stat label="Cash in" value={money(sum.cashIn)} tone="good" />
            <Stat label="Cash out" value={money(sum.cashOut)} tone="danger" />
          </View>
          <Card style={{ backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }}>
            <Text style={{ color: colors.primaryDark, fontWeight: '600' }}>Net cash for period</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primaryDark }}>{money(sum.cashIn - sum.cashOut)}</Text>
            <Text style={{ color: colors.primaryDark, fontSize: 13 }}>Count your cash box — it should change by this much.</Text>
          </Card>

          <SectionTitle>Balances (all time)</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Stat label="Customers owe you" value={money(sum.receivable)} tone={sum.receivable ? 'warn' : undefined} />
            <Stat label="You owe suppliers" value={money(sum.payable)} tone={sum.payable ? 'danger' : undefined} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Stat label="Stock value (at cost)" value={money(sum.stockValue)} />
          </View>

          <SectionTitle>Low stock</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {sum.lowStock.length === 0 ? (
              <Empty icon="checkmark-circle-outline" text="Everything is well stocked" />
            ) : (
              sum.lowStock.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={`Reorder at ${p.low_stock}`}
                  right={`${p.qty} left`}
                  rightColor={p.qty <= 0 ? colors.danger : colors.warn}
                  onPress={() => router.push(`/product/${p.id}`)}
                />
              ))
            )}
          </Card>
        </>
      )}

      <Card style={{ paddingVertical: 4, marginTop: 8 }}>
        <ListRow
          icon="settings-outline"
          title="Business settings"
          subtitle="Name, address, sales tax, cloud backup"
          onPress={() => router.push('/settings')}
        />
      </Card>
    </Screen>
  );
}

/** Header icon with a full 44x44 touch area (Apple's minimum) and visible press feedback. */
function HeaderIconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'transparent',
      })}
    >
      <Ionicons name={icon} size={24} color="#fff" />
    </Pressable>
  );
}
