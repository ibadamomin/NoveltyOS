import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brand, Button, colors } from './ui';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Return a short message to flash on screen (e.g. "Added Slime Jar"). */
  onScanned: (code: string) => void | string | Promise<void | string>;
  /** Keep the camera open after each scan (fast checkout). */
  continuous?: boolean;
  title?: string;
};

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr', 'datamatrix', 'pdf417'] as const;

export function Scanner(props: Props) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose} presentationStyle="fullScreen">
      {props.visible && <ScannerBody {...props} />}
    </Modal>
  );
}

function ScannerBody({ onClose, onScanned, continuous, title = 'Scan barcode' }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const insets = useSafeAreaInsets();


  const handle = async (raw: string, fromCamera: boolean) => {
    const code = raw.trim();
    if (!code || busy.current) return;
    const t = Date.now();
    // The camera reports the same code many times a second while it stays in view.
    // Ignore those repeats, but never a deliberate second scan or typed entry.
    if (fromCamera && code === last.current.code && t - last.current.at < 1200) {
      last.current.at = t;
      return;
    }
    last.current = { code, at: t };
    busy.current = true;
    try {
      const msg = await onScanned(code);
      if (continuous) {
        setFlash(msg || `Scanned ${code}`);
        setTimeout(() => setFlash(null), 1500);
      }
    } finally {
      // In single mode the parent closes the scanner; stay locked to avoid double fires.
      if (continuous) busy.current = false;
    }
  };

  const onBarcode = (r: BarcodeScanningResult) => handle(r.data, true);

  return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close scanner">
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={() => setTorch((v) => !v)} hitSlop={12} accessibilityLabel="Toggle flashlight">
            <Ionicons name={torch ? 'flash' : 'flash-outline'} size={26} color="#fff" />
          </Pressable>
        </View>

        <View style={s.cameraBox}>
          {!permission ? null : permission.granted ? (
            <>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                onBarcodeScanned={onBarcode}
              />
              <View style={s.frame} pointerEvents="none" />
            </>
          ) : (
            <View style={s.permission}>
              <Ionicons name="camera-outline" size={48} color="#fff" />
              <Text style={s.permissionText}>Camera access is needed to scan barcodes.</Text>
              <Button title="Allow camera" onPress={requestPermission} />
            </View>
          )}
          {flash && (
            <View style={s.flash}>
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={s.flashText} numberOfLines={2}>
                {flash}
              </Text>
            </View>
          )}
        </View>

        <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={s.manualLabel}>No barcode or won&apos;t scan? Type it:</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="Enter code"
              placeholderTextColor="#9ca3af"
              style={s.manualInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                handle(manual, false);
                setManual('');
              }}
            />
            <Button
              title="Use"
              small
              onPress={() => {
                handle(manual, false);
                setManual('');
              }}
              disabled={!manual.trim()}
            />
          </View>
          {continuous && <Button title="Done scanning" variant="secondary" onPress={onClose} style={{ marginTop: 12 }} />}
        </View>
      </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cameraBox: { flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  frame: { width: '78%', height: 180, borderWidth: 3, borderColor: brand.teal, borderRadius: 16 },
  permission: { alignItems: 'center', gap: 16, padding: 24 },
  permissionText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  flash: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flashText: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  bottom: { backgroundColor: '#fff', padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  manualLabel: { color: colors.muted, marginBottom: 8, fontSize: 14 },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 17,
    minHeight: 44,
    color: colors.text,
  },
});
