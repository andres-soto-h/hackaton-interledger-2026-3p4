import type { Merchant } from './types';

/**
 * Lista SIMULADA de comercios. Pendiente del backend: reemplazar por `GET /api/v1/merchants`
 * leyendo la base de datos en Google Cloud (ver KANBAN del backend y spec 005, tarea 5).
 */
export const MOCK_MERCHANTS: Merchant[] = [
  { id: 'mer_epm', name: 'EPM', category: 'energia', walletAddress: 'https://ilp.interledger-test.dev/epm', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de contrato' },
  { id: 'mer_codensa', name: 'Enel Colombia', category: 'energia', walletAddress: 'https://ilp.interledger-test.dev/enel', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de cuenta' },
  { id: 'mer_acueducto', name: 'Acueducto de Bogotá', category: 'agua', walletAddress: 'https://ilp.interledger-test.dev/acueducto', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de contrato' },
  { id: 'mer_gas', name: 'Vanti Gas Natural', category: 'gas', walletAddress: 'https://ilp.interledger-test.dev/vanti', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de cuenta' },
  { id: 'mer_claro', name: 'Claro', category: 'celular', walletAddress: 'https://ilp.interledger-test.dev/claro', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de celular' },
  { id: 'mer_movistar', name: 'Movistar', category: 'celular', walletAddress: 'https://ilp.interledger-test.dev/movistar', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de celular' },
  { id: 'mer_etb', name: 'ETB Internet', category: 'internet', walletAddress: 'https://ilp.interledger-test.dev/etb', assetCode: 'COP', assetScale: 2, referenceLabel: 'Número de contrato' },
  { id: 'mer_invalido', name: 'Comercio de prueba (wallet inválida)', category: 'internet', walletAddress: 'https://ilp.interledger-test.dev/no-existe', assetCode: 'COP', assetScale: 2, referenceLabel: 'Referencia' },
];
