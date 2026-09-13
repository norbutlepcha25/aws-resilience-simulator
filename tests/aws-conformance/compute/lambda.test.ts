import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Compute', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTPS'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-LAMBDA-MODEL-001',
    awsBehavior: 'Lambda is one of the "deeply supported" services with a dedicated behavioral model, not the generic fallback.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "lambda".',
    configuration: {},
    request: { serviceId: 'lambda' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('lambda')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'Lambda correctly resolves to a Tier 1 model.' : 'Lambda unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-LAMBDA-SUCCESS-001',
    awsBehavior: 'API Gateway can synchronously invoke a healthy Lambda function and return its response to the caller.',
    reference: 'AWS Lambda Developer Guide - "Using Lambda with API Gateway"',
    scenario: 'API Gateway invokes a healthy Lambda function.',
    configuration: { health: 'healthy' },
    request: { path: '/api', method: 'GET' },
    expected: { success: true },
    run: () => {
      const apigw = svc('apigw-1', 'api_gateway', { category: 'Networking & Content Delivery' });
      const lambda = svc('lambda-1', 'lambda');
      const result = runSimulation([apigw, lambda], [edge('e1', 'apigw-1', 'lambda-1')], scenario('apigw-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly serves a request through a healthy Lambda function.' : 'Request unexpectedly failed against a healthy Lambda.'
  },
  {
    id: 'SVC-LAMBDA-NETWORK-FAILURE-001',
    awsBehavior: 'A Lambda function attached to a VPC is subject to that VPC\'s Security Group egress rules when calling a VPC-hosted resource (e.g. RDS) - a denying Security Group blocks it just like any other ENI.',
    reference: 'AWS Lambda Developer Guide - "Configuring a Lambda function to access resources in a VPC"',
    scenario: 'A VPC-attached Lambda function attempts to reach an RDS database whose Security Group denies the connection.',
    configuration: { securityGroup: 'denies SQL' },
    request: { protocol: 'SQL' },
    expected: { success: false, statusCode: 403 },
    run: () => {
      const sg = { id: 'sg-1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: 'RDS-SG', boundaryType: 'security_group', width: 100, height: 100, securityGroupRules: { inbound: [{ protocol: 'HTTP', portRange: 'ALL', source: { type: 'cidr', cidr: '0.0.0.0/0' } }], outbound: [] } } };
      const lambda = svc('lambda-1', 'lambda', { subnet: 'private', az: 'AZ-A' });
      const rds = svc('rds-1', 'rds', { category: 'Databases', subnet: 'private', az: 'AZ-A', securityGroupIds: ['sg-1'] });
      const result = runSimulation([lambda, rds, sg] as any, [edge('e1', 'lambda-1', 'rds-1', 'SQL')], scenario('lambda-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 403
      ? 'The simulator correctly blocks VPC-Lambda-to-RDS traffic at the Security Group layer.'
      : `Got status ${actual.statusCode} - a Security Group with no matching rule should block this connection.`
  },
  {
    id: 'SVC-LAMBDA-IAM-FAILURE-001',
    awsBehavior: 'A Lambda function\'s execution role must grant an action before it can call that AWS API - with no role attached, the call is denied at authentication.',
    reference: 'AWS Lambda Developer Guide - "Lambda execution role"',
    scenario: 'A Lambda function with no execution role attempts to read from DynamoDB.',
    configuration: { iamRole: 'none' },
    request: { action: 'dynamodb:GetItem' },
    expected: { hasIamFinding: true },
    run: () => {
      const lambda = svc('lambda-1', 'lambda');
      const ddb = svc('ddb-1', 'dynamodb', { category: 'Databases' });
      const findings = validateArchitecture([lambda, ddb], [edge('e1', 'lambda-1', 'ddb-1', 'SQL')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'lambda-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags a Lambda-to-DynamoDB call with no execution role attached.'
      : 'The simulator failed to flag a missing execution role for a Lambda function calling DynamoDB.'
  },
  {
    id: 'SVC-LAMBDA-SERVICE-FAILURE-001',
    awsBehavior: 'A Lambda function in a failed/throttled state cannot process an invocation - the invoking event source receives an error.',
    reference: 'AWS Lambda Developer Guide - "Lambda function errors"',
    scenario: 'API Gateway invokes a Lambda function that is currently marked failed.',
    configuration: { health: 'failed' },
    request: { path: '/api', method: 'GET' },
    expected: { success: false },
    run: () => {
      const apigw = svc('apigw-1', 'api_gateway', { category: 'Networking & Content Delivery' });
      const lambda = svc('lambda-1', 'lambda', { health: 'failed', failureReason: 'Function invocation errors / throttled' });
      const result = runSimulation([apigw, lambda], [edge('e1', 'apigw-1', 'lambda-1')], scenario('apigw-1'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly fails the request when the invoked Lambda function itself is unhealthy.'
      : 'The simulator succeeded despite the target Lambda function being marked failed.'
  }
];

runConformanceCases(CASES);
