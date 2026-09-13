import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Storage', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTPS'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-S3-MODEL-001',
    awsBehavior: 'S3 is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "s3".',
    configuration: {},
    request: { serviceId: 's3' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('s3')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'S3 correctly resolves to a Tier 1 model.' : 'S3 unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-S3-SUCCESS-001',
    awsBehavior: 'S3 is a fully-managed, always-available regional object store reached over HTTPS - a private EC2 instance can successfully retrieve an object via a Gateway Endpoint.',
    reference: 'Amazon S3 User Guide - "What is Amazon S3?"',
    scenario: 'A private EC2 instance retrieves an object from S3 through a VPC Gateway Endpoint.',
    configuration: { health: 'healthy' },
    request: { operation: 'GetObject' },
    expected: { success: true },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A' });
      const endpoint = svc('endpoint-1', 's3_gateway_endpoint', { category: 'Networking & Content Delivery', subnet: 'private', az: 'AZ-A' });
      const s3 = svc('s3-1', 's3');
      const result = runSimulation([ec2, endpoint, s3], [edge('e1', 'ec2-1', 's3-1')], scenario('ec2-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly serves an S3 GetObject request via the Gateway Endpoint.' : 'Request unexpectedly failed against a healthy S3 bucket reachable via Gateway Endpoint.'
  },
  {
    id: 'SVC-S3-NETWORK-FAILURE-001',
    awsBehavior: 'Without a NAT Gateway or a VPC Endpoint, a private-subnet resource has no path to S3 over the internet - the request times out.',
    reference: 'Amazon VPC User Guide - "Gateway endpoints"; Amazon S3 User Guide',
    scenario: 'A private EC2 instance attempts to reach S3 with no NAT Gateway and no VPC Endpoint present.',
    configuration: { natGateway: 'absent', vpcEndpoint: 'absent' },
    request: { operation: 'GetObject' },
    expected: { success: false },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A' });
      const s3 = svc('s3-1', 's3');
      const result = runSimulation([ec2, s3], [edge('e1', 'ec2-1', 's3-1')], scenario('ec2-1'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly reports no path to S3 for a private-subnet resource with no NAT Gateway or VPC Endpoint.'
      : 'The simulator allowed private-subnet-to-S3 traffic with no NAT Gateway or VPC Endpoint - AWS has no such implicit path.'
  },
  {
    id: 'SVC-S3-IAM-FAILURE-001',
    awsBehavior: 'S3 is an IAM-authenticated API - a caller with no IAM permissions (identity policy or bucket policy) granting s3:GetObject is denied.',
    reference: 'Amazon S3 User Guide - "Identity and access management in Amazon S3"',
    scenario: 'An EC2 instance with no IAM role calls S3.',
    configuration: { iamRole: 'none' },
    request: { action: 's3:GetObject' },
    expected: { hasIamFinding: true },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A' });
      const s3 = svc('s3-1', 's3');
      const findings = validateArchitecture([ec2, s3], [edge('e1', 'ec2-1', 's3-1')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'ec2-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags an EC2-to-S3 call with no IAM role attached.'
      : 'The simulator failed to flag a missing IAM role for an S3 call.'
  },
  {
    id: 'SVC-S3-SERVICE-FAILURE-001',
    awsBehavior: 'S3 is designed for 99.99% availability within a region - the simulator still models an explicit unhealthy/outage state for teaching failure scenarios.',
    reference: 'Amazon S3 User Guide - "Amazon S3 Service Level Agreement"',
    scenario: 'A request is made to an S3 bucket explicitly marked as failed (a simulated regional outage).',
    configuration: { health: 'failed' },
    request: { operation: 'GetObject' },
    expected: { success: false },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A' });
      const endpoint = svc('endpoint-1', 's3_gateway_endpoint', { category: 'Networking & Content Delivery', subnet: 'private', az: 'AZ-A' });
      const s3 = svc('s3-1', 's3', { health: 'failed', failureReason: 'Simulated S3 outage' });
      const result = runSimulation([ec2, endpoint, s3], [edge('e1', 'ec2-1', 's3-1')], scenario('ec2-1'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly fails the request when the target S3 bucket is marked unhealthy.'
      : 'The simulator succeeded despite the target S3 bucket being marked failed.'
  }
];

runConformanceCases(CASES);
