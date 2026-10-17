import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { Code } from 'aws-cdk-lib/aws-lambda'
import { BackendStack } from '../lib/backend-stack.js'

const stage = process.env.STAGE ?? 'dev'

// Build output of the backend (`backend/dist`), produced by the backend build.
const backendDist = fileURLToPath(new URL('../../dist', import.meta.url))

const app = new App()

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
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  }
})
