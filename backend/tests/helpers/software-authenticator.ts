import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

// A software WebAuthn authenticator (ES256, "none" attestation) so the real
// SimpleWebAuthn adapter can be verified without a physical authenticator.

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
const sha256 = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest()

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 256) return Buffer.from([(major << 5) | 24, length])
  const out = Buffer.alloc(3)
  out[0] = (major << 5) | 25
  out.writeUInt16BE(length, 1)
  return out
}

/** Minimal CBOR encoder: integers, text, bytes and maps are all WebAuthn needs. */
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value)
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, text.length), text])
  }
  if (value instanceof Map) {
    const parts: Buffer[] = [head(5, value.size)]
    for (const [k, v] of value) parts.push(cbor(k), cbor(v))
    return Buffer.concat(parts)
  }
  return Buffer.concat([head(2, value.length), value])
}

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40
const FLAG_BE = 0x08
const FLAG_BS = 0x10

export interface SoftwareAuthenticator {
  credentialId: string
  /** What the browser returns from `navigator.credentials.create()` (JSON form). */
  register(input: { challenge: string; origin: string; rpID: string }): unknown
  /** What the browser returns from `navigator.credentials.get()` (JSON form). */
  authenticate(input: {
    challenge: string
    origin: string
    rpID: string
    counter: number
  }): unknown
}

export function createSoftwareAuthenticator(
  seed = 'cred-software-1'
): SoftwareAuthenticator {
  const { publicKey, privateKey }: { publicKey: KeyObject; privateKey: KeyObject } =
    generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credentialIdBytes = sha256(Buffer.from(seed))
  const credentialId = b64u(credentialIdBytes)

  const coseKey = cbor(
    new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')]
    ])
  )

  const clientData = (type: string, challenge: string, origin: string): Buffer =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

  const counterBytes = (counter: number): Buffer => {
    const out = Buffer.alloc(4)
    out.writeUInt32BE(counter, 0)
    return out
  }

  return {
    credentialId,
    register({ challenge, origin, rpID }) {
      const flags = FLAG_UP | FLAG_UV | FLAG_AT | FLAG_BE | FLAG_BS
      const idLength = Buffer.alloc(2)
      idLength.writeUInt16BE(credentialIdBytes.length, 0)
      const authData = Buffer.concat([
        sha256(Buffer.from(rpID)),
        Buffer.from([flags]),
        counterBytes(0),
        Buffer.alloc(16),
        idLength,
        credentialIdBytes,
        coseKey
      ])
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map<Cbor, Cbor>()],
          ['authData', authData]
        ])
      )
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientData('webauthn.create', challenge, origin)),
          attestationObject: b64u(attestationObject),
          transports: ['internal']
        },
        clientExtensionResults: {}
      }
    },
    authenticate({ challenge, origin, rpID, counter }) {
      const flags = FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS
      const authData = Buffer.concat([
        sha256(Buffer.from(rpID)),
        Buffer.from([flags]),
        counterBytes(counter)
      ])
      const clientDataJSON = clientData('webauthn.get', challenge, origin)
      const signature = sign(
        'sha256',
        Buffer.concat([authData, sha256(clientDataJSON)]),
        privateKey
      )
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientDataJSON),
          authenticatorData: b64u(authData),
          signature: b64u(signature)
        },
        clientExtensionResults: {}
      }
    }
  }
}
