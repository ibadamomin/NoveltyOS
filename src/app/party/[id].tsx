import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, colors, Field, ListRow, Screen, SectionTitle, Segmented } from '../../components/ui';
import {
  deleteParty,
  deletePayment,
  getParty,
  partyLedger,
  recordPayment,
  saveParty,
  type LedgerEntry,
  type Party,
  type PartyType,
  type PayMethod,
} from '../../lib/db';
import { buildStatementHtml, shareDocument } from '../../lib/documents';
import { centsToInput, formatDate, money, parseMoney } from '../../lib/money';
import { useSettings } from '../../lib/settings-context';
import { useDataVersion } from '../../lib/use-data-version';

export default function PartyScreen() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const version = useDataVersion();
  const params = useLocalSearchParams<{ id: string; type?: PartyType }>();
  const isNew = params.id === 'new';
  const id = isNew ? undefined : params.id;

  const [party, setParty] = useState<Party | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [opening, setOpening] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [note, setNote] = useState('');

  const type: PartyType = party?.type ?? params.type ?? 'customer';
  const isCustomer = type === 'customer';
  const label = isCustomer ? 'Customer' : 'Supplier';

  const load = useCallback(async () => {
    if (!id) return;
    const p = await getParty(db, id);
    setParty(p);
    if (p) {
      setName(p.name);
      setPhone(p.phone);
      setOpening(centsToInput(p.opening_balance));
    }
    setLedger(await partyLedger(db, id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, id, version]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const saveDetails = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const ob = opening.trim() ? parseMoney(opening) : 0;
    if (isNaN(ob)) return Alert.alert('Check the starting balance');
    const newId = await saveParty(db, { id, type, name, phone, opening_balance: ob });
    if (isNew) router.replace(`/party/${newId}`);
    else {
      setEditing(false);
      load();
    }
  };

  const pay = async () => {
    const cents = parseMoney(amount);
    if (isNaN(cents) || cents <= 0) return Alert.alert('Enter an amount');
    await recordPayment(db, { party_id: id!, direction: isCustomer ? 'in' : 'out', amount: cents, method, note });
    setAmount('');
    setNote('');
    await load();
    Alert.alert('Payment recorded', `${money(cents)} ${isCustomer ? 'received from' : 'paid to'} ${name}.`);
  };

  const onLedgerPress = (e: LedgerEntry) => {
    if (e.type === 'invoice') return router.push(`/invoice/${e.id}`);
    Alert.alert('Payment', `${money(e.credit)} on ${formatDate(e.date)}`, [
      { text: 'Close' },
      {
        text: 'Delete payment',
        style: 'destructive',
        onPress: async () => {
          await deletePayment(db, e.id);
          load();
        },
      },
    ]);
  };

  const remove = () =>
    Alert.alert(`Delete ${label.toLowerCase()}?`, 'Their payments are deleted. Invoices are kept but no longer linked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteParty(db, id!);
          router.back();
        },
      },
    ]);

  const shareStatement = async () => {
    if (!party) return;
    try {
      await shareDocument(buildStatementHtml(settings, party, ledger), 'invoice');
    } catch (e) {
      Alert.alert('Could not create statement', String(e));
    }
  };

  if (editing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: isNew ? `New ${label}` : `Edit ${label}` }} />
        <Card>
          <Field label="Name" value={name} onChangeText={setName} autoFocus={isNew} />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field
            label="Starting balance"
            value={opening}
            onChangeText={setOpening}
            keyboardType="decimal-pad"
            placeholder="0.00"
            hint={
              isCustomer
                ? 'Anything they already owed you before using this app.'
                : 'Anything you already owed them before using this app.'
            }
          />
        </Card>
        <Button title="Save" icon="checkmark" onPress={saveDetails} />
        {!isNew && <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={{ marginTop: 8 }} />}
      </Screen>
    );
  }

  if (!party) return <Screen>{null}</Screen>;

  const bal = party.balance;
  return (
    <Screen>
      <Stack.Screen options={{ title: party.name }} />
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.muted, fontWeight: '600' }}>
          {bal > 0 ? (isCustomer ? 'Owes you' : 'You owe') : bal < 0 ? 'Credit balance' : 'All settled'}
        </Text>
        <Text style={{ fontSize: 36, fontWeight: '800', color: bal > 0 ? (isCustomer ? colors.warn : colors.danger) : colors.good }}>
          {money(Math.abs(bal))}
        </Text>
        {party.phone ? <Text style={{ color: colors.muted }}>{party.phone}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button title="Edit" small variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
          <Button title="Statement" small variant="secondary" icon="share-outline" onPress={shareStatement} />
        </View>
      </Card>

      <SectionTitle>{isCustomer ? 'Receive a payment' : 'Make a payment'}</SectionTitle>
      <Card>
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'card', label: 'Card' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        {bal > 0 && (
          <Button title={`Full balance: ${money(bal)}`} small variant="ghost" onPress={() => setAmount(centsToInput(bal))} style={{ marginTop: -8, marginBottom: 8 }} />
        )}
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. paid at pickup" />
        <Button title={isCustomer ? 'Record payment received' : 'Record payment made'} icon="cash-outline" onPress={pay} />
      </Card>

      <SectionTitle>History</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        {party.opening_balance !== 0 && (
          <ListRow title="Starting balance" subtitle={formatDate(party.created_at)} right={money(party.opening_balance)} />
        )}
        {ledger.length === 0 ? (
          <Text style={{ color: colors.muted, padding: 12 }}>No activity yet.</Text>
        ) : (
          ledger.map((e) => (
            <ListRow
              key={`${e.type}-${e.id}`}
              icon={e.type === 'invoice' ? 'document-text-outline' : 'cash-outline'}
              title={e.label}
              subtitle={`${formatDate(e.date)}${e.type === 'invoice' ? ` · paid ${money(e.credit)}` : ` · ${e.method}`}`}
              right={e.type === 'invoice' ? money(e.charge) : `-${money(e.credit)}`}
              rightColor={e.type === 'payment' ? colors.good : undefined}
              onPress={() => onLedgerPress(e)}
            />
          ))
        )}
      </Card>
      <Button title={`Delete ${label.toLowerCase()}`} variant="danger" icon="trash-outline" onPress={remove} />
    </Screen>
  );
}
