import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMerchants } from '@/features/merchants/hooks';
import { CATEGORY_LABELS, type MerchantCategory } from '@/features/merchants/types';
import { StatusFilter } from '@/features/transactions/components/StatusFilter';
import { spacing } from '@/theme';
import { AppHeader, AppText, EmptyState, MerchantTile, Screen, TextField } from '@/ui';

export default function Directory() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MerchantCategory | undefined>();
  const { merchants } = useMerchants(query, category);

  return (
    <Screen>
      <AppHeader actionLabel="Parar" onAction={() => router.replace('/')} />
      <AppText variant="title" accessibilityRole="header">
        ¿Qué servicio quiere pagar?
      </AppText>
      <TextField label="Buscar por nombre" value={query} onChangeText={setQuery} autoCorrect={false} />
      <CategoryChips value={category} onChange={setCategory} />
      <View style={styles.list}>
        {merchants.length === 0 ? <EmptyState message="No encontramos ese servicio" /> : null}
        {merchants.map((m) => (
          <MerchantTile
            key={m.id}
            name={m.name}
            subtitle={CATEGORY_LABELS[m.category]}
            onPress={() => router.push(`/pagos/${m.id}/datos` as never)}
          />
        ))}
      </View>
    </Screen>
  );
}

function CategoryChips({
  value,
  onChange,
}: {
  value?: MerchantCategory;
  onChange: (c?: MerchantCategory) => void;
}) {
  // Reutiliza el selector de un solo valor del filtro de estados con las categorías.
  const options = [{ id: 'all', label: 'Todos' }, ...Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label }))];
  return (
    <StatusFilter
      options={options}
      value={value ?? 'all'}
      onChange={(id) => onChange(id === 'all' ? undefined : (id as MerchantCategory))}
    />
  );
}

const styles = StyleSheet.create({ list: { gap: spacing.md } });
