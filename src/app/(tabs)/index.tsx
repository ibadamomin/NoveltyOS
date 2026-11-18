import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ListRow, Screen, SectionTitle, Segmented, Stat } from '../../components/ui';
import { getSummary, startOfToday, type Summary } from '../../lib/db';
import { money } from '../../lib/money';
import { useSettings } from '../../lib/settings-context';

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

  useFocusEffect(
    useCallback(() => {
      getSummary(db, since(period)).then(setSum);
    }, [db, period]),
  );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: settings.businessName,
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={{ marginRight: 16 }} accessibilityLabel="Settings">
              <Ionicons name="settings-outline" size={24} color="#fff" />
            </Pressable>
          ),
        }}
      />

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <Button title="New Sale" icon="cart" onPress={() => router.navigate('/sell')} style={{ flex: 1 }} />
        <Button title="Receive Stock" icon="download" onPress={() => router.push('/receive')} style={{ flex: 1 }} />
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
    </Screen>
  );
}
