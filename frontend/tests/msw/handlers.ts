import type { RequestHandler } from 'msw';
import { authHandlers } from './auth';
import { registerHandlers } from './register';
import { transactionHandlers } from './transactions';

export { API } from './config';

// Los specs agregan aquí sus handlers con los contratos del backend (ver tests/msw/auth.ts, etc.).
export const handlers: RequestHandler[] = [...authHandlers, ...registerHandlers, ...transactionHandlers];
