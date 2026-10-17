import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAgent } from '@/features/agent/agent-context';
import { AgentBubble } from '@/features/agent/components/Bubbles';
import { MessageItem } from '@/features/agent/components/MessageItem';
import type { ChatMessage } from '@/features/agent/types';
import { MicButton } from '@/features/voice/MicButton';
import { VOICE_MESSAGES } from '@/features/voice/messages';
import { useVoiceInput } from '@/features/voice/use-voice-input';
import { layout, spacing } from '@/theme';
import { AppHeader, AppText, Button, Card, ScreenShell, TextField } from '@/ui';

const MAX = 500;
const EXAMPLES = ['Pague la luz', '¿Cuánto pagué este mes?'];
const GREETING = 'Hola, soy TuTranqui. Dígame qué servicio quiere pagar y yo lo preparo. Usted confirma al final.';

export default function Agent() {
  const router = useRouter();
  const { messages, status, send, retry, reset, spokenReplies, setSpokenReplies, speak, stopSpeaking } = useAgent();
  const { voz } = useLocalSearchParams<{ voz?: string }>();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const tooLong = text.length > MAX;
  const canSend = !!trimmed && !tooLong && status !== 'sending';
  const voice = useVoiceInput((heard) => void send(heard, 'voice'));

  function startListening() {
    stopSpeaking();
    voice.start();
  }

  // Desde el micrófono del inicio (`?voz=1`) la escucha empieza al abrir el chat.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (voz === '1' && voice.available && !autoStarted.current) {
      autoStarted.current = true;
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voz, voice.available]);

  async function submit(value = text) {
    if (!value.trim() || value.length > MAX || status === 'sending') return;
    setText('');
    await send(value);
  }

  const lastAgentId = [...messages].reverse().find((m) => m.role === 'agent')?.id;

  const renderItem = ({ item }: { item: ChatMessage }) => (
    <MessageItem
      item={item}
      showListen={item.id === lastAgentId}
      onRetry={retry}
      onChoose={(label) => void send(label)}
      onListen={speak}
    />
  );

  return (
    <ScreenShell>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.column}>
        <View style={styles.header}>
          <AppHeader onBack={() => router.replace('/')} />
          <AppText variant="title" accessibilityRole="header">
            Hable con TuTranqui
          </AppText>
          {spokenReplies ? (
            <Button label="Silenciar respuestas" variant="ghost" icon="volume-mute" onPress={() => setSpokenReplies(false)} />
          ) : null}
        </View>
        {/* FlatList: la conversación es corta y no es cuello de botella de 60 fps. */}
        <FlatList
          testID="chat-list"
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.agentBlock}>
              <AgentBubble text={GREETING} />
              {messages.length === 0
                ? EXAMPLES.map((example) => (
                    <Button key={example} label={example} variant="secondary" onPress={() => submit(example)} />
                  ))
                : null}
            </View>
          }
        />
        <View style={styles.input}>
          {voice.status === 'listening' ? (
            <Card tone="alt" accessibilityLiveRegion="polite">
              <AppText variant="bodyStrong">Le estoy escuchando…</AppText>
              <AppText color="textMuted">{voice.partial || 'Dígame qué quiere pagar'}</AppText>
              <Button label="Cancelar" variant="ghost" onPress={voice.cancel} />
            </Card>
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
            multiline
            error={tooLong ? `Máximo ${MAX} letras` : undefined}
          />
          <View style={styles.sendRow}>
            <View style={styles.send}>
              <Button label="Enviar" onPress={() => submit()} disabled={!canSend} />
            </View>
            {voice.available ? <MicButton status={voice.status} onStart={startListening} onStop={voice.stop} /> : null}
          </View>
          {messages.length > 0 ? <Button label="Empezar de nuevo" variant="ghost" onPress={reset} /> : null}
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  header: { gap: spacing.sm, paddingHorizontal: layout.screenMargin, paddingTop: spacing.lg },
  list: { gap: spacing.md, padding: layout.screenMargin },
  agentBlock: { gap: spacing.md },
  input: { gap: spacing.sm, padding: layout.screenMargin },
  sendRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  send: { flex: 1 },
});
