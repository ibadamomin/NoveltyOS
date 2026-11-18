import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PartyPicker, ProductPicker } from '../../components/Pickers';
import { Scanner } from '../../components/Scanner';
import { Button, Card, colors, Empty, Field, Screen, SectionTitle, Segmented, TotalLine } from '../../components/ui';
import { createInvoice, findByBarcode, taxRatePercent, type Party, type PayMethod, type Product } from '../../lib/db';
import { centsToInput, money, parseMoney } from '../../lib/money';
import { useSettings } from '../../lib/settings-context';

type Line = {
  product_id: number;
  name: string;
  barcode: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number;
  stock: number;
  priceText: string;
};

export default function Sell() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const [lines, setLinesState] = useState<Line[]>([]);
  // Mirror of the cart so rapid scans always build on the latest version.
  const linesRef = useRef<Line[]>([]);
  const setLines = (next: Line[] | ((prev: Line[]) => Line[])) => {
    linesRef.current = typeof next === 'function' ? next(linesRef.current) : next;
    setLinesState(linesRef.current);
  };
  const [customer, setCustomer] = useState<Party | null>(null);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [receivedText, setReceivedText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState<'product' | 'customer' | null>(null);
  const [saving, setSaving] = useState(false);

  const rate = taxRatePercent(settings);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const tax = Math.round((subtotal * rate) / 100);
  const total = subtotal + tax;
  const received = receivedText.trim() === '' ? total : parseMoney(receivedText);
  const diff = (isNaN(received) ? 0 : received) - total;

  const addProduct = (p: Product): number => {
    const existing = linesRef.current.find((l) => l.product_id === p.id);
    const newQty = (existing?.qty ?? 0) + 1;
    setLines((prev) => {
      if (existing) return prev.map((l) => (l.product_id === p.id ? { ...l, qty: newQty } : l));
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          barcode: p.barcode,
          qty: 1,
          unit_price: p.price,
          unit_cost: p.cost,
          stock: p.qty,
          priceText: centsToInput(p.price),
        },
      ];
    });
    return newQty;
  };

  const onScanned = async (code: string) => {
    const p = await findByBarcode(db, code);
    if (!p) {
      setScanning(false);
      Alert.alert('Not in inventory', `No product has barcode ${code}. Add it now?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add product', onPress: () => router.push({ pathname: '/product/[id]', params: { id: 'new', barcode: code } }) },
      ]);
      return;
    }
    const qty = addProduct(p);
    return `${p.name} — ${money(p.price)}${qty > 1 ? `  (×${qty} in cart)` : ''}`;
  };

  const setQty = (id: number, qty: number) =>
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.product_id !== id) : prev.map((l) => (l.product_id === id ? { ...l, qty } : l))));

  const setPrice = (id: number, text: string) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.product_id !== id) return l;
        const cents = parseMoney(text);
        return { ...l, priceText: text, unit_price: isNaN(cents) ? 0 : cents };
      }),
    );

  const reset = () => {
    setLines([]);
    setCustomer(null);
    setMethod('cash');
    setReceivedText('');
  };

  const complete = async () => {
    if (lines.length === 0) return Alert.alert('Cart is empty', 'Scan or add at least one item.');
    if (isNaN(received) || received < 0) return Alert.alert('Check amount received');
    if (diff < 0 && !customer) {
      return Alert.alert('Customer needed', 'Part of this sale is unpaid. Choose a customer so the balance goes on their account.', [
        { text: 'OK', onPress: () => setPicking('customer') },
      ]);
    }
    const short = lines.filter((l) => l.qty > l.stock);
    if (short.length) {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Low stock',
          `${short.map((l) => `${l.name}: selling ${l.qty}, have ${l.stock}`).join('\n')}\n\nSell anyway? Stock will go negative until you receive more.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Sell anyway', onPress: () => resolve(true) },
          ],
        ),
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Walk-in overpayment is change handed back, not money kept.
      const paid = customer ? received : Math.min(received, total);
      const id = await createInvoice(db, {
        kind: 'sale',
        party_id: customer?.id ?? null,
        lines,
        taxRate: rate,
        paid,
        method,
      });
      reset();
      router.push(`/invoice/${id}`);
    } catch (e) {
      Alert.alert('Could not save sale', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        <Button title="Scan items" icon="scan" onPress={() => setScanning(true)} style={{ flex: 1.4 }} />
        <Button title="Search" icon="search" variant="secondary" onPress={() => setPicking('product')} style={{ flex: 1 }} />
      </View>

      <Card style={{ paddingVertical: 4 }}>
        {lines.length === 0 ? (
          <Empty icon="cart-outline" text="Scan a barcode to start a sale" />
        ) : (
          lines.map((l) => (
            <View key={l.product_id} style={s.line}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineName} numberOfLines={2}>
                  {l.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <Text style={{ color: colors.muted }}>{settings.currency}</Text>
                  <TextInput
                    value={l.priceText}
                    onChangeText={(t) => setPrice(l.product_id, t)}
                    keyboardType="decimal-pad"
                    style={s.priceInput}
                    placeholder="0.00"
                    selectTextOnFocus
                  />
                  <Text style={{ color: colors.muted }}>each</Text>
                </View>
                {l.qty > l.stock && <Text style={{ color: colors.danger, fontSize: 12, marginTop: 2 }}>Only {l.stock} in stock</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={s.lineTotal}>{money(l.qty * l.unit_price)}</Text>
                <View style={s.stepper}>
                  <Pressable onPress={() => setQty(l.product_id, l.qty - 1)} hitSlop={8} style={s.stepBtn} accessibilityLabel="Decrease">
                    <Ionicons name={l.qty === 1 ? 'trash-outline' : 'remove'} size={20} color={l.qty === 1 ? colors.danger : colors.primary} />
                  </Pressable>
                  <Text style={s.qty}>{l.qty}</Text>
                  <Pressable onPress={() => setQty(l.product_id, l.qty + 1)} hitSlop={8} style={s.stepBtn} accessibilityLabel="Increase">
                    <Ionicons name="add" size={20} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>

      {lines.length > 0 && (
        <>
          <Card>
            <TotalLine label="Subtotal" value={money(subtotal)} />
            {rate > 0 && <TotalLine label={`Tax (${rate}%)`} value={money(tax)} />}
            <TotalLine label="Total" value={money(total)} strong />
          </Card>

          <SectionTitle>Customer</SectionTitle>
          <Pressable onPress={() => setPicking('customer')}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name={customer ? 'person' : 'walk-outline'} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600' }}>{customer ? customer.name : 'Walk-in customer'}</Text>
                {customer && customer.balance !== 0 && (
                  <Text style={{ color: colors.warn, fontSize: 13 }}>Current balance: {money(customer.balance)}</Text>
                )}
              </View>
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
            label="Amount received"
            value={receivedText}
            onChangeText={setReceivedText}
            keyboardType="decimal-pad"
            placeholder={`${centsToInput(total) || '0.00'} (exact)`}
            hint="Leave blank if paid in full. Enter 0 to put the whole sale on account."
          />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <Button title="Paid in full" small variant="secondary" onPress={() => setReceivedText('')} style={{ flex: 1 }} />
            <Button title="All on account" small variant="secondary" onPress={() => setReceivedText('0')} style={{ flex: 1 }} />
          </View>

          {diff > 0 && (
            <Card style={{ backgroundColor: colors.goodSoft, borderColor: colors.goodSoft }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.good }}>
                {customer ? `${money(diff)} extra goes toward their balance` : `Give change: ${money(diff)}`}
              </Text>
            </Card>
          )}
          {diff < 0 && (
            <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warnSoft }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.warn }}>{money(-diff)} goes on account</Text>
              <Text style={{ color: colors.warn }}>{customer ? `${customer.name} will owe this.` : 'Choose a customer above.'}</Text>
            </Card>
          )}

          <Button title={`Complete sale · ${money(total)}`} icon="checkmark-circle" onPress={complete} loading={saving} />
          <Button
            title="Clear cart"
            variant="ghost"
            onPress={() => Alert.alert('Clear cart?', '', [{ text: 'Keep' }, { text: 'Clear', style: 'destructive', onPress: reset }])}
            style={{ marginTop: 8 }}
          />
        </>
      )}

      <Scanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} continuous title="Scan to sell" />
      <ProductPicker
        visible={picking === 'product'}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          addProduct(p);
          setPicking(null);
        }}
      />
      <PartyPicker
        visible={picking === 'customer'}
        type="customer"
        allowNone="Walk-in customer"
        onClose={() => setPicking(null)}
        onPick={(p) => {
          setCustomer(p);
          setPicking(null);
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 10 },
  lineName: { fontSize: 16, fontWeight: '600', color: colors.text },
  lineTotal: { fontSize: 16, fontWeight: '700', color: colors.text },
  priceInput: { borderBottomWidth: 1, borderColor: '#d1d5db', minWidth: 64, fontSize: 15, paddingVertical: 2, color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 20 },
  stepBtn: { padding: 8 },
  qty: { minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '700' },
});
