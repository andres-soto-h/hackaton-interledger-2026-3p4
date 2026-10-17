import { Linking, Platform } from 'react-native';

/** `true` solo para URLs `https` bien formadas (las `authorizationUrl` deben cumplirlo). */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `authorizationUrl` permitida: `https`; en desarrollo también `http://localhost`, que es donde
 * vive la wallet simulada de `scripts/mock-api.mjs`. En producción nunca se acepta `http`.
 */
export function isAllowedAuthorizationUrl(value: string, dev: boolean = __DEV__): boolean {
  if (isHttpsUrl(value)) return true;
  try {
    const url = new URL(value);
    return dev && url.protocol === 'http:' && url.hostname === 'localhost';
  } catch {
    return false;
  }
}

/** Abre una URL externa. En web navega en la misma pestaña para poder volver a la app. */
export function openExternalUrl(url: string): void {
  if (Platform.OS === 'web') {
    window.location.assign(url);
  } else {
    void Linking.openURL(url);
  }
}
