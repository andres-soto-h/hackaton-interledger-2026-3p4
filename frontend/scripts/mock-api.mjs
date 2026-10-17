// API simulada para ver el frontend sin el backend (que necesita llaves de Open Payments).
// Sigue los contratos de backend/openapi.yaml. NO es el backend: todo vive en memoria.
//   node scripts/mock-api.mjs        → http://localhost:3001/api/v1
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 3001);
const WEB = process.env.MOCK_WEB_ORIGIN ?? 'http://localhost:8081';
const DAILY_LIMIT = 500000; // COP, igual que la configuración del backend
const FEE_PERCENT_MILLI = 1; // 0,001 %
const WALLET_BASE = 'https://ilp.interledger-test.dev'; // igual a WALLET_PROVIDER_BASE_URL del backend
const fullWallet = (name) => `${WALLET_BASE}/${name}`;
const b64 = (n = 32) => randomBytes(n).toString('base64url');

const state = {
  user: null,
  link: null, // { linkId, status }
  spent: 0,
  payments: new Map(),
  seq: 0,
  pending: null, // { displayName, walletName } del paso 1 del registro
};

const demoUser = () =>
  (state.user ??= {
    id: 'usr_demo',
    displayName: 'Claudia Pérez',
    walletAddress: fullWallet('claudia'),
    createdAt: new Date().toISOString(),
  });

const money = (cents) => ({ value: (cents / 100).toFixed(2), assetCode: 'COP' });
const toCents = (value) => Math.round(Number(value) * 100);

const MERCHANTS = {
  epm: 'EPM', enel: 'Enel Colombia', acueducto: 'Acueducto de Bogotá', vanti: 'Vanti Gas Natural',
  claro: 'Claro', movistar: 'Movistar', etb: 'ETB Internet',
};

