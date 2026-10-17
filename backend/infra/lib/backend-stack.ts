import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { CfnStage, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb'
import { type Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface BackendStackProps extends StackProps {
  /** Environment name, used to namespace resources (e.g. `dev`). */
  stage: string
  /** Bundled backend code; inline code in tests, the backend build when deploying. */
  lambdaCode: Code
  /** Handler exported by the backend bundle, e.g. `lambda.handler`. */
  lambdaHandler: string
  /** Comma-separated `ASSET_CODE:amount` limits, e.g. `USD:1000,MXN:20000`. */
  maxPaymentAmounts?: string
  /** Comma-separated allowed wallet hosts (no scheme). Only passed when set. */
  allowedWalletHosts?: string
  /** URL the Open Payments callback redirects to after finishing. Only passed when set. */
  frontendResultUrl?: string
  /** Open Payments client timeout in milliseconds (sent to the Lambda as a string). */
  openPaymentsTimeoutMs?: number
  /** Throttling of the `$default` stage: requests per second and burst. */
  throttling?: { rateLimit: number; burstLimit: number }
  /** WebAuthn relying party ID (the frontend domain). Only passed when set. */
  webauthnRpId?: string
  /** Comma-separated exact origins allowed for WebAuthn. Only passed when set. */
  webauthnOrigins?: string
  /** Base URL of the wallet provider. Only passed when set. */
  walletProviderBaseUrl?: string
  /** Comma-separated `ASSET_CODE:amount` daily spend limits, e.g. `USD:200,MXN:4000`. */
  dailySpendLimits?: string
  /** IANA timezone for daily limits, e.g. `America/Bogota`. */
  dailyLimitTimezone?: string
  /** Decimal fee percentage, e.g. `1.5`. */
  feePercentage?: string
  /** Enables the admin panel; defaults to `true` in `dev`, `false` elsewhere. */
  adminEnabled?: boolean
}

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    // Single hackathon environment: everything is removed with `cdk destroy`.
    const removalPolicy = RemovalPolicy.DESTROY
    const metricNamespace = `Tranqui/${props.stage}`
    const maxPaymentAmounts = props.maxPaymentAmounts ?? 'USD:1000'
    const openPaymentsTimeoutMs = String(props.openPaymentsTimeoutMs ?? 8000)
    const throttling = props.throttling ?? { rateLimit: 10, burstLimit: 20 }
    const adminEnabled = props.adminEnabled ?? props.stage === 'dev'

    // Payments and requests live between invocations of the Lambda, with
    // indexes to list them by the sender's and receiver's wallet address.
    const paymentsTable = new Table(this, 'PaymentsTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy
    })
    paymentsTable.addGlobalSecondaryIndex({
      indexName: 'bySender',
      partitionKey: { name: 'senderWalletAddress', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    })
    paymentsTable.addGlobalSecondaryIndex({
      indexName: 'byReceiver',
      partitionKey: { name: 'receiverWalletAddress', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    })
    paymentsTable.addGlobalSecondaryIndex({
      indexName: 'byType',
      partitionKey: { name: 'entityType', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    })
    paymentsTable.addGlobalSecondaryIndex({
      indexName: 'byUser',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    })
    paymentsTable.addGlobalSecondaryIndex({
      indexName: 'byPayment',
      partitionKey: { name: 'paymentId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
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

    // Generated by AWS, never in code or in the template: the Lambda only reads them.
    const sessionSigningKeySecret = new Secret(this, 'SessionSigningKeySecret', {
      secretName: `tranqui/${props.stage}/session-signing-key`,
      description: 'Session JWT signing key',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy
    })

    const adminPasswordSecret = new Secret(this, 'AdminPasswordSecret', {
      secretName: `tranqui/${props.stage}/admin-password`,
      description: 'Admin panel password',
      generateSecretString: { excludePunctuation: true, passwordLength: 32 },
      removalPolicy
    })

    const tokenEncryptionKeySecret = new Secret(this, 'TokenEncryptionKeySecret', {
      secretName: `tranqui/${props.stage}/token-encryption-key`,
      description: 'AES-256 key derived (SHA-256) to encrypt link tokens',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy
    })

    const logGroup = new LogGroup(this, 'ApiFunctionLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy
    })

    const environment: Record<string, string> = {
      OPEN_PAYMENTS_SECRET_ARN: openPaymentsSecret.secretArn,
      API_KEY_SECRET_ARN: apiKeySecret.secretArn,
      PAYMENTS_TABLE_NAME: paymentsTable.tableName,
      OPEN_PAYMENTS_TIMEOUT_MS: openPaymentsTimeoutMs,
      MAX_PAYMENT_AMOUNTS: maxPaymentAmounts,
      SESSION_SECRET_ARN: sessionSigningKeySecret.secretArn,
      ADMIN_PASSWORD_SECRET_ARN: adminPasswordSecret.secretArn,
      TOKEN_KEY_SECRET_ARN: tokenEncryptionKeySecret.secretArn,
      ADMIN_ENABLED: String(adminEnabled)
    }
    // Optional: only passed when the stack props define them, so the backend
    // applies its own defaults otherwise.
    if (props.allowedWalletHosts !== undefined) {
      environment.ALLOWED_WALLET_HOSTS = props.allowedWalletHosts
    }
    if (props.frontendResultUrl !== undefined) {
      environment.FRONTEND_RESULT_URL = props.frontendResultUrl
    }
    if (props.webauthnRpId !== undefined) {
      environment.WEBAUTHN_RP_ID = props.webauthnRpId
    }
    if (props.webauthnOrigins !== undefined) {
      environment.WEBAUTHN_ORIGINS = props.webauthnOrigins
    }
    if (props.walletProviderBaseUrl !== undefined) {
      environment.WALLET_PROVIDER_BASE_URL = props.walletProviderBaseUrl
    }
    if (props.dailySpendLimits !== undefined) {
      environment.DAILY_SPEND_LIMITS = props.dailySpendLimits
    }
    if (props.dailyLimitTimezone !== undefined) {
      environment.DAILY_LIMIT_TIMEZONE = props.dailyLimitTimezone
    }
    if (props.feePercentage !== undefined) {
      environment.FEE_PERCENTAGE = props.feePercentage
    }

    const apiFunction = new Function(this, 'ApiFunction', {
      runtime: Runtime.NODEJS_22_X,
      code: props.lambdaCode,
      handler: props.lambdaHandler,
      memorySize: 512,
      timeout: Duration.seconds(29),
      logGroup,
      environment
    })

    // Minimum privilege: read/write (including Query) on the payments table and
    // its indexes only; grants the table ARN and `tableArn/index/*`, nothing else.
    paymentsTable.grantReadWriteData(apiFunction)
    openPaymentsSecret.grantRead(apiFunction)
    apiKeySecret.grantRead(apiFunction)
    sessionSigningKeySecret.grantRead(apiFunction)
    adminPasswordSecret.grantRead(apiFunction)
    tokenEncryptionKeySecret.grantRead(apiFunction)

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `tranqui-${props.stage}-api`
    })
    httpApi.addRoutes({
      path: '/{proxy+}',
      integration: new HttpLambdaIntegration('ApiIntegration', apiFunction)
    })

    // Throttle the default stage to limit abuse (10 req/s, burst 20 by default).
    const defaultStage = httpApi.defaultStage!.node.defaultChild as CfnStage
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: throttling.rateLimit,
      throttlingBurstLimit: throttling.burstLimit
    }

    // Emit metrics from the Lambda's JSON logs (see SEGURIDAD.md — Monitoreo).
    const unauthorizedMetric = new MetricFilter(this, 'UnauthorizedMetricFilter', {
      logGroup,
      filterPattern: FilterPattern.literal('{ $.statusCode = 401 }'),
      metricNamespace,
      metricName: 'Unauthorized',
      metricValue: '1'
    })
    const callbackInvalidMetric = new MetricFilter(this, 'CallbackInvalidMetricFilter', {
      logGroup,
      filterPattern: FilterPattern.literal('{ $.errorCode = "CALLBACK_INVALID" }'),
      metricNamespace,
      metricName: 'CallbackInvalid',
      metricValue: '1'
    })

    const fiveXxMetric = new Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: httpApi.apiId },
      period: Duration.minutes(5),
      statistic: 'Sum'
    })

    new Alarm(this, 'Api5xxAlarm', {
      metric: fiveXxMetric,
      threshold: 5,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      evaluationPeriods: 1
    })
    new Alarm(this, 'UnauthorizedAlarm', {
      metric: unauthorizedMetric.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 20,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      evaluationPeriods: 1
    })
    new Alarm(this, 'CallbackInvalidAlarm', {
      metric: callbackInvalidMetric.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 5,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      evaluationPeriods: 1
    })

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
  }
}
