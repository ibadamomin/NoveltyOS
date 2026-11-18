import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ListRow, SearchBox, Segmented, styles } from '../../components/ui';
import { listParties, type Party, type PartyType } from '../../lib/db';
import { money } from '../../lib/money';

export default function People() {
  const db = useSQLiteContext();
  const [type, setType] = useState<PartyType>('customer');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Party[]>([]);

  useFocusEffect(
    useCallback(() => {
      listParties(db, type, search).then(setRows);
    }, [db, type, search]),
  );

  const outstanding = rows.reduce((s, p) => s + Math.max(p.balance, 0), 0);
  const isCustomer = type === 'customer';

  return (
    <View style={[styles.screen, { padding: 16, paddingBottom: 0 }]}>
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: 'customer', label: 'Customers' },
          { value: 'supplier', label: 'Suppliers' },
        ]}
      />
      <Card style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontWeight: '600' }}>{isCustomer ? 'Customers owe you (receivable)' : 'You owe suppliers (payable)'}</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: outstanding ? (isCustomer ? colors.warn : colors.danger) : colors.text }}>
            {money(outstanding)}
          </Text>
        </View>
        <Button
          title="Add"
          icon="person-add"
          small
          onPress={() => router.push({ pathname: '/party/[id]', params: { id: 'new', type } })}
        />
      </Card>
      <SearchBox value={search} onChangeText={setSearch} placeholder={`Search ${type}s`} />
      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <ListRow
            icon={isCustomer ? 'person-outline' : 'business-outline'}
            title={item.name}
            subtitle={item.phone || undefined}
            right={money(item.balance)}
            rightSub={item.balance > 0 ? (isCustomer ? 'owes you' : 'you owe') : item.balance < 0 ? 'credit' : 'settled'}
            rightColor={item.balance > 0 ? (isCustomer ? colors.warn : colors.danger) : colors.good}
            onPress={() => router.push(`/party/${item.id}`)}
          />
        )}
        ListEmptyComponent={<Empty icon="people-outline" text={`No ${type}s yet`} />}
      />
    </View>
  );
}
