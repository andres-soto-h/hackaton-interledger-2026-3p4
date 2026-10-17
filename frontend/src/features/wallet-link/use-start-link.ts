import { useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/api/client';
import { isAllowedAuthorizationUrl, openExternalUrl } from '@/lib/open-url';
import { walletLinkApi } from './api';

function startErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CURRENCY_NOT_SUPPORTED') {
      return 'Por ahora esa moneda todavía no está disponible en TuTranqui.';
    }
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      return 'No pudimos conectarnos. Revise su internet e intente de nuevo.';
    }
  }
  return 'No pudimos preparar el permiso. Intente de nuevo.';
}

/** Inicia la vinculación y abre la wallet; evita el doble envío y las URLs que no sean https. */
export function useStartLink() {
  const router = useRouter();
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function finish() {
    busy.current = false;
    setLoading(false);
  }

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const { authorizationUrl } = await walletLinkApi.start();
      if (!isAllowedAuthorizationUrl(authorizationUrl)) {
        setError('No pudimos abrir su wallet. Intente de nuevo más tarde.');
        return finish();
      }
      openExternalUrl(authorizationUrl);
      // En web la página se descarga al ir a la wallet: el botón queda ocupado para evitar un segundo intento.
      if (Platform.OS !== 'web') finish();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WALLET_ALREADY_LINKED') {
        router.replace({ pathname: '/vincular/resultado', params: { status: 'ACTIVE' } });
        return finish();
      }
      setError(startErrorMessage(e));
      finish();
    }
  }

  return { start, loading, error };
}
