import { generateKeyPairSync } from 'node:crypto'
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:api-key'
const OP_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:open-payments'
const SESSION_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:session-signing-key'
const ADMIN_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:admin-password'
const TOKEN_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:token-encryption-key'

// A real (throwaway) Ed25519 key: the cold start parses it like in production.
const privateKeyPem = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
const secretValues: Record<string, string> = {
  [API_KEY_ARN]: 'lambda-api-key',
  [SESSION_ARN]: 's'.repeat(64),
  [ADMIN_ARN]: 'lambda-admin-password',
  [TOKEN_ARN]: 't'.repeat(64),
  [OP_ARN]: JSON.stringify({
    walletAddressUrl: 'https://ilp.interledger-test.dev/platform',
    keyId: 'fake-key-id',
    privateKey: privateKeyPem
  })
}

// Secrets Manager mocked: tests never call AWS.
const send = vi.hoisted(() => vi.fn())
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = send
  },
  GetSecretValueCommand: class {
    constructor(readonly input: { SecretId: string }) {}
  }
}))

send.mockImplementation(({ input }: { input: { SecretId: string } }) =>
  Promise.resolve({ SecretString: secretValues[input.SecretId] })
)

const httpApiEvent = (
  method: string,
  path: string,
  headers: Record<string, string> = {}
): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey: 'ANY /{proxy+}',
  rawPath: path,
  rawQueryString: '',
  headers: { host: 'api.example.com', ...headers },
  isBase64Encoded: false,
  requestContext: {
    accountId: '123456789012',
    apiId: 'api',
    domainName: 'api.example.com',
    domainPrefix: 'api',
    http: {
      method,
      path,
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test'
    },
    requestId: 'request-id',
    routeKey: 'ANY /{proxy+}',
    stage: '$default',
    time: '16/Oct/2026:00:00:00 +0000',
    timeEpoch: 1_791_000_000_000
  }
})

const context = {} as Context

let handler: (typeof import('../../src/lambda.js'))['handler']

beforeAll(async () => {
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'tranqui-api')
  vi.stubEnv('API_KEY_SECRET_ARN', API_KEY_ARN)
  vi.stubEnv('OPEN_PAYMENTS_SECRET_ARN', OP_ARN)
  vi.stubEnv('SESSION_SECRET_ARN', SESSION_ARN)
  vi.stubEnv('ADMIN_PASSWORD_SECRET_ARN', ADMIN_ARN)
  vi.stubEnv('TOKEN_KEY_SECRET_ARN', TOKEN_ARN)
  vi.stubEnv('PAYMENTS_TABLE_NAME', 'payments-table')
  vi.stubEnv('AWS_REGION', 'us-east-1')
  vi.stubEnv('LOG_LEVEL', 'silent')
  ;({ handler } = await import('../../src/lambda.js'))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

const fetchedArns = () =>
  send.mock.calls.map(
    ([command]) => (command as { input: { SecretId: string } }).input.SecretId
  )

describe('handler de Lambda', () => {
  // Caso 15
  it('responde 200 a un evento de HTTP API para GET /health', async () => {
    const result = await handler(httpApiEvent('GET', '/health'), context)

    expect(result).toMatchObject({ statusCode: 200 })
    expect(JSON.parse((result as { body: string }).body)).toEqual({ status: 'ok' })
    // Cold start: the five secrets are read from Secrets Manager by ARN.
    expect(fetchedArns().sort()).toEqual(
      [API_KEY_ARN, OP_ARN, SESSION_ARN, ADMIN_ARN, TOKEN_ARN].sort()
    )
  })

  it('usa la API key de Secrets Manager en las rutas protegidas', async () => {
    const denied = await handler(httpApiEvent('GET', '/api/v1/nope'), context)
    const allowed = await handler(
      httpApiEvent('GET', '/api/v1/nope', { 'x-api-key': 'lambda-api-key' }),
      context
    )

    expect(denied).toMatchObject({ statusCode: 401 })
    expect(allowed).toMatchObject({ statusCode: 404 })
  })

  it('reutiliza los secretos en invocaciones posteriores', async () => {
    send.mockClear()

    await handler(httpApiEvent('GET', '/health'), context)

    expect(send).not.toHaveBeenCalled()
  })

  it('monta los módulos: auth es pública y /me pide la sesión', async () => {
    const auth = await handler(
      {
        ...httpApiEvent('POST', '/api/v1/auth/register/options', {
          'content-type': 'application/json'
        }),
        body: '{}'
      },
      context
    )
    expect(auth).toMatchObject({ statusCode: 400 })
    const me = await handler(httpApiEvent('GET', '/api/v1/me'), context)
    expect(me).toMatchObject({ statusCode: 401 })
    const meBody = JSON.parse((me as { body: string }).body) as {
      error: { code: string }
    }
    expect(meBody.error.code).toBe('SESSION_INVALID')
  })

  it('sirve el panel sin API key y no monta la página de prueba de passkeys', async () => {
    const login = await handler(httpApiEvent('GET', '/admin/login'), context)
    expect(login).toMatchObject({ statusCode: 200 })
    const dev = await handler(httpApiEvent('GET', '/dev/passkeys'), context)
    expect(dev).toMatchObject({ statusCode: 404 })
  })

  it('usa el dominio de la petición como URL pública para el grant de Open Payments', async () => {
    const { resolvePublicApiUrl } = await import('../../src/composition/bootstrap.js')
    expect(
      resolvePublicApiUrl(
        { publicApiUrl: undefined },
        httpApiEvent('GET', '/health').requestContext.domainName
      )
    ).toBe('https://api.example.com')
    expect(
      resolvePublicApiUrl(
        { publicApiUrl: 'https://api.custom.example' },
        'api.example.com'
      )
    ).toBe('https://api.custom.example')
  })
})
