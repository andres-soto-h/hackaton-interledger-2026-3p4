import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:api-key'
const OP_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:open-payments'

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
  Promise.resolve({
    SecretString:
      input.SecretId === API_KEY_ARN
        ? 'lambda-api-key'
        : JSON.stringify({
            walletAddressUrl: 'https://ilp.interledger-test.dev/platform',
            keyId: 'fake-key-id',
            privateKey: 'fake-private-key'
          })
  })
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
    // Cold start: both secrets read from Secrets Manager by ARN.
    expect(fetchedArns().sort()).toEqual([API_KEY_ARN, OP_ARN].sort())
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
})
