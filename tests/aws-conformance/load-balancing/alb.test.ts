import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Load Balancing', health: 'healthy', az: 'AZ-A', subnet: 'public', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-ALB-MODEL-001',
    awsBehavior: 'ALB is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "alb".',
    configuration: {},
    request: { serviceId: 'alb' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('alb')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'ALB correctly resolves to a Tier 1 model.' : 'ALB unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-ALB-CONFIG-001',
    awsBehavior: 'An Application Load Balancer must itself be deployed inside a VPC subnet.',
    reference: 'Elastic Load Balancing User Guide - "Application Load Balancers"',
    scenario: 'An ALB is placed outside every subnet boundary.',
    configuration: { subnet: 'unassigned' },
    request: { operation: 'validate configuration' },
    expected: { hasConfigIssue: true },
    run: () => {
      const alb = svc('alb-1', 'alb', { subnet: 'unassigned' });
      const findings = validateArchitecture([alb], []);
      return { hasConfigIssue: findings.some(f => f.resourceId === 'alb-1') };
    },
    explain: (actual) => actual.hasConfigIssue ? 'The simulator correctly flags an ALB with no subnet placement.' : 'The simulator failed to flag an ALB placed outside any subnet.'
  },
  {
    id: 'SVC-ALB-SUCCESS-001',
    awsBehavior: 'An ALB with at least one healthy registered target routes traffic to it successfully.',
    reference: 'Elastic Load Balancing User Guide - "Target groups for your Application Load Balancers"',
    scenario: 'An ALB has two registered EC2 targets, both healthy.',
    configuration: { targets: ['healthy', 'healthy'] },
    request: { path: '/', method: 'GET' },
    expected: { success: true, statusCode: 200 },
    run: () => {
      const alb = svc('alb-1', 'alb', { replicas: 2 });
      const ec2a = svc('ec2-a', 'ec2', { category: 'Compute', subnet: 'private' });
      const ec2b = svc('ec2-b', 'ec2', { category: 'Compute', subnet: 'private' });
      const result = runSimulation([alb, ec2a, ec2b], [edge('e1', 'alb-1', 'ec2-a'), edge('e2', 'alb-1', 'ec2-b')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.success ? 'The simulator correctly routes to a healthy target.' : `Request unexpectedly failed with status ${actual.statusCode}.`
  },
  {
    id: 'SVC-ALB-NETWORK-FAILURE-001',
    awsBehavior: 'An ALB\'s target-health check is independent of network reachability - if the target\'s Security Group denies the ALB\'s traffic, the connection to that target fails at the network layer.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC"; Elastic Load Balancing User Guide',
    scenario: 'An ALB\'s sole registered target has a Security Group that denies the ALB\'s protocol.',
    configuration: { securityGroup: 'denies HTTP' },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 403 },
    run: () => {
      const sg = { id: 'sg-1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: 'EC2-SG', boundaryType: 'security_group', width: 100, height: 100, securityGroupRules: { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'cidr', cidr: '0.0.0.0/0' } }], outbound: [] } } };
      const alb = svc('alb-1', 'alb');
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', securityGroupIds: ['sg-1'] });
      const result = runSimulation([alb, ec2, sg] as any, [edge('e1', 'alb-1', 'ec2-1')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 403
      ? 'The simulator correctly blocks the ALB-to-target connection at the Security Group layer.'
      : `Got status ${actual.statusCode} - a Security Group with no matching rule should block the ALB's connection to its target.`
  },
  {
    id: 'SVC-ALB-IAM-NA-001',
    awsBehavior: 'An ALB routing HTTP/HTTPS traffic to a target group performs no IAM authorization of its own for the connection itself - IAM is not part of the ALB-to-target data path.',
    reference: 'Elastic Load Balancing User Guide - "Application Load Balancers" (no IAM in the request-routing data path)',
    scenario: 'An ALB routes a request to a target with no IAM role configured anywhere.',
    configuration: { iamRole: 'none' },
    request: { path: '/', method: 'GET' },
    expected: { hasIamFinding: false },
    run: () => {
      const alb = svc('alb-1', 'alb');
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private' });
      const findings = validateArchitecture([alb, ec2], [edge('e1', 'alb-1', 'ec2-1')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam') };
    },
    explain: (actual) => !actual.hasIamFinding
      ? 'The simulator correctly does not require IAM for the ALB-to-target routing path.'
      : 'The simulator incorrectly required IAM for ALB request routing - this is not part of the real AWS data path.'
  },
  {
    id: 'SVC-ALB-SERVICE-FAILURE-001',
    awsBehavior: 'When ALL registered targets fail their health checks, the ALB has no healthy target to route to and returns HTTP 503 Service Unavailable (NOT 502, which is reserved for a malformed response from a target that DID respond).',
    reference: 'Elastic Load Balancing User Guide - "Health checks for your target groups"',
    scenario: 'Both of an ALB\'s registered targets are unhealthy.',
    configuration: { targets: ['failed', 'failed'] },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 503 },
    run: () => {
      const alb = svc('alb-1', 'alb', { replicas: 2 });
      const ec2a = svc('ec2-a', 'ec2', { category: 'Compute', subnet: 'private', health: 'failed' });
      const ec2b = svc('ec2-b', 'ec2', { category: 'Compute', subnet: 'private', health: 'failed' });
      const result = runSimulation([alb, ec2a, ec2b], [edge('e1', 'alb-1', 'ec2-a'), edge('e2', 'alb-1', 'ec2-b')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 503
      ? 'The simulator correctly returns 503 (not 502) when no healthy target is available.'
      : `Got status ${actual.statusCode} - AWS documents 503 specifically for "no healthy targets", distinct from 502's "malformed response from a target".`
  }
];

runConformanceCases(CASES);
