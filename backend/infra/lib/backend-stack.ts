import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb'
import { type Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface BackendStackProps extends StackProps {
  /** Environment name, used to namespace resources (e.g. `dev`). */
  stage: string
  /** Bundled backend code; inline code in tests, the backend build when deploying. */
  lambdaCode: Code
  /** Handler exported by the backend bundle, e.g. `lambda.handler`. */
  lambdaHandler: string
}

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    // Single hackathon environment: everything is removed with `cdk destroy`.
    const removalPolicy = RemovalPolicy.DESTROY

    // Pending interactive grants live between POST /payments and the callback,
    // which may run in different Lambda instances.
    const grantsTable = new Table(this, 'GrantsTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy
    })

    // Created empty on purpose: the client keys are loaded with the AWS CLI so
    // they never pass through the repo or the CloudFormation template.
    const openPaymentsSecret = new Secret(this, 'OpenPaymentsSecret', {
      secretName: `tranqui/${props.stage}/open-payments`,
      description: 'Open Payments client wallet address, key ID and private key',
      removalPolicy
    })

    const apiKeySecret = new Secret(this, 'ApiKeySecret', {
      secretName: `tranqui/${props.stage}/api-key`,
      description: 'API key expected in the x-api-key header',
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
      removalPolicy
    })

    const logGroup = new LogGroup(this, 'ApiFunctionLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy
    })

    const apiFunction = new Function(this, 'ApiFunction', {
      runtime: Runtime.NODEJS_22_X,
      code: props.lambdaCode,
      handler: props.lambdaHandler,
      memorySize: 512,
      timeout: Duration.seconds(29),
      logGroup,
      environment: {
        OPEN_PAYMENTS_SECRET_ARN: openPaymentsSecret.secretArn,
        API_KEY_SECRET_ARN: apiKeySecret.secretArn,
        GRANTS_TABLE_NAME: grantsTable.tableName
      }
    })

    grantsTable.grantReadWriteData(apiFunction)
    openPaymentsSecret.grantRead(apiFunction)
    apiKeySecret.grantRead(apiFunction)

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `tranqui-${props.stage}-api`
    })
    httpApi.addRoutes({
      path: '/{proxy+}',
      integration: new HttpLambdaIntegration('ApiIntegration', apiFunction)
    })

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
  }
}
