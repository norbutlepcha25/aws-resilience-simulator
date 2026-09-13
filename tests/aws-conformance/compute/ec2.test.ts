import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-EC2-CONFIG-001',
    awsBehavior: 'An EC2 instance must have a network interface inside a VPC subnet - it cannot exist outside all subnets.',
    reference: 'Amazon EC2 User Guide - "Amazon EC2 and Amazon VPC": instances launch into a subnet',
    scenario: 'An EC2 node is placed outside every subnet boundary on the canvas.',
    configuration: { subnet: 'unassigned' },
    request: { operation: 'validate configuration' },
    expected: { hasConfigIssue: true },
    run: () => {
      const node = svc('ec2-1', 'ec2', { subnet: 'unassigned' });
      const findings = validateArchitecture([node], []);
      return { hasConfigIssue: findings.some(f => f.resourceId === 'ec2-1') };
    },
    explain: (actual) => actual.hasConfigIssue
      ? 'The simulator correctly flags an EC2 instance with no subnet placement as invalid configuration.'
      : 'The simulator failed to flag an EC2 instance with no VPC subnet placement at all.'
  },
  {
    id: 'SVC-EC2-SUCCESS-001',
    awsBehavior: 'A healthy EC2 instance behind an ALB, in a correctly-placed subnet with permissive network rules, serves requests successfully.',
    reference: 'Amazon EC2 User Guide; Elastic Load Balancing User Guide',
    scenario: 'An ALB routes an HTTP request to a single healthy EC2 target.',
    configuration: { health: 'healthy' },
    request: { path: '/', method: 'GET' },
    expected: { success: true, statusCode: 200 },
    run: () => {
      const alb = svc('alb-1', 'alb', { category: 'Load Balancing', subnet: 'public', replicas: 1 });
      const ec2 = svc('ec2-1', 'ec2', { subnet: 'private' });
      const result = runSimulation([alb, ec2], [edge('e1', 'alb-1', 'ec2-1')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.success
      ? 'The simulator correctly serves the request through a healthy EC2 target.'
      : `Request unexpectedly failed with status ${actual.statusCode}.`
  },
  {
    id: 'SVC-EC2-NETWORK-FAILURE-001',
    awsBehavior: 'If an EC2 instance\'s Security Group has no inbound rule allowing the ALB\'s traffic, the connection is denied at the network layer even though the instance itself is healthy.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC"',
    scenario: 'An ALB attempts to reach a healthy EC2 instance whose Security Group denies the required protocol.',
    configuration: { securityGroup: 'denies HTTP' },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 403 },
    run: () => {
      const sg = { id: 'sg-1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: 'EC2-SG', boundaryType: 'security_group', width: 100, height: 100, securityGroupRules: { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'cidr', cidr: '0.0.0.0/0' } }], outbound: [] } } };
      const alb = svc('alb-1', 'alb', { category: 'Load Balancing', subnet: 'public', replicas: 1 });
      const ec2 = svc('ec2-1', 'ec2', { subnet: 'private', securityGroupIds: ['sg-1'] });
      const result = runSimulation([alb, ec2, sg] as any, [edge('e1', 'alb-1', 'ec2-1', 'HTTP')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 403
      ? 'The simulator correctly blocks the connection at the Security Group layer despite the target being healthy.'
      : `Got status ${actual.statusCode} - a Security Group with no matching inbound rule should block this connection with a 403.`
  },
  {
    id: 'SVC-EC2-IAM-FAILURE-001',
    awsBehavior: 'An EC2 instance calling an AWS API (e.g. S3) needs an IAM instance profile/role attached - with none, the call is denied at authentication before any policy is evaluated.',
    reference: 'IAM User Guide - "IAM roles for Amazon EC2"',
    scenario: 'An EC2 instance with no IAM role attached attempts to call S3.',
    configuration: { iamRole: 'none' },
    request: { action: 's3:GetObject' },
    expected: { hasIamFinding: true },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { subnet: 'private' });
      const s3 = svc('s3-1', 's3', { category: 'Storage', subnet: 'global', az: 'Edge / Global' });
      const findings = validateArchitecture([ec2, s3], [edge('e1', 'ec2-1', 's3-1', 'HTTPS')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'ec2-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags an EC2-to-S3 call with no IAM role attached.'
      : 'The simulator failed to flag a missing IAM role for a call to an IAM-authenticated AWS API.'
  },
  {
    id: 'SVC-EC2-SERVICE-FAILURE-001',
    awsBehavior: 'A failed/unresponsive EC2 instance cannot serve any request directed at it - the request fails at the instance itself.',
    reference: 'Amazon EC2 User Guide - "Monitor the health of your instances"',
    scenario: 'A single EC2 instance with no load balancer in front of it is marked failed and receives a direct request.',
    configuration: { health: 'failed' },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 503 },
    run: () => {
      const client = svc('client-1', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' });
      const igw = svc('igw-1', 'internet_gateway', { category: 'Networking & Content Delivery', subnet: 'global', az: 'Edge / Global' });
      const ec2 = svc('ec2-1', 'ec2', { subnet: 'public', health: 'failed', failureReason: 'Instance status check failed' });
      const result = runSimulation(
        [client, igw, ec2],
        [edge('e0', 'client-1', 'igw-1'), edge('e1', 'igw-1', 'ec2-1')],
        scenario('client-1')
      );
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 503
      ? 'The simulator correctly reports 503 when the destination instance itself is unhealthy.'
      : `Got status ${actual.statusCode} - a failed instance with no failover in front of it should fail the request.`
  },
  {
    id: 'SVC-EC2-MODEL-001',
    awsBehavior: 'The Service Behavior Engine resolves a dedicated behavioral model for EC2, not a generic fallback - EC2 is one of the "deeply supported" services.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard, not an AWS fact)',
    scenario: 'Resolving the service model for serviceId "ec2".',
    configuration: {},
    request: { serviceId: 'ec2' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('ec2')?.tier }),
    explain: (actual) => actual.tier === 1
      ? 'EC2 correctly resolves to a Tier 1 dedicated behavioral model.'
      : 'EC2 unexpectedly resolved to a non-Tier-1 model - it should have dedicated, hand-written behavior, not the generic fallback.'
  }
];

runConformanceCases(CASES);
