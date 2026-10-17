import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, layout, radii, spacing, typography } from '@/theme';
import { AppText } from './AppText';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  help?: string;
  error?: string;
};

export function TextField({ label, help, error, ...input }: Props) {
  return (
    <View style={styles.wrapper}>
      <AppText variant="label" color="textMuted">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={help}
        accessibilityState={{ disabled: input.editable === false }}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, error ? styles.inputError : null]}
        {...input}
      />
      {help && !error ? (
        <AppText variant="caption" color="textMuted">
          {help}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="label" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.button,
    borderWidth: 2,
    color: colors.text,
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.lg,
  },
  inputError: { borderColor: colors.danger },
});
