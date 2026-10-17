import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { AgentGateway } from '../../modules/agent/agent.types.js'

/**
 * Invokes the agent function (spec 028) synchronously. The payload carries the
 * user's session token, so it is never logged here; a function error (the
 * agent crashed or timed out) is thrown and the service answers 503.
 */
export function createLambdaAgentGateway({
  functionName,
  client = new LambdaClient({})
}: {
  functionName: string
  client?: Pick<LambdaClient, 'send'>
}): AgentGateway {
  return {
    async invoke(input) {
      const result = await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify(input))
        })
      )
      const payload =
        result.Payload === undefined ? '' : Buffer.from(result.Payload).toString('utf8')
      if (result.FunctionError !== undefined) {
        throw new Error(`Agent function error: ${result.FunctionError}`)
      }
      return JSON.parse(payload) as unknown
    }
  }
}
