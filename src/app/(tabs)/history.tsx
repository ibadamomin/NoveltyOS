import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { colors, Empty, ListRow, SearchBox, Segmented, styles } from '../../components/ui';
import { invoiceNumber, listInvoices, type Invoice, type InvoiceKind } from '../../lib/db';
import { formatDateTime, money } from '../../lib/money';

export default function History() {
  const db = useSQLiteContext();
  const [kind, setKind] = useState<InvoiceKind | 'all'>('sale');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Invoice[]>([]);

  useFocusEffect(
    useCallback(() => {
      listInvoices(db, kind, search).then(setRows);
    }, [db, kind, search]),
  );

  return (
    <View style={[styles.screen, { padding: 16, paddingBottom: 0 }]}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'sale', label: 'Sales' },
          { value: 'purchase', label: 'Purchases' },
          { value: 'all', label: 'All' },
        ]}
      />
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or number" />
      <FlatList
        data={rows}
        keyExtractor={(i) => String(i.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => {
          const due = item.total - item.paid;
          return (
            <ListRow
              icon={item.kind === 'sale' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
              title={`${invoiceNumber(item)} · ${item.party_name ?? (item.kind === 'sale' ? 'Walk-in' : 'No supplier')}`}
              subtitle={`${formatDateTime(item.date)} · ${item.method}`}
              right={money(item.total)}
              rightSub={due > 0 ? `${money(due)} unpaid` : 'paid'}
              rightColor={item.kind === 'sale' ? colors.good : colors.text}
              onPress={() => router.push(`/invoice/${item.id}`)}
            />
          );
        }}
        ListEmptyComponent={<Empty icon="receipt-outline" text="No records yet" />}
      />
    </View>
  );
}
