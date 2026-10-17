import { ApiError } from '@/api/client';

const MESSAGES: Record<string, string> = {
  QUOTE_FAILED: 'No pudimos calcular el pago. Intente de nuevo en un momento.',
  AMOUNT_EXCEEDS_LIMIT: 'Este valor pasa el máximo permitido por pago. Pruebe con un valor menor.',
  DAILY_LIMIT_EXCEEDED: 'Este pago pasa el monto que puede pagar hoy. Pruebe con un valor menor o mañana.',
  WALLET_NOT_LINKED: 'Primero debe dar el permiso en su wallet.',
  WALLET_LINK_REVOKED: 'El permiso en su wallet ya no está activo. Vincúlela otra vez.',
  PAYMENTS_DISABLED: 'Los pagos están en pausa por ahora. Intente más tarde.',
  OPEN_PAYMENTS_UNAVAILABLE: 'No pudimos comunicarnos con la red de pagos. Intente en un momento.',
  INCOMING_PAYMENT_NOT_PAYABLE: 'Este comercio no puede recibir el pago ahora. Intente más tarde.',
  MERCHANT_CURRENCY_NOT_SUPPORTED: 'Por ahora solo se pueden pagar servicios en pesos colombianos.',
  NETWORK_ERROR: 'No hay conexión. Revise su internet e intente de nuevo.',
  TIMEOUT: 'Tardó demasiado. Intente de nuevo.',
};

export const GENERIC_PAYMENT_ERROR = 'No pudimos preparar el pago. Intente de nuevo';

/** Texto en lenguaje simple para un error al crear el pago; el `requestId` va aparte para soporte. */
export function paymentErrorMessage(error: unknown): { message: string; requestId?: string } {
  if (error instanceof ApiError) {
    const message = MESSAGES[error.code];
    if (message) return { message };
    return { message: GENERIC_PAYMENT_ERROR, requestId: error.requestId };
  }
  return { message: GENERIC_PAYMENT_ERROR };
}
