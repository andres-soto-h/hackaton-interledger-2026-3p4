import { Platform } from 'react-native';

/** Por qué terminó una escucha sin texto. */
export type SpeechInputError = 'denied' | 'none' | 'failed';

export type SpeechInputHandlers = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: SpeechInputError) => void;
};

/** Voz a texto en el dispositivo (backend 028: el agente solo recibe texto). */
export interface SpeechInput {
  isAvailable(): boolean;
  start(handlers: SpeechInputHandlers): void;
  /** Termina la escucha y entrega lo entendido hasta ahora. */
  stop(): void;
  /** Descarta lo escuchado; no se envía nada. */
  cancel(): void;
}

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (Platform.OS !== 'web') return undefined;
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** `SpeechRecognition` del navegador (Chrome, Edge, Safari y Chrome en Android), en español de Colombia. */
export function createWebSpeechInput(): SpeechInput {
  let recognition: Recognition | null = null;
  let cancelled = false;

  return {
    isAvailable: () => recognitionCtor() !== undefined,

    start({ onPartial, onFinal, onError }) {
      const Ctor = recognitionCtor();
      if (!Ctor) return onError('failed');
      recognition?.abort();
      cancelled = false;
      let text = '';
      let failure: SpeechInputError | null = null;

      const r = new Ctor();
      r.lang = 'es-CO';
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (event) => {
        text = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(' ')
          .trim();
        onPartial(text);
      };
      r.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') failure = 'denied';
        else if (event.error === 'no-speech') failure = 'none';
        else if (event.error !== 'aborted') failure = 'failed';
      };
      r.onend = () => {
        recognition = null;
        if (cancelled) return;
        if (failure) onError(failure);
        else if (text) onFinal(text);
        else onError('none');
      };
      recognition = r;
      try {
        r.start();
      } catch {
        recognition = null;
        onError('failed');
      }
    },

    stop: () => recognition?.stop(),

    cancel() {
      cancelled = true;
      recognition?.abort();
      recognition = null;
    },
  };
}
