import { Linking, Platform } from 'react-native';

/** `true` solo para URLs `https` bien formadas (las `authorizationUrl` deben cumplirlo). */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
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
