// Open Payments HTTP fixtures (spec 003, task 6). They follow the OpenAPI
// schemas of the resource and auth servers, because the SDK validates every
// response against them. Hosts use the reserved `.test` TLD.
export const SENDER = {
  id: 'https://wallet.sender.test/alice',
  publicName: 'Alice',
  assetCode: 'USD',
  assetScale: 2,
  authServer: 'https://auth.sender.test',
  resourceServer: 'https://wallet.sender.test'
}

export const RECEIVER = {
  id: 'https://wallet.shop.test/shop',
  publicName: 'Shop',
  assetCode: 'MXN',
  assetScale: 2,
  authServer: 'https://auth.shop.test',
  resourceServer: 'https://wallet.shop.test'
}

export const PLATFORM_WALLET_URL = 'https://wallet.platform.test/tranqui'
export const KEY_ID = 'test-key-id'

const CREATED_AT = '2026-10-16T10:00:00.000Z'

export const walletAddressBody = (w: typeof SENDER) => ({
  id: w.id,
  publicName: w.publicName,
  assetCode: w.assetCode,
  assetScale: w.assetScale,
  authServer: w.authServer,
  resourceServer: w.resourceServer
})

export const accessTokenBody = (
  value: string,
  manage: string,
  access: unknown[],
  expiresIn = 600
) => ({ value, manage, expires_in: expiresIn, access })

export const grantBody = (
  token: ReturnType<typeof accessTokenBody>,
  continueUri = 'https://auth.test/continue/c1'
) => ({
  access_token: token,
  continue: { access_token: { value: 'continue-token' }, uri: continueUri }
})

export const pendingGrantBody = () => ({
  interact: {
    redirect: 'https://auth.sender.test/interact/i1',
    finish: 'server-finish-nonce'
  },
  continue: {
    access_token: { value: 'continue-token' },
    uri: 'https://auth.sender.test/continue/c1',
    wait: 5
  }
})

export const incomingPaymentBody = (receivedValue = '0') => ({
  id: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
  walletAddress: RECEIVER.id,
  incomingAmount: { value: '10000', assetCode: 'MXN', assetScale: 2 },
  receivedAmount: { value: receivedValue, assetCode: 'MXN', assetScale: 2 },
  completed: false,
  createdAt: CREATED_AT,
  expiresAt: '2026-10-16T11:00:00.000Z',
  metadata: { description: 'Order 42' },
  methods: [
    { type: 'ilp', ilpAddress: 'test.shop.ip1', sharedSecret: 'c2hhcmVkLXNlY3JldA' }
  ]
})

export const quoteBody = () => ({
  id: `${SENDER.resourceServer}/quotes/q1`,
  walletAddress: SENDER.id,
  receiver: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
  debitAmount: { value: '550', assetCode: 'USD', assetScale: 2 },
  receiveAmount: { value: '10000', assetCode: 'MXN', assetScale: 2 },
  method: 'ilp',
  createdAt: CREATED_AT,
  expiresAt: '2026-10-16T10:05:00.000Z'
})

export const outgoingPaymentBody = () => ({
  id: `${SENDER.resourceServer}/outgoing-payments/op1`,
  walletAddress: SENDER.id,
  quoteId: `${SENDER.resourceServer}/quotes/q1`,
  receiver: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
  debitAmount: { value: '550', assetCode: 'USD', assetScale: 2 },
  receiveAmount: { value: '10000', assetCode: 'MXN', assetScale: 2 },
  sentAmount: { value: '550', assetCode: 'USD', assetScale: 2 },
  failed: false,
  createdAt: CREATED_AT,
  metadata: { description: 'Coffee' }
})
