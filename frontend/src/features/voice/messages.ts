import type { VoiceStatus } from './use-voice-input';

/** Avisos de la escucha cuando algo no salió bien; siempre queda la opción de escribir. */
export const VOICE_MESSAGES: Partial<Record<VoiceStatus, string>> = {
  denied:
    'No tenemos permiso para usar el micrófono. Actívelo en la configuración del navegador o escriba su mensaje.',
  unclear: 'No le escuché bien. ¿Lo repite?',
  failed: 'No pudimos usar el micrófono. Puede escribir su mensaje.',
};
