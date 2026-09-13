import type { Node } from '@xyflow/react';
import type { ServiceNodeData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';

const COMPUTE_SERVICE_IDS = ['ec2', 'ecs', 'fargate'];
const DB_SERVICE_IDS = ['rds', 'aurora'];

/**
 * Missing redundancy is about a component's OWN configuration lacking a failover mechanism -
 * distinct from `spofDetector.ts`'s "no alternate path exists in the graph" framing, though the
 * two often point at the same resource. Both a valid CIDR and a legal Security Group rule can
 * still describe a database with zero standby replicas - this only ever comments on that, never
 * on whether the configuration itself is legal.
 */
export function detectMissingRedundancy(nodes: Node<ServiceNodeData>[]): Finding[] {
  const findings: Finding[] = [];
  const serviceNodes = nodes.filter(n => n.type !== 'boundaryNode');

  for (const node of serviceNodes) {
    if (COMPUTE_SERVICE_IDS.includes(node.data.serviceId) && node.data.replicas <= 1) {
      findings.push(makeFinding('architecture', 'redundancy', {
        severity: 'MEDIUM',
        resource: node.data.label,
        resourceId: node.id,
        problem: `${node.data.label} runs a single instance/task (replicas: ${node.data.replicas}).`,
        whyItMatters: 'A single instance has no capacity to absorb a health-check failure, an AZ outage, or routine maintenance - any one of those takes the entire service down.',
        awsRule: 'Compute behind a Load Balancer or ECS/Fargate service should run at least two tasks/instances across at least two Availability Zones for high availability.',
        recommendation: `Increase ${node.data.label} to at least 2 replicas spread across separate Availability Zones.`
      }));
    }

    if (DB_SERVICE_IDS.includes(node.data.serviceId) && !node.data.multiAz) {
      findings.push(makeFinding('architecture', 'redundancy', {
        severity: 'HIGH',
        resource: node.data.label,
        resourceId: node.id,
        problem: `${node.data.label} does not have Multi-AZ enabled.`,
        whyItMatters: 'A Single-AZ database has no automatic standby to fail over to - an AZ outage, instance failure, or even routine patching causes a full outage until it is manually restored.',
        awsRule: 'Amazon RDS/Aurora Multi-AZ deployments maintain a synchronous standby replica in a second Availability Zone and fail over to it automatically, typically within 60-120 seconds.',
        recommendation: `Enable Multi-AZ on ${node.data.label}.`
      }));
    }
  }

  const natGateways = serviceNodes.filter(n => n.data.serviceId === 'nat_gateway');
  const privateNodes = serviceNodes.filter(n => n.data.subnet === 'private' || n.data.subnet === 'isolated');
  if (natGateways.length === 1 && privateNodes.length > 1) {
    findings.push(makeFinding('architecture', 'redundancy', {
      severity: 'MEDIUM',
      resource: natGateways[0].data.label,
      resourceId: natGateways[0].id,
      problem: `A single NAT Gateway (${natGateways[0].data.label}) serves every private-subnet resource.`,
      whyItMatters: 'A NAT Gateway is scoped to one Availability Zone and has no automatic cross-AZ failover - if its AZ has an outage, every private-subnet resource anywhere in the VPC loses internet egress at once.',
      awsRule: 'A NAT Gateway should be deployed per Availability Zone, with each AZ\'s private subnets routed to their own AZ\'s NAT Gateway.',
      recommendation: 'Deploy one NAT Gateway per Availability Zone that has private-subnet resources.'
    }));
  }

  return findings;
}
