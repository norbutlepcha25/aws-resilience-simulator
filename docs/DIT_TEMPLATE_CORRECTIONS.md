# DIT ECS template corrections

Source: https://docs.aws.amazon.com/solutions/latest/dynamic-image-transformation-for-amazon-cloudfront/ecs-architecture.html
VPC origins: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html

The template is a partial educational topology, not a full implementation of the AWS solution.

Corrected ECS service identity and Fargate configuration, ECR identity and pull direction, missing ECS-to-admin-table dependency, portal authentication arrow, CIDRs, scoped task/admin policies, and security group attachments. Explicit cache miss state prevents image filename extensions from short-circuiting the example. An explicit cache hit can be selected in architecture data. CloudFront's configured private origin checks its internal target and IGW prerequisite.

Default forwarding paths:
- Client → CloudFront → internal ALB → ECS → IGW → source S3.
- Admin → web client → API Gateway → Lambda → configuration DynamoDB.
- Portal CloudFront → Amplify → portal S3.

Dependency arrows remain separate from forwarding. The ECS-to-DynamoDB policy lookup is a supported required child call: it checks target availability and IAM, records an animated ECS → DynamoDB step, returns to ECS, and then continues the image request to S3. Other dependency arrows remain display-only and are not proof that startup, authentication, or optional API calls succeeded. In particular, the admin flow does not validate Cognito tokens, and the portal flow does not validate CloudFront origin access control.

Still unsupported: full image transformation, viewer-request header normalization, conditional origin selection, policy and detection caches, Rekognition execution, ECR startup/execution roles, Cognito authentication, CloudFront service-managed ENI lifecycle, full VPC-origin security and NACL exceptions, explicit route-table evaluation in this live path, and actual multi-AZ task placement. Security group controls here use the existing simplified protocol model, not a complete production security policy. VPC-origin IGW lookup remains architecture-wide, so multi-VPC attachment correctness is not established.

The isolated ALB subnet uses the canvas's private-subnet representation and keeps its isolated label. IGW uses the global/non-subnet placement representation. Existing geometry regression assertions are preserved.

Tests: `test/dit-template.test.ts` exercises the ECS DynamoDB child call and return, primary paths, deterministic execution, missing IAM, failed DynamoDB, zero tasks, SG denial, S3 failure, explicit cache hit, and missing VPC-origin IGW prerequisite. Other legacy templates retain their cache heuristic unless they specify cache state.
