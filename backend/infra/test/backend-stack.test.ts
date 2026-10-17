import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { Code } from 'aws-cdk-lib/aws-lambda'
import { beforeAll, describe, expect, it } from 'vitest'
import { BackendStack, type BackendStackProps } from '../lib/backend-stack.js'

type Statement = { Action: string | string[]; Resource: unknown }

let template: Template

const synth = (props: Partial<BackendStackProps> = {}): Template => {
  const app = new App()
  const stack = new BackendStack(app, 'TestBackendStack', {
    stage: 'dev',
    lambdaCode: Code.fromInline('exports.handler = async () => ({})'),
    lambdaHandler: 'lambda.handler',
    ...props
  })
  return Template.fromStack(stack)
}

beforeAll(() => {
  template = synth()
})

const logicalId = (type: string, props: Record<string, unknown>): string => {
  const ids = Object.keys(template.findResources(type, { Properties: props }))
  expect(ids).toHaveLength(1)
  return ids[0]!
}

const apiFunctionId = () =>
  logicalId('AWS::Lambda::Function', { Handler: 'lambda.handler' })

const lambdaStatements = (): Statement[] => {
  const roleRef = template.findResources('AWS::Lambda::Function')[apiFunctionId()]!
    .Properties.Role['Fn::GetAtt'][0]
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: { Roles: [{ Ref: roleRef }] }
  })
  return Object.values(policies).flatMap(
    (p) => p.Properties.PolicyDocument.Statement as Statement[]
  )
}

const actionsOf = (s: Statement) => [s.Action].flat()

