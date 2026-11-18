import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { PartyPicker, ProductPicker } from '../components/Pickers';
import { Scanner } from '../components/Scanner';
import { Button, Card, colors, Empty, Field, ListRow, Screen, SectionTitle, Segmented, TotalLine } from '../components/ui';
import { createInvoice, findByBarcode, saveProduct, type Party, type PayMethod, type Product } from '../lib/db';
import { centsToInput, money, parseMoney, parseQty } from '../lib/money';

type Draft = {
  product_id: string | null; // null = brand new product
  name: string;
  barcode: string | null;
  qtyText: string;
  costText: string;
  priceText: string;
  onHand: number;
};

type Item = {
  product_id: string | null;
  name: string;
  barcode: string | null;
  qty: number;
  cost: number;
  price: number;
};

export default function Receive() {
  const db = useSQLiteContext();
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState<'product' | 'supplier' | null>(null);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [paidText, setPaidText] = useState('');
  const [saving, setSaving] = useState(false);

  const total = items.reduce((s, i) => s + i.qty * i.cost, 0);
  const paid = paidText.trim() === '' ? total : parseMoney(paidText);
  const owed = total - (isNaN(paid) ? 0 : paid);

  const startDraft = (p: Product | null, barcode: string | null) => {
    setDraft(
      p
        ? {
            product_id: p.id,
            name: p.name,
            barcode: p.barcode,
            qtyText: '',
            costText: centsToInput(p.cost),
            priceText: centsToInput(p.price),
            onHand: p.qty,
          }
        : { product_id: null, name: '', barcode, qtyText: '', costText: '', priceText: '', onHand: 0 },
    );
  };

  const onScanned = async (code: string) => {
    setScanning(false);
    const existing = items.find((i) => i.barcode === code);
    if (existing) {
      return Alert.alert('Already in this list', `${existing.name} is already added. Remove it from the list to change it.`);
    }
    startDraft(await findByBarcode(db, code), code);
  };

  const addDraft = () => {
    if (!draft) return;
    const qty = parseQty(draft.qtyText);
    const cost = parseMoney(draft.costText);
    const price = parseMoney(draft.priceText);
    if (!draft.name.trim()) return Alert.alert('Name required', 'What is this product called?');
    if (qty <= 0) return Alert.alert('Quantity required', 'How many did you buy?');
    if (isNaN(cost)) return Alert.alert('Cost required', 'What did you pay for each one?');
    if (draft.product_id == null && isNaN(price)) return Alert.alert('Selling price required', 'What will you sell each one for?');
    setItems((prev) => [
      ...prev,
      { product_id: draft.product_id, name: draft.name.trim(), barcode: draft.barcode, qty, cost, price: isNaN(price) ? 0 : price },
    ]);
    setDraft(null);
  };

  const save = async () => {
    if (items.length === 0) return Alert.alert('Nothing to save', 'Scan the items you bought first.');
    if (isNaN(paid) || paid < 0) return Alert.alert('Check amount paid');
    if (owed > 0 && !supplier) {
      return Alert.alert('Supplier needed', 'You still owe money on this purchase. Choose a supplier to track what you owe.', [
        { text: 'OK', onPress: () => setPicking('supplier') },
      ]);
    }
    setSaving(true);
    try {
      const lines = [];
      for (const it of items) {
        let productId = it.product_id;
        if (productId == null) {
          productId = await saveProduct(db, { name: it.name, barcode: it.barcode, cost: it.cost, price: it.price, qty: 0, low_stock: 3 });
        }
        lines.push({
          product_id: productId,
          name: it.name,
          barcode: it.barcode,
          qty: it.qty,
          unit_price: it.cost,
          unit_cost: it.cost,
          new_sell_price: it.product_id != null ? it.price : undefined,
        });
      }
      const id = await createInvoice(db, {
        kind: 'purchase',
        party_id: supplier?.id ?? null,
        lines,
        taxRate: 0,
        paid,
        method,
      });
      router.replace(`/invoice/${id}`);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {draft ? (
        <Card style={{ borderColor: colors.primary, borderWidth: 2 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 4 }}>{draft.product_id ? draft.name : 'New product'}</Text>
          <Text style={{ color: colors.muted, marginBottom: 12 }}>
            {draft.barcode ? `Barcode ${draft.barcode}` : 'No barcode'}
            {draft.product_id ? ` · ${draft.onHand} on hand now` : ''}
          </Text>
          {draft.product_id == null && (
            <Field label="Product name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} autoFocus placeholder="e.g. Mini Lava Lamp" />
          )}
          <Field
            label="Quantity bought"
            value={draft.qtyText}
            onChangeText={(qtyText) => setDraft({ ...draft, qtyText })}
            keyboardType="number-pad"
            placeholder="0"
            autoFocus={draft.product_id != null}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field
              label="Cost each"
              value={draft.costText}
              onChangeText={(costText) => setDraft({ ...draft, costText })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={{ flex: 1 }}
            />
            <Field
              label="Sell price each"
              value={draft.priceText}
              onChangeText={(priceText) => setDraft({ ...draft, priceText })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={{ flex: 1 }}
            />
          </View>
          {parseQty(draft.qtyText) > 0 && !isNaN(parseMoney(draft.costText)) && (
            <Text style={{ fontWeight: '600', marginBottom: 12 }}>Line total: {money(parseQty(draft.qtyText) * parseMoney(draft.costText))}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Cancel" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button title="Add to list" icon="add" onPress={addDraft} style={{ flex: 1.5 }} />
          </View>
        </Card>
      ) : (
        <>
          <Button title={items.length ? 'Scan next item' : 'Scan item'} icon="scan" onPress={() => setScanning(true)} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 14 }}>
            <Button title="Existing product" small variant="secondary" icon="search" onPress={() => setPicking('product')} style={{ flex: 1 }} />
            <Button title="No barcode" small variant="secondary" icon="add" onPress={() => startDraft(null, null)} style={{ flex: 1 }} />
          </View>
        </>
      )}

      <SectionTitle>Items received ({items.length})</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        {items.length === 0 ? (
          <Empty icon="download-outline" text="Scan each product you bought, then enter how many and what you paid." />
        ) : (
          items.map((it, idx) => (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ListRow
                  title={`${it.name}${it.product_id == null ? ' (new)' : ''}`}
                  subtitle={`${it.qty} × ${money(it.cost)} · sells ${money(it.price)}`}
                  right={money(it.qty * it.cost)}
                />
              </View>
              <Pressable onPress={() => setItems(items.filter((_, i) => i !== idx))} hitSlop={10} style={{ paddingLeft: 10 }} accessibilityLabel="Remove">
                <Ionicons name="close-circle" size={24} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
      </Card>

      {items.length > 0 && (
        <>
          <Card>
            <TotalLine label="Purchase total" value={money(total)} strong />
          </Card>

          <SectionTitle>Supplier</SectionTitle>
          <Pressable onPress={() => setPicking('supplier')}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="business-outline" size={22} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '600' }}>{supplier ? supplier.name : 'No supplier (paid in full)'}</Text>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Change</Text>
            </Card>
          </Pressable>

          <SectionTitle>Payment</SectionTitle>
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'card', label: 'Card' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Field
            label="Amount you paid"
            value={paidText}
            onChangeText={setPaidText}
            keyboardType="decimal-pad"
            placeholder={`${centsToInput(total)} (paid in full)`}
            hint="Leave blank if paid in full. Enter 0 if bought on credit."
          />
          {owed > 0 && (
            <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warnSoft }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.warn }}>You will owe {money(owed)}</Text>
              <Text style={{ color: colors.warn }}>{supplier ? `Added to ${supplier.name}'s balance.` : 'Choose a supplier above.'}</Text>
            </Card>
          )}
          <Button title="Save & add to inventory" icon="checkmark-circle" onPress={save} loading={saving} />
        </>
      )}

      <Scanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} title="Scan purchased item" />
      <ProductPicker
        visible={picking === 'product'}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          setPicking(null);
          startDraft(p, p.barcode);
        }}
      />
      <PartyPicker
        visible={picking === 'supplier'}
        type="supplier"
        allowNone="No supplier"
        onClose={() => setPicking(null)}
        onPick={(p) => {
          setSupplier(p);
          setPicking(null);
        }}
      />
    </Screen>
  );
}
