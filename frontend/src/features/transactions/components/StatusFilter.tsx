import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { AppText, PressableScale } from '@/ui';
import { STATUS_FILTERS } from '../filters';

type Option = { id: string; label: string };
type Props<T extends string> = {
  value: T;
  onChange: (id: T) => void;
  options?: Option[];
};

/** Selector de un solo valor en chips; por omisión, los filtros de estado de las transacciones. */
export function StatusFilter<T extends string = string>({ value, onChange, options }: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {(options ?? STATUS_FILTERS).map(({ id, label }) => {
        const selected = id === value;
        return (
          <PressableScale
            key={id}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onChange(id as T)}
            haptic="selection"
            scaleTo={0.96}
            style={[styles.chip, selected ? styles.chipOn : null]}
          >
            <AppText variant="label" color={selected ? 'surface' : 'primary'}>
              {label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.borderSubtle,
    borderRadius: radii.chip,
    borderWidth: borderWidth.hairline,
    justifyContent: 'center',
    minHeight: layout.minTouch,
    paddingHorizontal: spacing.lg,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