describe('BackendStack', () => {
  // Caso 1
  it('crea la Lambda de la API con Node.js 22 y el handler esperado', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'lambda.handler'
    })
  })

  // Caso 2
  it('expone la Lambda con una HTTP API y ruta proxy', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP'
    })
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: { 'Fn::GetAtt': [apiFunctionId(), 'Arn'] }
    })
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /{proxy+}'
    })
  })

  // Caso 3
  it('crea la tabla de pagos on-demand y con TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true }
    })
  })

  // Caso 4
  it('crea los secretos y la Lambda solo puede leer esos dos', () => {
    const opSecret = logicalId('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/open-payments'
    })
    const apiKeySecret = logicalId('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/api-key'
    })
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/api-key',
      GenerateSecretString: Match.objectLike({ ExcludePunctuation: true })
    })

    const secretStatements = lambdaStatements().filter((s) =>
      actionsOf(s).some((a) => a.startsWith('secretsmanager:'))
    )
    expect(secretStatements.length).toBeGreaterThan(0)
    for (const s of secretStatements) {
      expect(s.Resource).not.toBe('*')
    }
    const readable = secretStatements
      .filter((s) => actionsOf(s).includes('secretsmanager:GetSecretValue'))
      .map((s) => s.Resource)
    expect(readable).toEqual(
      expect.arrayContaining([{ Ref: opSecret }, { Ref: apiKeySecret }])
    )
    expect(readable).toHaveLength(2)
  })

  // Caso 5
  it('limita el acceso de DynamoDB a la tabla de pagos y sus índices', () => {
    const tableId = logicalId('AWS::DynamoDB::Table', {})
    const tableArn = { 'Fn::GetAtt': [tableId, 'Arn'] }
    // Queries on bySender / byReceiver need the index ARNs too.
    const indexesArn = { 'Fn::Join': ['', [tableArn, '/index/*']] }
    const dynamoStatements = lambdaStatements().filter((s) =>
      actionsOf(s).some((a) => a.startsWith('dynamodb:'))
    )
    expect(dynamoStatements.length).toBeGreaterThan(0)
    const resources = dynamoStatements.flatMap((s) =>
      [s.Resource]
        .flat()
        .filter((r) => JSON.stringify(r) !== JSON.stringify({ Ref: 'AWS::NoValue' }))
    )
    expect(resources).toEqual(expect.arrayContaining([tableArn, indexesArn]))
    for (const r of resources) {
      expect([tableArn, indexesArn]).toContainEqual(r)
    }
    expect(dynamoStatements.flatMap(actionsOf)).toContain('dynamodb:Query')
  })

  // Caso 6
  it('pasa a la Lambda referencias a los secretos, nunca sus valores', () => {
    const fn = template.findResources('AWS::Lambda::Function')[apiFunctionId()]!
    const env: Record<string, unknown> = fn.Properties.Environment.Variables
    const opSecret = logicalId('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/open-payments'
    })
    const apiKeySecret = logicalId('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/api-key'
    })

    expect(env).toMatchObject({
      OPEN_PAYMENTS_SECRET_ARN: { Ref: opSecret },
      API_KEY_SECRET_ARN: { Ref: apiKeySecret },
      PAYMENTS_TABLE_NAME: { Ref: logicalId('AWS::DynamoDB::Table', {}) }
    })
    const serialized = JSON.stringify(env)
    expect(serialized).not.toContain('PRIVATE KEY')
    expect(serialized).not.toContain('resolve:secretsmanager')
  })

  // Caso 7
  it('envía los logs de la Lambda a un log group con retención de 14 días', () => {
    const logGroup = logicalId('AWS::Logs::LogGroup', { RetentionInDays: 14 })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'lambda.handler',
      LoggingConfig: { LogGroup: { Ref: logGroup } }
    })
  })

  // Caso 8
  it('no define el valor del secreto de Open Payments en el template', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'tranqui/dev/open-payments',
      SecretString: Match.absent()
    })
  })

  // Caso 9
  it('elimina tabla, secretos y logs al destruir el stack', () => {
    for (const type of [
      'AWS::DynamoDB::Table',
      'AWS::SecretsManager::Secret',
      'AWS::Logs::LogGroup'
    ]) {
      const resources = Object.values(template.findResources(type))
      expect(resources.length).toBeGreaterThan(0)
      for (const r of resources) {
        expect(r.DeletionPolicy).toBe('Delete')
      }
    }
  })

  // Caso 12
  it('crea los índices bySender y byReceiver con createdAt como sort key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'bySender',
          KeySchema: [
            { AttributeName: 'senderWalletAddress', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        }),
        Match.objectLike({
          IndexName: 'byReceiver',
          KeySchema: [
            { AttributeName: 'receiverWalletAddress', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        })
      ])
    })
  })

  // Caso 13
  it('configura throttling en el stage por defecto de la HTTP API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 }
    })
  })

  it('permite cambiar el throttling con las propiedades del stack', () => {
    synth({ throttling: { rateLimit: 5, burstLimit: 8 } }).hasResourceProperties(
      'AWS::ApiGatewayV2::Stage',
      {
        StageName: '$default',
        DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 8 }
      }
    )
  })

  // Caso 14
  it('pasa a la Lambda la tabla de pagos y la configuración de Open Payments', () => {
    const fn = template.findResources('AWS::Lambda::Function')[apiFunctionId()]!
    const env: Record<string, unknown> = fn.Properties.Environment.Variables

    expect(env).toMatchObject({
      PAYMENTS_TABLE_NAME: { Ref: logicalId('AWS::DynamoDB::Table', {}) },
      OPEN_PAYMENTS_TIMEOUT_MS: '8000',
      MAX_PAYMENT_AMOUNTS: 'USD:1000'
    })
    expect(env).not.toHaveProperty('GRANTS_TABLE_NAME')
    // Optional values are left out so the backend applies its own defaults.
    expect(env).not.toHaveProperty('ALLOWED_WALLET_HOSTS')
    expect(env).not.toHaveProperty('FRONTEND_RESULT_URL')
  })

  it('pasa a la Lambda la configuración definida en las propiedades del stack', () => {
    const custom = synth({
      maxPaymentAmounts: 'USD:500,MXN:9000',
      allowedWalletHosts: 'wallet.example,pay.example',
      frontendResultUrl: 'https://app.example/result',
      openPaymentsTimeoutMs: 5000
    })
    custom.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'lambda.handler',
      Environment: {
        Variables: Match.objectLike({
          MAX_PAYMENT_AMOUNTS: 'USD:500,MXN:9000',
          ALLOWED_WALLET_HOSTS: 'wallet.example,pay.example',
          FRONTEND_RESULT_URL: 'https://app.example/result',
          OPEN_PAYMENTS_TIMEOUT_MS: '5000'
        })
      }
    })
  })

  // Caso 15
  it('crea filtros de métricas sobre los logs para 401 y CALLBACK_INVALID', () => {
    const logGroup = logicalId('AWS::Logs::LogGroup', { RetentionInDays: 14 })
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      LogGroupName: { Ref: logGroup },
      FilterPattern: '{ $.statusCode = 401 }',
      MetricTransformations: [
        Match.objectLike({ MetricNamespace: 'Tranqui/dev', MetricName: 'Unauthorized' })
      ]
    })
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      LogGroupName: { Ref: logGroup },
      FilterPattern: '{ $.errorCode = "CALLBACK_INVALID" }',
      MetricTransformations: [
        Match.objectLike({ MetricNamespace: 'Tranqui/dev', MetricName: 'CallbackInvalid' })
      ]
    })
  })

  it('crea las alarmas de 5xx, 401 y CALLBACK_INVALID', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
      Dimensions: [{ Name: 'ApiId', Value: Match.anyValue() }]
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'Tranqui/dev',
      MetricName: 'Unauthorized'
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'Tranqui/dev',
      MetricName: 'CallbackInvalid'
    })
    for (const alarm of Object.values(template.findResources('AWS::CloudWatch::Alarm'))) {
      expect(alarm.Properties.ComparisonOperator).toBe(
        'GreaterThanOrEqualToThreshold'
      )
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching')
    }
  })

  it('publica la URL de la API como output', () => {
    template.hasOutput('ApiUrl', {})
  })
})
