import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { Code } from 'aws-cdk-lib/aws-lambda'
import { BackendStack } from '../lib/backend-stack.js'
import { FrontendStack } from '../lib/frontend-stack.js'

const stage = process.env.STAGE ?? 'dev'

// Build output of the backend (`backend/dist`), produced by the backend build.
const backendDist = fileURLToPath(new URL('../../dist', import.meta.url))

// Packaged agent (spec 028): `agent/build.sh`. Without it the stack deploys with no agent.
const agentDist = fileURLToPath(new URL('../../../agent/dist/package', import.meta.url))

const app = new App()

// Frontend hosting (S3 + CloudFront). Its domain is the WebAuthn RP ID of the backend.
new FrontendStack(app, `TranquiFrontend-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  }
})

new BackendStack(app, `TranquiBackend-${stage}`, {
  stage,
  lambdaCode: Code.fromAsset(backendDist),
  lambdaHandler: 'lambda.handler',
  webauthnRpId: process.env.WEBAUTHN_RP_ID,
  webauthnOrigins: process.env.WEBAUTHN_ORIGINS,
  frontendResultUrl: process.env.FRONTEND_RESULT_URL,
  publicApiUrl: process.env.PUBLIC_API_URL,
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  passkeyBypass: process.env.PASSKEY_BYPASS === 'true',
  ...(existsSync(agentDist) ? { agentCode: Code.fromAsset(agentDist) } : {}),
  agentModelId: process.env.AGENT_MODEL_ID,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  }
})
