import { http, HttpResponse, delay } from 'msw';
import { server } from '../../tests/msw/server';
import { ApiError, createApiClient } from './client';

const BASE = 'http://api.test/api/v1';
const client = () => createApiClient({ baseUrl: BASE, timeoutMs: 200 });

describe('apiClient', () => {
  it('devuelve el body tipado en un 2xx JSON', async () => {
    server.use(http.get(`${BASE}/me`, () => HttpResponse.json({ id: 'usr_1', displayName: 'Ana' })));
    const me = await client().get<{ id: string; displayName: string }>('/me');
    expect(me).toEqual({ id: 'usr_1', displayName: 'Ana' });
  });

  it('arma la query ignorando valores vacíos', async () => {
    let url = '';
    server.use(
      http.get(`${BASE}/merchants`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [] });
      }),
    );
    await client().get('/merchants', { query: { query: 'epm', category: undefined, empty: '' } });
    expect(new URL(url).search).toBe('?query=epm');
  });

  it('convierte el error estándar en ApiError', async () => {
    server.use(
      http.post(`${BASE}/payments`, () =>
        HttpResponse.json(
          { error: { code: 'QUOTE_FAILED', message: 'No quote', requestId: 'req_1', details: [1] } },
          { status: 422 },
        ),
      ),
    );
    const error = await client()
      .post('/payments', {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'QUOTE_FAILED',
      message: 'No quote',
      status: 422,
      requestId: 'req_1',
      details: [1],
    });
  });

  it('responde UNKNOWN_ERROR con el status si no hay formato estándar', async () => {
    server.use(
      http.get(`${BASE}/a`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })),
      http.get(`${BASE}/b`, () => HttpResponse.json({ algo: 1 }, { status: 500 })),
    );
    await expect(client().get('/a')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR', status: 502 });
    await expect(client().get('/b')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR', status: 500 });
  });

  it('lanza NETWORK_ERROR si no hay red', async () => {
    server.use(http.get(`${BASE}/me`, () => HttpResponse.error()));
    await expect(client().get('/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('lanza TIMEOUT si la API no responde a tiempo', async () => {
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await delay(1000);
        return HttpResponse.json({});
      }),
    );
    await expect(client().get('/slow')).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
  });

  it('envía Authorization con el token provider e Idempotency-Key', async () => {
    let headers: Headers | undefined;
    server.use(
      http.post(`${BASE}/payments`, ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ paymentId: 'pay_1' }, { status: 201 });
      }),
    );
    const c = client();
    c.setTokenProvider(() => 'tok_123');
    await c.post('/payments', { a: 1 }, { idempotencyKey: 'key-1' });
    expect(headers?.get('authorization')).toBe('Bearer tok_123');
    expect(headers?.get('idempotency-key')).toBe('key-1');
    expect(headers?.get('content-type')).toBe('application/json');
  });

  it('no manda Authorization si no hay token', async () => {
    let headers: Headers | undefined;
    server.use(
      http.get(`${BASE}/me`, ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({});
      }),
    );
    const c = client();
    c.setTokenProvider(() => null);
    await c.get('/me');
    expect(headers?.has('authorization')).toBe(false);
  });

  it('llama a onUnauthorized con un 401 y aun así lanza el error', async () => {
    server.use(
      http.get(`${BASE}/me`, () =>
        HttpResponse.json({ error: { code: 'SESSION_INVALID', message: 'x' } }, { status: 401 }),
      ),
    );
    const c = client();
    const handler = jest.fn();
    c.onUnauthorized(handler);
    await expect(c.get('/me')).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('expone el header Retry-After con getWithHeaders', async () => {
    server.use(
      http.get(`${BASE}/payments/pay_1`, () =>
        HttpResponse.json({ status: 'PROCESSING' }, { headers: { 'Retry-After': '2' } }),
      ),
    );
    const res = await client().getWithHeaders<{ status: string }>('/payments/pay_1');
    expect(res.data).toEqual({ status: 'PROCESSING' });
    expect(res.retryAfterSeconds).toBe(2);
  });

  it('delete responde sin body (204)', async () => {
    server.use(http.delete(`${BASE}/me`, () => new HttpResponse(null, { status: 204 })));
    await expect(client().delete('/me')).resolves.toBeUndefined();
  });

  it('no registra el body de las peticiones', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    server.use(http.post(`${BASE}/x`, () => HttpResponse.json({})));
    await client().post('/x', { credential: 'secreto' });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('secreto');
    spy.mockRestore();
  });
});
