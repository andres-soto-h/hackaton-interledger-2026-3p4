import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import {
  AllowedMethods,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  PriceClass,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

export interface FrontendStackProps extends StackProps {
  /** Environment name, used to namespace resources (e.g. `dev`). */
  stage: string
}

/**
 * Hosting of the Expo web export (`frontend/dist`): private S3 bucket behind
 * CloudFront (OAC). The distribution domain is the WebAuthn RP ID of the backend,
 * so this stack is deployed BEFORE the backend. The content is published with
 * `scripts/desplegar-todo.sh` (s3 sync + invalidation), not with CDK.
 */
export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props)

    const bucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // Expo "static" output emits `cuenta.html`, `comercios/index.html`...: map the
    // clean URLs (`/cuenta`, `/comercios/`) to those files.
    const rewrite = new CloudFrontFunction(this, 'RewriteFunction', {
      code: FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    request.uri = uri + '.html';
  }
  return request;
}`)
    })

    const distribution = new Distribution(this, 'Distribution', {
      comment: `tranqui-${props.stage}-frontend`,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [
          { function: rewrite, eventType: FunctionEventType.VIEWER_REQUEST }
        ]
      },
      // Dynamic routes (`/comercios/<id>`) have no file: the client router resolves them.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(10)
      }))
    })

    new CfnOutput(this, 'BucketName', { value: bucket.bucketName })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName })
  }
}
