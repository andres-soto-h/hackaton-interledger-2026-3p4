import { http, HttpResponse } from 'msw';
import { API } from './config';
import { fixtures } from './auth';

export const registerHandlers = [
  http.post(`${API}/auth/register/options`, () =>
    HttpResponse.json({
      challengeId: 'chl_register',
      challenge: 'xyz',
      rp: { name: 'Tranqui', id: 'localhost' },
      user: { id: 'u', name: 'Claudia', displayName: 'Claudia' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    }),
  ),
  http.post(`${API}/auth/register/verify`, () =>
    HttpResponse.json({ user: fixtures.user, session: fixtures.session }, { status: 201 }),
  ),
  http.post(`${API}/me/wallet-link`, () =>
    HttpResponse.json(
      {
        linkId: 'wl_01',
        authorizationUrl: 'https://wallet.interledger-test.dev/grant/interact/abc',
        dailyLimit: { value: '200.00', assetCode: 'USD' },
        expiresAt: '2026-10-17T12:10:00.000Z',
      },
      { status: 202 },
    ),
  ),
];
