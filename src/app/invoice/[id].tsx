import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, colors, ListRow, Screen, SectionTitle, TotalLine } from '../../components/ui';
import { getInvoice, invoiceNumber, partyBalance, voidInvoice, type Invoice, type InvoiceItem } from '../../lib/db';
import { buildDocumentHtml, printDocument, shareDocument, type DocStyle } from '../../lib/documents';
import { formatDateTime, money } from '../../lib/money';
import { useSettings } from '../../lib/settings-context';

export default function InvoiceScreen() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<{ invoice: Invoice; items: InvoiceItem[] } | null>(null);
  const [acctBalance, setAcctBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getInvoice(db, id).then(async (d) => {
      setData(d);
      if (d?.invoice.party_id) setAcctBalance(await partyBalance(db, d.invoice.party_id));
    });
  }, [db, id]);

  if (!data) return <Screen>{null}</Screen>;
  const { invoice: inv, items } = data;
  const isSale = inv.kind === 'sale';
  const due = inv.total - inv.paid;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', String(e));
    } finally {
      setBusy(null);
    }
  };
  const html = (style: DocStyle) => buildDocumentHtml(style, settings, inv, items, acctBalance);

  const doVoid = () =>
    Alert.alert(
      `Void ${invoiceNumber(inv)}?`,
      isSale
        ? 'The sale is deleted, items go back into stock and any balance is removed from the customer.'
        : 'The purchase is deleted, items are removed from stock and any balance is removed from the supplier.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: async () => {
            await voidInvoice(db, inv.id);
            router.back();
          },
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: invoiceNumber(inv) }} />
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.muted, fontWeight: '600' }}>{isSale ? 'Sale' : 'Purchase'} · {formatDateTime(inv.date)}</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', marginVertical: 4 }}>{money(inv.total)}</Text>
        <Text style={{ fontSize: 16 }}>{inv.party_name ?? (isSale ? 'Walk-in customer' : 'No supplier')}</Text>
        {due > 0 ? (
          <Text style={{ color: colors.warn, fontWeight: '700', marginTop: 6 }}>{money(due)} on account</Text>
        ) : (
          <Text style={{ color: colors.good, fontWeight: '700', marginTop: 6 }}>Paid in full ({inv.method})</Text>
        )}
      </Card>

      {isSale ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Button title="Send invoice" icon="document-text-outline" onPress={() => run('inv', () => shareDocument(html('invoice'), 'invoice'))} loading={busy === 'inv'} style={{ flex: 1 }} small />
            <Button title="Send receipt" icon="receipt-outline" onPress={() => run('rec', () => shareDocument(html('receipt'), 'receipt'))} loading={busy === 'rec'} style={{ flex: 1 }} small />
          </View>
          <Button title="Print receipt" icon="print-outline" variant="secondary" small onPress={() => run('print', () => printDocument(html('receipt')))} loading={busy === 'print'} style={{ marginBottom: 14 }} />
        </>
      ) : (
        <Button title="Share purchase record" icon="share-outline" variant="secondary" small onPress={() => run('inv', () => shareDocument(html('invoice'), 'invoice'))} loading={busy === 'inv'} style={{ marginBottom: 14 }} />
      )}

      <SectionTitle>Items</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        {items.map((it) => (
          <ListRow
            key={it.id}
            title={it.name}
            subtitle={`${it.qty} × ${money(it.unit_price)}`}
            right={money(it.qty * it.unit_price)}
            onPress={it.product_id ? () => router.push(`/product/${it.product_id}`) : undefined}
          />
        ))}
      </Card>
      <Card>
        <TotalLine label="Subtotal" value={money(inv.subtotal)} />
        {inv.tax > 0 && <TotalLine label="Tax" value={money(inv.tax)} />}
        <TotalLine label="Total" value={money(inv.total)} strong />
        <TotalLine label={`Paid (${inv.method})`} value={money(inv.paid)} />
        {due > 0 && <TotalLine label="Balance due" value={money(due)} strong />}
        {acctBalance != null && <TotalLine label={`${inv.party_name}'s account balance now`} value={money(acctBalance)} />}
      </Card>
      {inv.party_id != null && (
        <Button title={`Open ${isSale ? 'customer' : 'supplier'} account`} variant="ghost" onPress={() => router.push(`/party/${inv.party_id}`)} />
      )}
      <Button title="Void this record" variant="danger" icon="close-circle-outline" onPress={doVoid} style={{ marginTop: 8 }} />
    </Screen>
  );
}
