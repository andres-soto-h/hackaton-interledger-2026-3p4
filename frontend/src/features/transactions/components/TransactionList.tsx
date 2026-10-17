import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { AppText, Button, EmptyState, ErrorState } from '@/ui';
import type { Transaction } from '../types';
import { TransactionItem } from './TransactionItem';

type Props = {
  items: Transaction[];
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  hasMore: boolean;
  fetchingMore: boolean;
  onEndReached: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onPayService: () => void;
  header?: React.ReactElement;
};

export function TransactionList(props: Props) {
  const { items, loading, error, refreshing, hasMore, fetchingMore } = props;
  let body: React.ReactElement | null = null;
  if (loading) body = <AppText color="textMuted">Cargando sus pagos…</AppText>;
  else if (error && items.length === 0) {
    body = <ErrorState message="No pudimos cargar sus pagos." onRetry={props.onRetry} retryLabel="Reintentar" />;
  } else if (items.length === 0) {
    body = (
      <View style={styles.empty}>
        <EmptyState message="Todavía no ha hecho pagos" />
        <Button label="Pagar un servicio" onPress={props.onPayService} />
      </View>
    );
  }

  return (
    <FlatList
      testID="transaction-list"
      data={body ? [] : items}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => <TransactionItem transaction={item} onPress={props.onOpen} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      ListHeaderComponent={props.header}
      ListEmptyComponent={body ?? undefined}
      ListFooterComponent={
        fetchingMore ? (
          <AppText color="textMuted">Cargando más…</AppText>
        ) : error && items.length > 0 && hasMore ? (
          <Button label="Reintentar" variant="secondary" onPress={props.onEndReached} />
        ) : undefined
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => hasMore && !fetchingMore && props.onEndReached()}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={props.onRefresh} />}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.xl },
  empty: { gap: spacing.lg },
});
