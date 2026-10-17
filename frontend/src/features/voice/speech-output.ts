import { Platform } from 'react-native';

/** Salida de voz: el audio de ElevenLabs que manda el backend y, de respaldo, la voz del navegador. */
export interface SpeechOutput {
  isAvailable(): boolean;
  /** Reproduce un mp3 en base64 (`reply.audio` del agente). Rechaza si el navegador lo bloquea. */
  playAudio(base64: string): Promise<void>;
  /** Lee un texto con la voz del dispositivo (respaldo cuando no hay audio). */
  speakText(text: string): void;
  stop(): void;
}

export function createWebSpeechOutput(): SpeechOutput {
  let audio: HTMLAudioElement | null = null;
  const hasAudio = Platform.OS === 'web' && typeof Audio !== 'undefined';
  const synth = Platform.OS === 'web' && typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

  const stop = () => {
    if (audio) {
      audio.pause();
      audio = null;
    }
    synth?.cancel();
  };

  return {
    isAvailable: () => hasAudio || synth !== null,

    async playAudio(base64) {
      if (!hasAudio) throw new Error('Sin reproductor de audio');
      stop();
      const player = new Audio(`data:audio/mpeg;base64,${base64}`);
      audio = player;
      player.onended = () => {
        if (audio === player) audio = null;
      };
      await player.play();
    },

    speakText(text) {
      if (!synth) return;
      stop();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-CO';
      synth.speak(utterance);
    },

    stop,
  };
}
