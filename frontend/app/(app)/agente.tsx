import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAgent } from '@/features/agent/agent-context';
import { AgentBubble, UserBubble } from '@/features/agent/components/Bubbles';
import { MerchantChoice, PaymentProposalCard, PaymentStatusCard } from '@/features/agent/components/Cards';
import type { ChatMessage } from '@/features/agent/types';
import { layout, spacing } from '@/theme';
import { AppHeader, AppText, Button, ScreenShell, TextField } from '@/ui';

const MAX = 500;
const EXAMPLES = ['Pague la luz', '¿Cuánto pagué este mes?'];
const GREETING = 'Hola, soy TuTranqui. Dígame qué servicio quiere pagar y yo lo preparo. Usted confirma al final.';

export default function Agent() {
  const router = useRouter();
  const { messages, status, send, retry, reset } = useAgent();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const tooLong = text.length > MAX;
  const canSend = !!trimmed && !tooLong && status !== 'sending';

  async function submit(value = text) {
    if (!value.trim() || value.length > MAX || status === 'sending') return;
    setText('');
    await send(value);
  }

  const renderItem = ({ item }: { item: ChatMessage }) => {
    if (item.role === 'user') return <UserBubble text={item.text} />;
    return (
      <View style={styles.agentBlock}>
        {item.failed ? (
          <>
            <AgentBubble text="No pude responder. ¿Lo intentamos de nuevo?" />
            <Button label="Intentar de nuevo" variant="secondary" onPress={retry} />
          </>
        ) : (
          <AgentBubble text={item.text} pending={item.pending} />
        )}
        {item.actions?.map((a, i) =>
          a.type === 'confirm_payment' ? (
            <PaymentProposalCard key={i} paymentId={a.paymentId} />
          ) : a.type === 'payment_status' ? (
            <PaymentStatusCard key={i} paymentId={a.paymentId} />
          ) : (
            <MerchantChoice key={i} options={a.options} onChoose={(label) => void send(label)} />
          ),
        )}
      </View>
    );
  };

  return (
    <ScreenShell>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.column}>
        <View style={styles.header}>
          <AppHeader actionLabel="Inicio" onAction={() => router.replace('/')} />
          <AppText variant="title" accessibilityRole="header">
            Hable con TuTranqui
          </AppText>
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
          <TextField
            label="Escriba su mensaje"
            value={text}
            onChangeText={setText}
            multiline
            error={tooLong ? `Máximo ${MAX} letras` : undefined}
          />
          <Button label="Enviar" onPress={() => submit()} disabled={!canSend} />
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
});
