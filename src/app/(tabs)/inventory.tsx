import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { Scanner } from '../../components/Scanner';
import { Button, colors, Empty, ListRow, SearchBox, styles, keyboardDismissMode } from '../../components/ui';
import { findByBarcode, listProducts, type Product } from '../../lib/db';
import { useDataVersion } from '../../lib/use-data-version';
import { money } from '../../lib/money';

export default function Inventory() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Product[]>([]);
  const [scanning, setScanning] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listProducts(db, search).then(setRows);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, search, version]),
  );

  const onScanned = async (code: string) => {
    setScanning(false);
    const p = await findByBarcode(db, code);
    if (p) router.push(`/product/${p.id}`);
    else
      Alert.alert('New barcode', `${code} isn't in your inventory yet.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add product', onPress: () => router.push({ pathname: '/product/[id]', params: { id: 'new', barcode: code } }) },
      ]);
  };

  const units = rows.reduce((s, p) => s + Math.max(p.qty, 0), 0);

  return (
    <View style={[styles.screen, { padding: 16, paddingBottom: 0 }]}>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <Button title="Receive stock" icon="download" variant="accent" onPress={() => router.push('/receive')} style={{ flex: 1 }} small />
        <Button title="New product" icon="add" variant="secondary" onPress={() => router.push('/product/new')} style={{ flex: 1 }} small />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or barcode" />
        </View>
        <Button title="" icon="scan" small onPress={() => setScanning(true)} style={{ height: 46, width: 52 }} />
      </View>
      <Text style={{ color: colors.muted, marginBottom: 4 }}>
        {rows.length} products · {units} units on hand
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={keyboardDismissMode}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${money(item.price)} · cost ${money(item.cost)}${item.barcode ? ` · ${item.barcode}` : ''}`}
            right={`${item.qty}`}
            rightSub="in stock"
            rightColor={item.qty <= 0 ? colors.danger : item.qty <= item.low_stock ? colors.warn : colors.good}
            onPress={() => router.push(`/product/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <Empty icon="cube-outline" text={search ? 'No matches' : 'No products yet.\nTap "Receive stock" and scan your first items.'} />
        }
      />
      <Scanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} title="Find product" />
    </View>
  );
}
