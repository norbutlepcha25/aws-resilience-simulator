import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import { detectMissingRedundancy } from '../../../src/engine/analysis/redundancy.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Databases', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'SQL'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-DDB-MODEL-001',
    awsBehavior: 'DynamoDB is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "dynamodb".',
    configuration: {},
    request: { serviceId: 'dynamodb' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('dynamodb')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'DynamoDB correctly resolves to a Tier 1 model.' : 'DynamoDB unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-DDB-SUCCESS-001',
    awsBehavior: 'DynamoDB is a fully-managed, multi-AZ-by-default regional service reached over the AWS backbone (via its HTTPS API), not a customer-managed VPC resource.',
    reference: 'Amazon DynamoDB Developer Guide - "What is Amazon DynamoDB?"',
    scenario: 'A Lambda function reads an item from a healthy DynamoDB table.',
    configuration: { health: 'healthy' },
    request: { action: 'GetItem' },
    expected: { success: true },
    run: () => {
      const lambda = svc('lambda-1', 'lambda', { category: 'Compute' });
      const ddb = svc('ddb-1', 'dynamodb');
      const result = runSimulation([lambda, ddb], [edge('e1', 'lambda-1', 'ddb-1')], scenario('lambda-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly serves a GetItem request against a healthy DynamoDB table.' : 'Request unexpectedly failed against a healthy DynamoDB table.'
  },
  {
    id: 'SVC-DDB-NO-CUSTOMER-FAILOVER-EVENT-001',
    awsBehavior: 'DynamoDB replicates data across multiple AZs automatically with no customer-visible failover event - unlike RDS Multi-AZ, there is no "standby promotion" the application ever has to wait through.',
    reference: 'Amazon DynamoDB Developer Guide - "Read consistency" / "Global Tables" (automatic multi-AZ replication, no customer-managed failover)',
    scenario: 'A DynamoDB table (managed, no `multiAz` flag needed) is analyzed for a redundancy finding the way a Single-AZ RDS instance would be.',
    configuration: { serviceId: 'dynamodb' },
    request: { operation: 'architectural analysis' },
    expected: { hasRedundancyFinding: false },
    run: () => {
      const ddb = svc('ddb-1', 'dynamodb', { multiAz: false });
      const findings = detectMissingRedundancy([ddb]);
      return { hasRedundancyFinding: findings.some((f: any) => f.resourceId === 'ddb-1') };
    },
    explain: (actual) => !actual.hasRedundancyFinding
      ? 'The simulator correctly does not flag DynamoDB for missing Multi-AZ - DynamoDB\'s multi-AZ replication is inherent and automatic, not a configuration a user can get wrong.'
      : 'The simulator incorrectly flagged DynamoDB the same way it would flag a Single-AZ RDS instance - this conflates a managed, always-multi-AZ service with one that genuinely needs the flag enabled.'
  },
  {
    id: 'SVC-DDB-IAM-FAILURE-001',
    awsBehavior: 'DynamoDB is an IAM-authenticated API - a caller with no IAM permissions for dynamodb:GetItem is denied.',
    reference: 'Amazon DynamoDB Developer Guide - "Identity and access management in DynamoDB"',
    scenario: 'A Lambda function with no execution role attempts to read from DynamoDB.',
    configuration: { iamRole: 'none' },
    request: { action: 'dynamodb:GetItem' },
    expected: { hasIamFinding: true },
    run: () => {
      const lambda = svc('lambda-1', 'lambda', { category: 'Compute' });
      const ddb = svc('ddb-1', 'dynamodb');
      const findings = validateArchitecture([lambda, ddb], [edge('e1', 'lambda-1', 'ddb-1')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'lambda-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags a Lambda-to-DynamoDB call with no execution role attached.'
      : 'The simulator failed to flag a missing IAM role for a DynamoDB call.'
  },
  {
    id: 'SVC-DDB-SERVICE-FAILURE-001',
    awsBehavior: 'The simulator still models an explicit DynamoDB outage state for teaching failure scenarios, even though DynamoDB has no customer-visible Multi-AZ flag.',
    reference: 'Amazon DynamoDB Developer Guide - "Amazon DynamoDB Service Level Agreement"',
    scenario: 'A Lambda function queries a DynamoDB table explicitly marked as failed (a simulated regional outage).',
    configuration: { health: 'failed' },
    request: { action: 'GetItem' },
    expected: { success: false },
    run: () => {
      const lambda = svc('lambda-1', 'lambda', { category: 'Compute' });
      const ddb = svc('ddb-1', 'dynamodb', { health: 'failed', failureReason: 'Simulated DynamoDB outage' });
      const result = runSimulation([lambda, ddb], [edge('e1', 'lambda-1', 'ddb-1')], scenario('lambda-1'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly fails the request when the target DynamoDB table is marked unhealthy.'
      : 'The simulator succeeded despite the target DynamoDB table being marked failed.'
  }
];

runConformanceCases(CASES);
