import type { PaymentStatus } from '@/ui';

export type StatusFilterId = 'all' | 'completed' | 'processing' | 'failed';

export const STATUS_FILTERS: { id: StatusFilterId; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'completed', label: 'Exitosas' },
  { id: 'processing', label: 'En proceso' },
  { id: 'failed', label: 'Fallidas' },
];

const STATUS: Record<StatusFilterId, PaymentStatus | undefined> = {
  all: undefined,
  completed: 'COMPLETED',
  processing: 'PROCESSING',
  failed: 'FAILED',
};

/** Valor de `status` para la consulta; "Todas" no manda filtro. */
export const statusForFilter = (id: StatusFilterId): PaymentStatus | undefined => STATUS[id];
