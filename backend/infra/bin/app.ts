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
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  }
})
