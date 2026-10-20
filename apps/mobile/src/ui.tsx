import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

export const colors = {
  brand: '#077b74',
  brandLight: '#e7f7f6',
  text: '#1a1b1e',
  dimmed: '#6b7280',
  border: '#d1d5db',
  danger: '#c92a2a',
  dangerLight: '#fff0f0',
  warning: '#e67700',
  warningLight: '#fff9db',
  success: '#2b8a3e',
  background: '#f8f9fa',
};

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled: disabled || loading }}
    onPress={onPress}
    disabled={disabled || loading}
    style={({ pressed }) => [
      styles.button,
      variant === 'secondary' && styles.buttonSecondary,
      variant === 'danger' && styles.buttonDanger,
      (disabled || pressed) && { opacity: 0.6 },
    ]}
  >
    {loading ? (
      <ActivityIndicator
        color={variant === 'secondary' ? colors.brand : '#fff'}
      />
    ) : (
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && { color: colors.brand },
        ]}
      >
        {title}
      </Text>
    )}
  </Pressable>
);

export const Field = ({
  label,
  ...input
}: { label: string } & TextInputProps) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colors.dimmed}
      style={styles.input}
      {...input}
    />
  </View>
);

export const Banner = ({
  tone,
  children,
}: {
  tone: 'danger' | 'warning' | 'info';
  children: ReactNode;
}) => (
  <View
    accessibilityRole="alert"
    style={[
      styles.banner,
      tone === 'danger' && {
        backgroundColor: colors.dangerLight,
        borderColor: colors.danger,
      },
      tone === 'warning' && {
        backgroundColor: colors.warningLight,
        borderColor: colors.warning,
      },
    ]}
  >
    <Text style={{ color: colors.text }}>{children}</Text>
  </View>
);

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centred: { flex: 1, justifyContent: 'center' },
  field: { gap: 6 },
  authContent: { paddingTop: 80 },
  headerContent: { paddingTop: 56, paddingBottom: 8 },
  topContent: { paddingTop: 56 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex1: { flex: 1 },
  gap10: { gap: 10 },
  link: { color: colors.brand, fontWeight: '600' },
  list: { padding: 20, gap: 12 },
  cardTitle: { fontWeight: '700', fontSize: 16, color: colors.text },
  strong: { fontWeight: '600' },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  thumbnail: { width: 90, height: 90, borderRadius: 6 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  brand: { fontSize: 20, fontWeight: '800', color: colors.brand },
  dimmed: { color: colors.dimmed },
  label: { fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
    color: colors.text,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.brand,
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  banner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
});
