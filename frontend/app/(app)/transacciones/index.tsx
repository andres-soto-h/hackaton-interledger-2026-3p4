import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusFilter } from '@/features/transactions/components/StatusFilter';
import { TransactionList } from '@/features/transactions/components/TransactionList';
import { statusForFilter, type StatusFilterId } from '@/features/transactions/filters';
import { useTransactions } from '@/features/transactions/hooks';
import { colors, layout, spacing } from '@/theme';
import { AppHeader, AppText } from '@/ui';

export default function Transactions() {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilterId>('all');
  const query = useTransactions({ status: statusForFilter(filter) });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.column}>
        <TransactionList
          items={items}
          loading={query.isLoading}
          error={query.isError}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          hasMore={!!query.hasNextPage}
          fetchingMore={query.isFetchingNextPage}
          onEndReached={() => query.fetchNextPage()}
          onRefresh={() => query.refetch()}
          onRetry={() => query.refetch()}
          onOpen={(id) => router.push(`/transacciones/${id}` as never)}
          onPayService={() => router.push('/pagos' as never)}
          header={
            <View style={styles.header}>
              <AppHeader actionLabel="Inicio" onAction={() => router.replace('/')} />
              <AppText variant="title" accessibilityRole="header">
                Mis pagos
              </AppText>
              <StatusFilter value={filter} onChange={setFilter} />
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  column: { alignSelf: 'center', flex: 1, maxWidth: layout.maxContentWidth, width: '100%' },
  header: { gap: spacing.lg, paddingBottom: spacing.sm },
});
