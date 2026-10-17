export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(init: { code: string; message: string; status: number; requestId?: string; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

type RequestOptions = {
  query?: Query;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Tiempo máximo de esta petición (por omisión, el del cliente). */
  timeoutMs?: number;
};

export type ApiResponse<T> = { data: T; retryAfterSeconds?: number };

export type ApiClientConfig = { baseUrl: string; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 15_000;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${baseUrl.replace(/\/$/, '')}${path}${search ? `?${search}` : ''}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const error = (body as { error?: Record<string, unknown> } | undefined)?.error;
  if (error && typeof error.code === 'string' && typeof error.message === 'string') {
    return new ApiError({
      code: error.code,
      message: error.message,
      status: response.status,
      requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
      details: error.details,
    });
  }
  return new ApiError({
    code: 'UNKNOWN_ERROR',
    message: `Respuesta inesperada (${response.status})`,
    status: response.status,
  });
}

export function createApiClient({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS }: ApiClientConfig) {
  let tokenProvider: () => string | null = () => null;
  let unauthorizedHandler: () => void = () => {};

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? timeoutMs);
    options.signal?.addEventListener('abort', () => controller.abort());

    let response: Response;
    try {
      response = await fetch(buildUrl(baseUrl, path, options.query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        timedOut
          ? { code: 'TIMEOUT', message: 'La API no respondió a tiempo', status: 0 }
          : { code: 'NETWORK_ERROR', message: 'No hay conexión con la API', status: 0 },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await toApiError(response);
      if (response.status === 401) unauthorizedHandler();
      throw error;
    }

    const retryAfter = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
    const text = response.status === 204 ? '' : await response.text();
    return { data: (text ? JSON.parse(text) : undefined) as T, retryAfterSeconds };
  }

  return {
    get: async <T>(path: string, options?: RequestOptions) =>
      (await request<T>('GET', path, undefined, options)).data,
    getWithHeaders: <T>(path: string, options?: RequestOptions) =>
      request<T>('GET', path, undefined, options),
    post: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      (await request<T>('POST', path, body ?? {}, options)).data,
    delete: async (path: string, options?: RequestOptions): Promise<void> => {
      await request<void>('DELETE', path, undefined, options);
    },
    setTokenProvider(provider: () => string | null) {
      tokenProvider = provider;
    },
    onUnauthorized(handler: () => void) {
      unauthorizedHandler = handler;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Cliente de la app: base URL pública (sin secretos en el bundle). */
export const apiClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1',
});
