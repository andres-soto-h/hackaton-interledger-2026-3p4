import type { RequestHandler } from 'msw';
import { authHandlers } from './auth';

export { API } from './config';

// Los specs agregan aquí sus handlers con los contratos del backend (ver tests/msw/auth.ts, etc.).
export const handlers: RequestHandler[] = [...authHandlers];
