import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { borderWidth, colors, layout, radii, spacing, typography } from '@/theme';
import { AppText } from './AppText';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  help?: string;
  error?: string;
};

export function TextField({ label, help, error, onFocus, onBlur, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.borderSubtle;
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
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, { borderColor }]}
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
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    color: colors.text,
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.lg,
  },
});
