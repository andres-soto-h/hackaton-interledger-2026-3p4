import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MicButton } from '@/features/voice/MicButton';
import { VOICE_MESSAGES } from '@/features/voice/messages';
import { useVoiceInput } from '@/features/voice/use-voice-input';
import { borderWidth, colors, layout, radii, shadows, spacing } from '@/theme';
import { AppText, Button, PressableScale, TextField } from '@/ui';
import { useAgent } from '../agent-context';
import { ListeningOrb } from './ListeningOrb';
import { MessageItem } from './MessageItem';

const MAX = 500;

type Props = {
  onClose: () => void;
  /** Empieza a escuchar al abrirse (cuando se abre con el micrófono). */
  autoListen: boolean;
};

/**
 * Asistente en un panel inferior que se superpone al inicio: orbe animado mientras escucha,
 * transcripción en vivo, la conversación y la caja de texto, sin salir de la pantalla.
 * La conversación vive en `AgentProvider`: cerrar el panel no la pierde.
 */
export function AssistantSheet({ onClose, autoListen }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { messages, status, send, retry, spokenReplies, setSpokenReplies, speak, stopSpeaking } = useAgent();
  const voice = useVoiceInput((heard) => void send(heard, 'voice'));
  const [text, setText] = useState('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const trimmed = text.trim();
  const tooLong = text.length > MAX;
  const canSend = !!trimmed && !tooLong && status !== 'sending';
  const listening = voice.status === 'listening';
  const thinking = status === 'sending';
  const lastAgentId = [...messages].reverse().find((m) => m.role === 'agent')?.id;

  function startListening() {
    stopSpeaking();
    voice.start();
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoListen && voice.available && !started.current) {
      started.current = true;
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen, voice.available]);

  async function submit() {
    if (!canSend) return;
    const value = text;
    setText('');
    await send(value);
  }

  function close() {
    voice.cancel();
    stopSpeaking();
    onClose();
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Cerrar el asistente"
        />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(280)}
          exiting={SlideOutDown.duration(200)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <AppText variant="heading" color="primary" accessibilityRole="header">
              TuTranqui
            </AppText>
            <View style={styles.headerActions}>
              {spokenReplies ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Silenciar respuestas"
                  onPress={() => setSpokenReplies(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.iconButton}
                >
                  <Ionicons name="volume-high" size={22} color={colors.primary} />
                </PressableScale>
              ) : null}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
                onPress={close}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={24} color={colors.primary} />
              </PressableScale>
            </View>
          </View>

          {listening || thinking ? (
            <View style={styles.orbArea} accessibilityLiveRegion="polite">
              <ListeningOrb state={listening ? 'listening' : 'thinking'} size={64} />
              <AppText variant="bodyStrong" color="primary">
                {listening ? 'Le estoy escuchando…' : 'Un momento…'}
              </AppText>
              {listening ? (
                <AppText color="textMuted" style={styles.center}>
                  {voice.partial || 'Dígame qué quiere pagar'}
                </AppText>
              ) : null}
            </View>
          ) : null}

          {messages.length > 0 ? (
            <ScrollView
              ref={scroll}
              style={{ maxHeight: Math.round(height * (listening ? 0.22 : 0.4)) }}
              contentContainerStyle={styles.messages}
              onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map((item) => (
                <MessageItem
                  key={item.id}
                  item={item}
                  showListen={item.id === lastAgentId}
                  onRetry={retry}
                  onChoose={(label) => void send(label)}
                  onListen={speak}
                />
              ))}
            </ScrollView>
          ) : !listening ? (
            <AppText color="textMuted">Toque el micrófono o escriba qué quiere pagar. Usted confirma al final.</AppText>
          ) : null}

          {VOICE_MESSAGES[voice.status] ? (
            <AppText color="danger" accessibilityRole="alert">
              {VOICE_MESSAGES[voice.status]}
            </AppText>
          ) : null}

          <TextField
            label="Escriba su mensaje"
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            returnKeyType="send"
            error={tooLong ? `Máximo ${MAX} letras` : undefined}
          />
          <View style={styles.sendRow}>
            <View style={styles.send}>
              <Button label="Enviar" icon="send" onPress={submit} disabled={!canSend} />
            </View>
            {voice.available ? <MicButton status={voice.status} onStart={startListening} onStop={voice.stop} /> : null}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Cubre la pantalla de inicio y deja el panel pegado abajo, centrado en web.
  root: { bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 50 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,51,100,0.38)' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    borderColor: colors.borderSubtle,
    borderTopLeftRadius: radii.card + 8,
    borderTopRightRadius: radii.card + 8,
    borderWidth: borderWidth.hairline,
    gap: spacing.md,
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: layout.screenMargin,
    paddingTop: spacing.sm,
    width: '100%',
    ...shadows.card,
  },
  grabber: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radii.circle,
    height: 4,
    width: 40,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  iconButton: {
    alignItems: 'center',
    height: layout.minTouch,
    justifyContent: 'center',
    width: layout.minTouch,
  },
  orbArea: { alignItems: 'center', gap: spacing.xs },
  center: { textAlign: 'center' },
  messages: { gap: spacing.md, paddingVertical: spacing.xs },
  sendRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  send: { flex: 1 },
});
