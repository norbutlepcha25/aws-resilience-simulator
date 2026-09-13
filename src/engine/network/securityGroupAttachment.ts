import type { ServiceNodeData } from '../../types/index.ts';

/** Inspector support for resource/ENI attachments, not subnet or VPC firewalls.
 * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
 * This is deliberately limited to modeled attachment surfaces.
 */
export function supportsSecurityGroupAttachment(node: ServiceNodeData): boolean {
  if (node.serviceId === 'lambda') return ['public', 'private', 'isolated'].includes(node.subnet);
  return ['ec2', 'ecs', 'fargate', 'eks', 'alb', 'nlb', 'elb', 'rds', 'aurora',
    'elasticache', 'efs', 'privatelink', 'eni'].includes(node.serviceId);
}
