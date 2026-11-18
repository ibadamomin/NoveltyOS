import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listParties, listProducts, saveParty, getParty, type Party, type PartyType, type Product } from '../lib/db';
import { money } from '../lib/money';
import { Button, colors, Empty, Field, ListRow, SearchBox } from './ui';

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? insets.top : 0 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close-circle" size={30} color={colors.muted} />
          </Pressable>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: insets.bottom }}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type PartyPickerProps = {
  visible: boolean;
  type: PartyType;
  onClose: () => void;
  onPick: (p: Party | null) => void;
  allowNone?: string;
};

export function PartyPicker(props: PartyPickerProps) {
  return (
    <Sheet visible={props.visible} title={`Choose ${props.type}`} onClose={props.onClose}>
      {props.visible && <PartyPickerBody {...props} />}
    </Sheet>
  );
}

function PartyPickerBody({ type, onPick, allowNone }: PartyPickerProps) {
  const db = useSQLiteContext();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Party[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const label = type === 'customer' ? 'customer' : 'supplier';

  useEffect(() => {
    listParties(db, type, search).then(setRows);
  }, [db, type, search]);

  const create = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const id = await saveParty(db, { type, name, phone, opening_balance: 0 });
    const p = await getParty(db, id);
    setName('');
    setPhone('');
    setAdding(false);
    if (p) onPick(p);
  };

  return (
    <>
      {adding ? (
        <View>
          <Field label="Name" value={name} onChangeText={setName} autoFocus placeholder={`${label} name`} />
          <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Button title={`Save ${label}`} icon="checkmark" onPress={create} />
          <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} style={{ marginTop: 8 }} />
        </View>
      ) : (
        <>
          <SearchBox value={search} onChangeText={setSearch} placeholder={`Search ${label}s`} />
          <Button title={`New ${label}`} icon="person-add" variant="secondary" onPress={() => { setName(search); setAdding(true); }} style={{ marginBottom: 12 }} />
          {allowNone && (
            <ListRow title={allowNone} icon="walk-outline" onPress={() => onPick(null)} />
          )}
          <FlatList
            data={rows}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={item.phone || undefined}
                right={item.balance ? money(item.balance) : undefined}
                rightSub={item.balance ? (type === 'customer' ? 'owes you' : 'you owe') : undefined}
                rightColor={item.balance > 0 ? colors.warn : undefined}
                icon="person-outline"
                onPress={() => onPick(item)}
              />
            )}
            ListEmptyComponent={<Empty icon="people-outline" text={`No ${label}s yet`} />}
          />
        </>
      )}
    </>
  );
}

type ProductPickerProps = { visible: boolean; onClose: () => void; onPick: (p: Product) => void };

export function ProductPicker(props: ProductPickerProps) {
  return (
    <Sheet visible={props.visible} title="Find product" onClose={props.onClose}>
      {props.visible && <ProductPickerBody {...props} />}
    </Sheet>
  );
}

function ProductPickerBody({ onPick }: ProductPickerProps) {
  const db = useSQLiteContext();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Product[]>([]);

  useEffect(() => {
    listProducts(db, search).then(setRows);
  }, [db, search]);

  return (
    <>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Name or barcode" autoFocus />
      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.qty} in stock${item.barcode ? ` · ${item.barcode}` : ''}`}
            right={money(item.price)}
            icon="cube-outline"
            onPress={() => onPick(item)}
          />
        )}
        ListEmptyComponent={<Empty icon="cube-outline" text="No products found" />}
      />
    </>
  );
}
