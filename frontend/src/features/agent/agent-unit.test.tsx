import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../../tests/utils/render';
import { makePayment } from '../../../tests/msw/transactions';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { AgentProvider } from './agent-context';
import { AgentBubble } from './components/Bubbles';
import { PaymentProposalCard } from './components/Cards';
import { conversationReducer, failedUserText, initialConversation } from './conversation';
import { parseActions } from './types';

describe('conversationReducer', () => {
  const sent = conversationReducer(initialConversation, { type: 'send', userId: 'u1', pendingId: 'p1', text: 'Pague la luz' });

  it('enviar agrega el mensaje del usuario y el "escribiendo…"', () => {
    expect(sent.status).toBe('sending');
    expect(sent.messages.map((m) => [m.role, m.text, !!m.pending])).toEqual([
      ['user', 'Pague la luz', false],
      ['agent', '', true],
    ]);
  });

  it('la respuesta reemplaza al pendiente, guarda conversationId y las acciones', () => {
    const next = conversationReducer(sent, {
      type: 'reply',
      pendingId: 'p1',
      conversationId: 'conv_9',
      id: 'm1',
      text: 'Listo',
      actions: [{ type: 'confirm_payment', paymentId: 'pay_1' }],
    });
    expect(next.status).toBe('idle');
    expect(next.conversationId).toBe('conv_9');
    expect(next.messages[1]).toEqual({
      id: 'm1',
      role: 'agent',
      text: 'Listo',
      actions: [{ type: 'confirm_payment', paymentId: 'pay_1' }],
    });
  });

  it('el error conserva el mensaje del usuario y permite reintentar con el mismo texto', () => {
    const failed = conversationReducer(sent, { type: 'fail', pendingId: 'p1' });
    expect(failed.status).toBe('error');
    expect(failed.messages[0].text).toBe('Pague la luz');
    expect(failedUserText(failed)).toBe('Pague la luz');

    const retrying = conversationReducer(failed, { type: 'retry', pendingId: 'p2' });
    expect(retrying.status).toBe('sending');
    expect(retrying.messages).toHaveLength(2);
    expect(retrying.messages[1]).toMatchObject({ id: 'p2', pending: true });
    expect(failedUserText(retrying)).toBeNull();
  });

  it('reset vuelve al estado inicial', () => {
    expect(conversationReducer(sent, { type: 'reset' })).toEqual(initialConversation);
  });
});

describe('parseActions', () => {
  it('tipa las conocidas e ignora el resto sin romper', () => {
    expect(
      parseActions([
        { type: 'confirm_payment', paymentId: 'pay_1' },
        { type: 'payment_status', paymentId: 'pay_2' },
        { type: 'choose_merchant', options: [{ merchantId: 'mer_epm', label: 'EPM · la luz' }, { merchantId: 3 }, null] },
        { type: 'desconocida', x: 1 },
        { type: 'confirm_payment' },
        { type: 'choose_merchant', options: [] },
        'texto',
        null,
      ]),
    ).toEqual([
      { type: 'confirm_payment', paymentId: 'pay_1' },
      { type: 'payment_status', paymentId: 'pay_2' },
      { type: 'choose_merchant', options: [{ merchantId: 'mer_epm', label: 'EPM · la luz' }] },
    ]);
  });

  it.each([undefined, null, 'x', 5, {}])('una lista inválida (%j) da []', (raw) => {
    expect(parseActions(raw)).toEqual([]);
  });
});

describe('AgentBubble', () => {
  it('muestra literal el HTML, el markdown y los enlaces; nada es clicable', async () => {
    const text = '<b>Hola</b> [pague aquí](https://evil.test) https://evil.test/x <script>alert(1)</script>';
    await renderWithProviders(<AgentBubble text={text} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PaymentProposalCard', () => {
  it('muestra comercio, comisión y total de la API y un botón accesible', async () => {
    server.use(
      http.get(`${API}/payments/pay_1`, () =>
        HttpResponse.json(
          makePayment({ paymentId: 'pay_1', status: 'AWAITING_CONFIRMATION', isFinal: false, description: 'EPM · número de contrato 7731' }),
        ),
      ),
    );
    await renderWithProviders(
      <AgentProvider>
        <PaymentProposalCard paymentId="pay_1" />
      </AgentProvider>,
    );
    expect(await screen.findByText('EPM')).toBeTruthy();
    expect(screen.getByText('Comisión TuTranqui')).toBeTruthy();
    expect(screen.getByText('$86.401')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar y confirmar' })).toBeTruthy();
  });
});
