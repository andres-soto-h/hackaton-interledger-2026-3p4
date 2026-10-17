import { http, HttpResponse } from 'msw';
import { API } from './config';
import type { Allowance, User, WalletLink } from '@/features/auth/types';

export const fixtures = {
  user: {
    id: 'usr_01',
    displayName: 'Claudia Pérez',
    walletAddress: 'https://ilp.interledger-test.dev/claudia',
    createdAt: '2026-10-16T12:00:00.000Z',
  } satisfies User,
  session: { token: 'tok_login', expiresAt: '2099-01-01T00:00:00.000Z' },
  walletLink: {
    linkId: 'wl_01',
    status: 'ACTIVE',
    isFinal: true,
    walletVerified: true,
    dailyLimit: { value: '500000.00', assetCode: 'COP' },
  } satisfies WalletLink,
  allowance: {
    dailyLimit: { value: '500000.00', assetCode: 'COP' },
    spent: { value: '45500.00', assetCode: 'COP' },
    available: { value: '454500.00', assetCode: 'COP' },
    periodStart: '2026-10-17T05:00:00.000Z',
    periodEnd: '2026-10-18T05:00:00.000Z',
  } satisfies Allowance,
};

export function apiError(code: string, status: number, message = code) {
  return HttpResponse.json({ error: { code, message, requestId: 'req_test' } }, { status });
}

export const authHandlers = [
  http.post(`${API}/auth/login/options`, () =>
    HttpResponse.json({ challengeId: 'chl_login', challenge: 'abc', rpId: 'localhost', userVerification: 'required' }),
  ),
  http.post(`${API}/auth/login/verify`, () =>
    HttpResponse.json({ user: fixtures.user, session: fixtures.session }),
  ),
  http.get(`${API}/me`, () => HttpResponse.json(fixtures.user)),
  http.delete(`${API}/me`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/me/wallet-link`, () => HttpResponse.json(fixtures.walletLink)),
  http.delete(`${API}/me/wallet-link`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/me/allowance`, () => HttpResponse.json(fixtures.allowance)),
];
