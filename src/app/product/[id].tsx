import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Scanner } from '../../components/Scanner';
import { Button, Card, colors, Field, ListRow, Screen, SectionTitle } from '../../components/ui';
import { deleteProduct, getProduct, productHistory, saveProduct, type ProductMovement } from '../../lib/db';
import { centsToInput, formatDate, money, parseMoney, parseQty } from '../../lib/money';

export default function ProductScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ id: string; barcode?: string }>();
  const isNew = params.id === 'new';
  const id = isNew ? undefined : params.id;

  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [qty, setQty] = useState('');
  const [low, setLow] = useState('3');
  const [history, setHistory] = useState<ProductMovement[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getProduct(db, id).then((p) => {
      if (!p) return;
      setName(p.name);
      setBarcode(p.barcode ?? '');
      setPrice(centsToInput(p.price));
      setCost(centsToInput(p.cost));
      setQty(String(p.qty));
      setLow(String(p.low_stock));
    });
    productHistory(db, id).then(setHistory);
  }, [db, id]);

  const priceC = parseMoney(price);
  const costC = parseMoney(cost);
  const margin = !isNaN(priceC) && !isNaN(costC) && priceC > 0 ? priceC - costC : null;

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Give the product a name.');
    if (isNaN(priceC)) return Alert.alert('Selling price required');
    setSaving(true);
    try {
      await saveProduct(db, {
        id,
        name,
        barcode: barcode || null,
        price: priceC,
        cost: isNaN(costC) ? 0 : costC,
        qty: parseInt(qty, 10) || 0,
        low_stock: parseQty(low),
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert('Delete product?', 'Past invoices keep their line items, but this product will be removed from inventory.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProduct(db, id!);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New Product' : 'Edit Product' }} />
      <Card>
        <Field label="Product name" value={name} onChangeText={setName} placeholder="e.g. Glow Fidget Spinner" autoFocus={isNew && !!params.barcode} />
        <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>Barcode / QR code</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Field label="" value={barcode} onChangeText={setBarcode} placeholder="Scan or type (optional)" autoCapitalize="none" style={{ marginBottom: 0 }} />
          </View>
          <Pressable onPress={() => setScanning(true)} style={{ justifyContent: 'center' }} accessibilityLabel="Scan barcode">
            <Ionicons name="scan-circle" size={48} color={colors.primary} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="Selling price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" style={{ flex: 1 }} />
          <Field label="Your cost" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" style={{ flex: 1 }} />
        </View>
        {margin != null && (
          <Text style={{ color: margin >= 0 ? colors.good : colors.danger, marginTop: -6, marginBottom: 12, fontWeight: '600' }}>
            Profit per item: {money(margin)}
            {costC > 0 ? ` (${Math.round((margin / priceC) * 100)}% margin)` : ''}
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            label="Quantity on hand"
            value={qty}
            onChangeText={setQty}
            keyboardType="number-pad"
            placeholder="0"
            style={{ flex: 1 }}
          />
          <Field label="Low-stock alert at" value={low} onChangeText={setLow} keyboardType="number-pad" style={{ flex: 1 }} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: -6 }}>
          Tip: use Receive Stock for new purchases so supplier balances and costs are tracked. Edit quantity here only to fix a miscount.
        </Text>
      </Card>

      <Button title="Save product" icon="checkmark" onPress={save} loading={saving} />

      {!isNew && (
        <>
          <SectionTitle>Movement history</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {history.length === 0 ? (
              <Text style={{ color: colors.muted, padding: 12 }}>No purchases or sales yet.</Text>
            ) : (
              history.map((h, i) => (
                <ListRow
                  key={i}
                  icon={h.kind === 'sale' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                  title={`${h.kind === 'sale' ? 'Sold' : 'Received'} ${h.qty} @ ${money(h.unit_price)}`}
                  subtitle={`${formatDate(h.date)}${h.party_name ? ` · ${h.party_name}` : ''}`}
                  right={`${h.kind === 'sale' ? '-' : '+'}${h.qty}`}
                  rightColor={h.kind === 'sale' ? colors.danger : colors.good}
                  onPress={() => router.push(`/invoice/${h.invoice_id}`)}
                />
              ))
            )}
          </Card>
          <Button title="Delete product" icon="trash-outline" variant="danger" onPress={remove} style={{ marginTop: 8 }} />
        </>
      )}

      <Scanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(code) => {
          setBarcode(code);
          setScanning(false);
        }}
      />
    </Screen>
  );
}
