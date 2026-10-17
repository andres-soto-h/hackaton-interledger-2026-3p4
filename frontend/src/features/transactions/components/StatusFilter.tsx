import { Pressable, StyleSheet, View } from 'react-native';
import { colors, layout, radii, spacing } from '@/theme';
import { AppText } from '@/ui';
import { STATUS_FILTERS, type StatusFilterId } from '../filters';

type Props = { value: StatusFilterId; onChange: (id: StatusFilterId) => void };

export function StatusFilter({ value, onChange }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {STATUS_FILTERS.map(({ id, label }) => {
        const selected = id === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onChange(id)}
            style={[styles.chip, selected ? styles.chipOn : null]}
          >
            <AppText variant="label" color={selected ? 'surface' : 'primary'}>
              {label}
            </AppText>
          </Pressable>
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
    borderRadius: radii.chip,
    justifyContent: 'center',
    minHeight: layout.minTouch,
    paddingHorizontal: spacing.lg,
  },
  chipOn: { backgroundColor: colors.primary },
});