function view(p) {
  const done = p.status === 'PROCESSING' && Date.now() - p.confirmedAt > 3000;
  const status = done ? 'COMPLETED' : p.status;
  if (done && !p.settled) {
    p.settled = true;
    p.status = 'COMPLETED';
    p.updatedAt = new Date().toISOString();
  }
  return {
    paymentId: p.id, type: 'p2m', status,
    isFinal: ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status),
    senderWalletAddress: demoUser().walletAddress, receiverWalletAddress: p.wallet,
    debitAmount: money(p.debit), receiveAmount: money(p.debit),
    sentAmount: status === 'COMPLETED' ? money(p.debit) : money(0),
    fee: { ...money(p.fee), percentage: '0.001' }, feeStatus: status === 'COMPLETED' ? 'COLLECTED' : 'PENDING',
    totalDebit: money(p.debit + p.fee), description: p.description, error: null,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function createPayment(wallet, amountValue, description) {
  const debit = toCents(amountValue);
  const fee = Math.max(100, Math.ceil((debit * FEE_PERCENT_MILLI) / 100000));
  const now = new Date().toISOString();
  const p = {
    id: `pay_${String(++state.seq).padStart(3, '0')}`, wallet, debit, fee, description,
    status: 'AWAITING_CONFIRMATION', createdAt: now, updatedAt: now,
    confirmBy: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  state.payments.set(p.id, p);
  return p;
}

const quote = (p) => ({
  paymentId: p.id, status: 'AWAITING_CONFIRMATION', confirmBy: p.confirmBy,
  quote: {
    debitAmount: money(p.debit), receiveAmount: money(p.debit),
    fee: { ...money(p.fee), percentage: '0.001' }, totalDebit: money(p.debit + p.fee),
  },
  allowance: {
    dailyLimit: money(DAILY_LIMIT * 100),
    availableAfter: money(DAILY_LIMIT * 100 - state.spent - p.debit - p.fee),
  },
});

const err = (res, status, code, message = code) =>
  send(res, status, { error: { code, message, requestId: `req_${b64(4)}` } });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if ((req.headers['content-type'] ?? '').includes('x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });

const session = () => ({ token: `tok_${b64(12)}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
const creationOptions = (name) => ({
  challengeId: `chl_${b64(6)}`, challenge: b64(), rp: { name: 'TuTranqui', id: 'localhost' },
  user: { id: b64(16), name: name, displayName: name },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  timeout: 60000, attestation: 'none',
});
const linkView = () => ({
  linkId: state.link.linkId, status: state.link.status,
  isFinal: state.link.status !== 'PENDING_AUTHORIZATION', walletVerified: true,
  dailyLimit: money(DAILY_LIMIT * 100),
});

async function route(req, res, url, body) {
  const m = req.method;
  const p = url.pathname.replace(/^\/api\/v1/, '');
  const authed = (req.headers.authorization ?? '').startsWith('Bearer ');
  const needAuth = () => (authed ? false : (err(res, 401, 'SESSION_INVALID'), true));

  if (p === '/auth/register/options' && m === 'POST') {
    const walletName = String(body.walletAddress ?? '').trim();
    if (!walletName || walletName === 'no-existe') return err(res, 422, 'WALLET_NOT_FOUND', 'No encontramos esa wallet');
    state.pending = { displayName: body.displayName, walletName };
    return send(res, 200, creationOptions(body.displayName ?? 'Usuario'));
  }
  if (p === '/auth/register/verify' && m === 'POST') {
    const pending = state.pending ?? { displayName: 'Claudia Pérez', walletName: 'claudia' };
    state.user = null; state.link = null; state.spent = 0;
    state.user = {
      id: 'usr_demo',
      displayName: pending.displayName ?? 'Claudia Pérez',
      walletAddress: fullWallet(pending.walletName),
      createdAt: new Date().toISOString(),
    };
    return send(res, 201, { user: state.user, session: session() });
  }
  if (p === '/auth/login/options' && m === 'POST') {
    return send(res, 200, { challengeId: `chl_${b64(6)}`, challenge: b64(), rpId: 'localhost', userVerification: 'required', timeout: 60000 });
  }
  if (p === '/auth/login/verify' && m === 'POST') return send(res, 200, { user: demoUser(), session: session() });

  if (p === '/wallets/verify' && m === 'GET') {
    const wallet = url.searchParams.get('walletAddress') ?? '';
    const key = wallet.split('/').pop();
    if (key === 'no-existe') return send(res, 200, { exists: false, publicName: null });
    return send(res, 200, { exists: true, publicName: MERCHANTS[key] ?? key, assetCode: 'COP', assetScale: 2 });
  }

  // La "wallet" simulada donde la persona aprueba el permiso.
  if (p === '/mock-wallet' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;max-width:420px;margin:48px auto;padding:0 20px">
<h2>Wallet de prueba</h2><p><b>TuTranqui</b> quiere permiso para pagar hasta <b>$500.000 COP por día</b>.</p>
<form method="POST" action="/mock-wallet/decide"><input type="hidden" name="linkId" value="${url.searchParams.get('linkId')}">
<button name="d" value="approve" style="font-size:18px;padding:14px 24px;margin:4px">Aprobar</button>
<button name="d" value="reject" style="font-size:18px;padding:14px 24px;margin:4px">Rechazar</button></form></body>`);
  }
  if (p === '/mock-wallet/decide' && m === 'POST') {
    const approved = body.d === 'approve';
    state.link.status = approved ? 'ACTIVE' : 'REJECTED';
    res.writeHead(303, { Location: `${WEB}/vincular/resultado?linkId=${state.link.linkId}&status=${state.link.status}` });
    return res.end();
  }

  if (needAuth()) return;
  if (p === '/me' && m === 'GET') return send(res, 200, demoUser());
  if (p === '/me' && m === 'DELETE') { state.user = null; state.link = null; return send(res, 204); }
  if (p === '/me/wallet-link' && m === 'POST') {
    if (state.link?.status === 'ACTIVE') return err(res, 409, 'WALLET_ALREADY_LINKED');
    state.link = { linkId: `wl_${b64(4)}`, status: 'PENDING_AUTHORIZATION' };
    return send(res, 202, {
      linkId: state.link.linkId,
      authorizationUrl: `http://localhost:${PORT}/api/v1/mock-wallet?linkId=${state.link.linkId}`,
      dailyLimit: money(DAILY_LIMIT * 100), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  }
  if (p === '/me/wallet-link' && m === 'GET') {
    if (!state.link) return err(res, 404, 'LINK_NOT_FOUND');
    return send(res, 200, linkView(), state.link.status === 'PENDING_AUTHORIZATION' ? { 'Retry-After': '2' } : {});
  }
  if (p === '/me/wallet-link' && m === 'DELETE') { if (state.link) state.link.status = 'REVOKED'; return send(res, 204); }
  if (p === '/me/allowance' && m === 'GET') {
    if (state.link?.status !== 'ACTIVE') return err(res, 404, 'LINK_NOT_FOUND');
    return send(res, 200, {
      dailyLimit: money(DAILY_LIMIT * 100), spent: money(state.spent), available: money(DAILY_LIMIT * 100 - state.spent),
      periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  if (p === '/transactions' && m === 'GET') {
    const status = url.searchParams.get('status');
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const all = [...state.payments.values()].reverse().map(view)
      .filter((v) => v.status !== 'AWAITING_CONFIRMATION' && (!status || v.status === status))
      .map((v) => ({
        id: v.paymentId, kind: 'payment', direction: 'outgoing', type: 'p2m', status: v.status,
        counterparty: { name: v.description.split(' · ')[0], walletAddress: v.receiverWalletAddress },
        debitAmount: v.debitAmount, receiveAmount: v.receiveAmount, fee: v.fee, totalDebit: v.totalDebit,
        description: v.description, createdAt: v.createdAt, updatedAt: v.updatedAt,
      }));
    return send(res, 200, { items: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null });
  }

  if (p === '/payments' && m === 'POST') {
    if (state.link?.status !== 'ACTIVE') return err(res, 403, 'WALLET_NOT_LINKED');
    if (body.amount?.assetCode !== 'COP') return err(res, 422, 'MERCHANT_CURRENCY_NOT_SUPPORTED');
    return send(res, 201, quote(createPayment(body.receiverWalletAddress, body.amount.value, body.description ?? '')));
  }
  const pm = p.match(/^\/payments\/([^/]+)(\/confirm\/options|\/confirm|\/cancel)?$/);
  if (pm) {
    const pay = state.payments.get(pm[1]);
    if (!pay) return err(res, 404, 'PAYMENT_NOT_FOUND');
    if (!pm[2] && m === 'GET') {
      const v = view(pay);
      return send(res, 200, { ...v, ...(v.status === 'AWAITING_CONFIRMATION' ? { confirmBy: pay.confirmBy } : {}) }, v.isFinal ? {} : { 'Retry-After': '1' });
    }
    if (pay.status !== 'AWAITING_CONFIRMATION' && pm[2]) return err(res, 409, 'PAYMENT_NOT_CONFIRMABLE');
    if (pm[2] === '/confirm/options') return send(res, 200, { challengeId: `chl_${b64(6)}`, challenge: b64(), rpId: 'localhost', userVerification: 'required', timeout: 60000 });
    if (pm[2] === '/confirm') {
      if (state.spent + pay.debit + pay.fee > DAILY_LIMIT * 100) return err(res, 422, 'DAILY_LIMIT_EXCEEDED');
      state.spent += pay.debit + pay.fee;
      Object.assign(pay, { status: 'PROCESSING', confirmedAt: Date.now(), updatedAt: new Date().toISOString() });
      return send(res, 202, { paymentId: pay.id, status: 'PROCESSING' }, { 'Retry-After': '1' });
    }
    if (pm[2] === '/cancel') { pay.status = 'CANCELLED'; pay.updatedAt = new Date().toISOString(); return send(res, 204); }
  }

  if (p === '/agent/messages' && m === 'POST') {
    const text = String(body.text ?? '');
    const amount = (text.replace(/\./g, '').match(/\d{4,}/) ?? ['86400'])[0];
    const base = { conversationId: body.conversationId ?? `conv_${b64(4)}`, reply: { id: `msg_${b64(4)}` } };
    if (/epm|luz|energ/i.test(text) && /\d/.test(text)) {
      const pay = createPayment('https://ilp.interledger-test.dev/epm', `${amount}.00`, 'EPM · número de contrato 7731');
      return send(res, 200, { ...base, reply: { ...base.reply, text: `La factura es de ${Number(amount).toLocaleString('es-CO')} pesos. ¿Hacemos el pago?` }, actions: [{ type: 'confirm_payment', paymentId: pay.id }] });
    }
    if (/luz|pague|pagar/i.test(text)) {
      return send(res, 200, { ...base, reply: { ...base.reply, text: '¿A cuál empresa le pagamos? (Respuesta simulada)' }, actions: [{ type: 'choose_merchant', options: [{ merchantId: 'mer_epm', label: 'EPM · la luz' }, { merchantId: 'mer_enel', label: 'Enel · la luz' }] }] });
    }
    return send(res, 200, { ...base, reply: { ...base.reply, text: 'Soy una respuesta simulada. Pruebe con "Pague la luz de EPM, son 86.400".' }, actions: [] });
  }

  return err(res, 404, 'NOT_FOUND');
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? WEB);
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,idempotency-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = {};
  if (req.method === 'POST') {
    body = await readBody(req);
  }
  try {
    await route(req, res, url, body);
  } catch (e) {
    console.error(e);
    err(res, 500, 'INTERNAL_ERROR');
  }
}).listen(PORT, () => console.log(`API simulada en http://localhost:${PORT}/api/v1`));
