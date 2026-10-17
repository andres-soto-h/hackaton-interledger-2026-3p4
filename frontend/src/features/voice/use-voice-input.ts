import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWebSpeechInput, type SpeechInput } from './speech-input';

export type VoiceStatus = 'idle' | 'listening' | 'denied' | 'unclear' | 'failed';

/**
 * Estado de la escucha. `onFinal` recibe lo que dijo la persona (nunca vacío); el texto se trata
 * igual que el escrito: la voz no aprueba pagos (solo el passkey).
 */
export function useVoiceInput(onFinal: (text: string) => void, input?: SpeechInput) {
  const engine = useMemo(() => input ?? createWebSpeechInput(), [input]);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [partial, setPartial] = useState('');
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => () => engine.cancel(), [engine]);

  const start = useCallback(() => {
    setPartial('');
    setStatus('listening');
    engine.start({
      onPartial: setPartial,
      onFinal: (text) => {
        setStatus('idle');
        setPartial('');
        onFinalRef.current(text);
      },
      onError: (error) => {
        setPartial('');
        setStatus(error === 'denied' ? 'denied' : error === 'none' ? 'unclear' : 'failed');
      },
    });
  }, [engine]);

  const cancel = useCallback(() => {
    engine.cancel();
    setPartial('');
    setStatus('idle');
  }, [engine]);

  return { available: engine.isAvailable(), status, partial, start, stop: engine.stop, cancel };
}
