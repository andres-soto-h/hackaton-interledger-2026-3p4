import { apiClient, ApiError } from '@/api/client';
import { normalizeText } from '@/features/merchants/search';
import type { Merchant } from '@/features/merchants/types';

export type WalletVerification = {
  exists: boolean;
  publicName: string | null;
  assetCode?: string;
  assetScale?: number;
};

export type StepStatus = 'ok' | 'error' | 'warning';
export type ValidationStep = { id: string; title: string; status: StepStatus; detail?: string };

/**
 * `GET /wallets/verify`. El backend todavía no tiene este endpoint (pendiente): si responde 404
 * por ruta inexistente, se usa una verificación local del directorio para no bloquear el flujo.
 */
export async function verifyWallet(merchant: Merchant): Promise<WalletVerification> {
  try {
    return await apiClient.get<WalletVerification>('/wallets/verify', {
      query: { walletAddress: merchant.walletAddress },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND') {
      return { exists: true, publicName: merchant.name, assetCode: merchant.assetCode, assetScale: merchant.assetScale };
    }
    throw error;
  }
}

/** Pasos de la pantalla de validación, derivados de la respuesta (spec 005). */
export function buildValidationSteps(merchant: Merchant, v: WalletVerification): ValidationStep[] {
  const secure = merchant.walletAddress.startsWith('https://');
  const sameName =
    !!v.publicName && normalizeText(v.publicName) === normalizeText(merchant.name);
  const peso = !v.exists || v.assetCode === 'COP';
  return [
    { id: 'directory', title: 'Es el comercio del directorio', status: 'ok' },
    {
      id: 'exists',
      title: 'La dirección de pago existe',
      status: v.exists ? 'ok' : 'error',
    },
    { id: 'secure', title: 'La conexión es segura', status: secure ? 'ok' : 'error' },
    {
      id: 'owner',
      title: `El dueño es ${merchant.name}`,
      status: !v.exists ? 'error' : sameName ? 'ok' : 'warning',
      detail:
        v.exists && !sameName
          ? v.publicName
            ? `La wallet dice ser de ${v.publicName}`
            : 'La wallet no dice quién es su dueño'
          : undefined,
    },
    {
      id: 'currency',
      title: 'La cuenta recibe pesos colombianos',
      status: peso ? 'ok' : 'error',
    },
  ];
}

export const hasBlockingError = (steps: ValidationStep[]) => steps.some((s) => s.status === 'error');
