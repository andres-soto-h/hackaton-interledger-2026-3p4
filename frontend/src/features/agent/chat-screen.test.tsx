import { Text } from 'react-native';
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { fixtures } from '../../../tests/msw/auth';
import { agentHandler, reply, type AgentBody } from '../../../tests/msw/agent';
import { makePayment } from '../../../tests/msw/transactions';
import { renderApp } from '../../../tests/utils/render-app';
import type { Session } from '@/features/auth/types';

const session: Session = { ...fixtures.session, user: fixtures.user };
const open = () => renderApp({ initialUrl: '/agente', session });
const say = async (text: string) => {
  await fireEvent.changeText(await screen.findByLabelText('Escriba su mensaje'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar' }));
};
const proposal = http.get(`${API}/payments/pay_77`, () =>
  HttpResponse.json(
    makePayment({ paymentId: 'pay_77', status: 'AWAITING_CONFIRMATION', isFinal: false, description: 'EPM · número de contrato 7731' }),
  ),
);

describe('Chat con el agente', () => {
  it('desde el inicio abre el chat con saludo y ejemplos', async () => {
    await renderApp({ initialUrl: '/', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Toque y dígame qué pagar' }));
    expect(await screen.findByText(/Hola, soy TuTranqui/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pague la luz' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '¿Cuánto pagué este mes?' })).toBeTruthy();
  });

  it('mensaje → "Usted dijo", luego la respuesta; el conversationId se manda desde el segundo mensaje', async () => {
    const bodies: AgentBody[] = [];
    server.use(agentHandler((b, n) => reply(`Respuesta ${n}`, [], 'conv_42'), bodies));
    await open();
    await say('Hola');
    expect(await screen.findByLabelText('Usted dijo: Hola')).toBeTruthy();
    expect(await screen.findByText('Respuesta 1')).toBeTruthy();
    await say('Otra cosa');
    expect(await screen.findByText('Respuesta 2')).toBeTruthy();
    expect(bodies[0]).toEqual({ conversationId: null, text: 'Hola', inputMode: 'text' });
    expect(bodies[1].conversationId).toBe('conv_42');
  });

  it('choose_merchant: tocar una opción envía la elección como mensaje', async () => {
    const bodies: AgentBody[] = [];
    server.use(
      agentHandler(
        (b, n) =>
          n === 1
            ? reply('¿Cuál luz?', [{ type: 'choose_merchant', options: [{ merchantId: 'mer_epm', label: 'EPM · la luz' }, { merchantId: 'mer_enel', label: 'Enel · la luz' }] }])
            : reply('Perfecto'),
        bodies,
      ),
    );
    await open();
    await say('Pague la luz');
    await fireEvent.press(await screen.findByRole('button', { name: 'EPM · la luz' }));
    expect(await screen.findByText('Perfecto')).toBeTruthy();
    expect(bodies[1].text).toBe('EPM · la luz');
  });

  it('confirm_payment: la tarjeta sale de la API y lleva a la confirmación sin confirmar nada', async () => {
    let confirmed = false;
    server.use(
      agentHandler(() => reply('La factura es de 86.400. ¿Hacemos el pago?', [{ type: 'confirm_payment', paymentId: 'pay_77' }])),
      proposal,
      http.post(`${API}/payments/pay_77/confirm`, () => ((confirmed = true), HttpResponse.json({}, { status: 202 }))),
    );
    await renderApp({
      initialUrl: '/agente',
      session,
      screens: { '(app)/pagos/confirmar/[paymentId]': () => <Text>Pantalla de confirmación</Text> },
    });
    await say('Pague la luz de EPM, son 86.400');
    await fireEvent.press(await screen.findByRole('button', { name: 'Revisar y confirmar' }));
    expect(await screen.findByText('Pantalla de confirmación')).toBeTruthy();
    expect(confirmed).toBe(false);
  });

  it('al volver del resultado el chat muestra la tarjeta con el estado final', async () => {
    server.use(
      agentHandler(() => reply('¿Hacemos el pago?', [{ type: 'confirm_payment', paymentId: 'pay_77' }])),
      http.get(`${API}/payments/pay_77`, () =>
        HttpResponse.json(makePayment({ paymentId: 'pay_77', status: 'COMPLETED', isFinal: true, description: 'EPM · número de contrato 7731' })),
      ),
    );
    await renderApp({
      initialUrl: '/agente',
      session,
      screens: {
        '(app)/pagos/confirmar/[paymentId]': () => <Text>Pantalla de confirmación</Text>,
      },
    });
    await say('Pague la luz');
    await fireEvent.press(await screen.findByRole('button', { name: 'Revisar y confirmar' }));
    await screen.findByText('Pantalla de confirmación');
    // El usuario terminó el pago y abre el resultado (spec 007), que lo devuelve al chat.
    await act(async () => {
      router.replace('/pagos/resultado/pay_77' as never);
    });
    expect(await screen.findByText('Listo. Su pago quedó hecho.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al chat' }));
    expect(await screen.findByText('Así quedó su pago:')).toBeTruthy();
    expect(await screen.findByLabelText('Estado: Pago exitoso')).toBeTruthy();
  });

  it('si el agente falla muestra el aviso y reintenta con el mismo texto', async () => {
    const bodies: AgentBody[] = [];
    server.use(
      agentHandler((_b, n) => (n === 1 ? new HttpResponse(null, { status: 500 }) : reply('Ahora sí')), bodies),
    );
    await open();
    await say('Pague el agua');
    expect(await screen.findByText('No pude responder. ¿Lo intentamos de nuevo?')).toBeTruthy();
    expect(screen.getByLabelText('Usted dijo: Pague el agua')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByText('Ahora sí')).toBeTruthy();
    expect(bodies.map((b) => b.text)).toEqual(['Pague el agua', 'Pague el agua']);
  });

  it('un mensaje vacío o de más de 500 letras no se envía', async () => {
    const bodies: AgentBody[] = [];
    server.use(agentHandler(() => reply('x'), bodies));
    await open();
    const input = await screen.findByLabelText('Escriba su mensaje');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await fireEvent.changeText(input, 'a'.repeat(501));
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(screen.getByText('Máximo 500 letras')).toBeTruthy();
    await fireEvent.changeText(input, 'a'.repeat(500));
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(bodies).toHaveLength(0);
  });

  it('"Empezar de nuevo" limpia la conversación', async () => {
    await open();
    await say('Hola');
    await screen.findByText('Recibí: Hola');
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar de nuevo' }));
    expect(screen.queryByText('Recibí: Hola')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pague la luz' })).toBeTruthy();
  });
});
