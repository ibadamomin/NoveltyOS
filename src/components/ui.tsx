import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

// Brand colours from the noveltyOS logo (navy outline, teal & orange arrows, tan box).
export const brand = {
  navy: '#0E2E4B',
  teal: '#27A19F',
  orange: '#EE8733',
  tan: '#E1B479',
  paper: '#F5F7F6',
};

export const colors = {
  primary: brand.navy,
  primaryDark: '#0A2238',
  primarySoft: '#DDF1EF', // light tint of the logo teal
  accent: '#187A78', // logo teal, darkened so white text on it stays readable (5:1)
  bg: brand.paper,
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  warn: '#b45309',
  warnSoft: '#fef3c7',
  good: '#15803d',
  goodSoft: '#dcfce7',
};

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Keyboard "Done" bar (iPhone). Number keyboards on iOS have no return key, so every
// text field gets a bar above the keyboard with a Done button that hides it.
// Android keyboards have their own hide key, so nothing is shown there.
// ---------------------------------------------------------------------------

const KeyboardBarContext = createContext('keyboard-done');

/** The id text inputs should pass as `inputAccessoryViewID` (undefined off iOS). */
export function useKeyboardBarId() {
  const id = useContext(KeyboardBarContext);
  return Platform.OS === 'ios' ? id : undefined;
}

export function KeyboardDoneBar({ nativeID = 'keyboard-done' }: { nativeID?: string }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.kbBar}>
        <Pressable
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Hide keyboard"
          style={({ pressed }) => [styles.kbDone, pressed && { opacity: 0.5 }]}
        >
          <Text style={styles.kbDoneText}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** Use inside pop-up screens (Modals), which need their own Done bar. */
export function KeyboardScope({ id, children }: { id: string; children: ReactNode }) {
  return (
    <KeyboardBarContext.Provider value={id}>
      {children}
      <KeyboardDoneBar nativeID={id} />
    </KeyboardBarContext.Provider>
  );
}

/** Swiping down on a screen hides the keyboard. */
export const keyboardDismissMode = Platform.OS === 'ios' ? ('interactive' as const) : ('on-drag' as const);

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[styles.screen, styles.screenPad]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenPad, { paddingBottom: 48 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={keyboardDismissMode}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  small?: boolean;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 18 : 22} color={v.fg} />}
          <Text style={[styles.buttonText, small && { fontSize: 15 }, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
  accent: { bg: colors.accent, fg: '#fff', border: colors.accent },
  secondary: { bg: '#fff', fg: colors.primary, border: colors.primary },
  danger: { bg: '#fff', fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Field({
  label,
  hint,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string; style?: ViewStyle }) {
  const keyboardBarId = useKeyboardBarId();
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor="#9ca3af" style={styles.input} inputAccessoryViewID={keyboardBarId} {...input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.segmentText, active && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  rightSub,
  rightColor,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  rightSub?: string;
  rightColor?: string;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && onPress && { backgroundColor: '#f9fafb' }]}>
      {icon && (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {right ? <Text style={[styles.rowRight, rightColor ? { color: rightColor } : null]}>{right}</Text> : null}
        {rightSub ? <Text style={styles.rowSub}>{rightSub}</Text> : null}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={18} color="#c4c4c4" style={{ marginLeft: 6 }} />}
    </Pressable>
  );
}

export function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color="#c4c4c4" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'danger' }) {
  const toneColor = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : tone === 'danger' ? colors.danger : colors.text;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: toneColor }]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function TotalLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalLine}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

export function SearchBox(props: TextInputProps) {
  const keyboardBarId = useKeyboardBarId();
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.muted} />
      <TextInput
        placeholderTextColor="#9ca3af"
        style={{ flex: 1, fontSize: 16, paddingVertical: 10, color: colors.text }}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="done"
        inputAccessoryViewID={keyboardBarId}
        {...props}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenPad: { padding: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 8 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: 12 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  segment: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 10, padding: 3, marginBottom: 14 },
  segmentItem: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 60,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowRight: { fontSize: 16, fontWeight: '700', color: colors.text },
  empty: { alignItems: 'center', padding: 32, gap: 8 },
  emptyText: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 16, color: colors.muted },
  totalValue: { fontSize: 16, color: colors.text, fontWeight: '600' },
  totalStrong: { fontSize: 20, fontWeight: '800', color: colors.text },
  kbBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: '#F1F3F5',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C7CBD1',
  },
  kbDone: { paddingHorizontal: 18, height: 44, justifyContent: 'center' },
  kbDoneText: { fontSize: 17, fontWeight: '700', color: colors.primary },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
});
