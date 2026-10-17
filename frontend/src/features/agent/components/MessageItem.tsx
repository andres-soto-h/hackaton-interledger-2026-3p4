import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { Button } from '@/ui';
import type { ChatMessage } from '../types';
import { AgentBubble, UserBubble } from './Bubbles';
import { MerchantChoice, PaymentProposalCard, PaymentStatusCard } from './Cards';

type Props = {
  item: ChatMessage;
  /** Solo la última respuesta ofrece "Escuchar". */
  showListen: boolean;
  onRetry: () => void;
  onChoose: (label: string) => void;
  onListen: (message: ChatMessage) => void;
};

/** Un mensaje del chat con sus acciones; lo comparten la pantalla de chat y el panel del inicio. */
export function MessageItem({ item, showListen, onRetry, onChoose, onListen }: Props) {
  if (item.role === 'user') return <UserBubble text={item.text} />;
  return (
    <View style={styles.block}>
      {item.failed ? (
        <>
          <AgentBubble text="No pude responder. ¿Lo intentamos de nuevo?" />
          <Button label="Intentar de nuevo" variant="secondary" onPress={onRetry} />
        </>
      ) : (
        <AgentBubble text={item.text} pending={item.pending} />
      )}
      {!item.pending && !item.failed && showListen ? (
        <Button label="Escuchar" variant="ghost" icon="volume-high" onPress={() => onListen(item)} />
      ) : null}
      {item.actions?.map((a, i) =>
        a.type === 'confirm_payment' ? (
          <PaymentProposalCard key={i} paymentId={a.paymentId} />
        ) : a.type === 'payment_status' ? (
          <PaymentStatusCard key={i} paymentId={a.paymentId} />
        ) : (
          <MerchantChoice key={i} options={a.options} onChoose={onChoose} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({ block: { gap: spacing.md } });
