import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Compute', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'Message'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'POST', method: 'POST', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-SQS-MODEL-001',
    awsBehavior: 'SQS is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "sqs".',
    configuration: {},
    request: { serviceId: 'sqs' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('sqs')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'SQS correctly resolves to a Tier 1 model.' : 'SQS unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-SQS-SUCCESS-001',
    awsBehavior: 'Publishing a message to SQS decouples the producer from the consumer - the producer receives an immediate acknowledgment (202 Accepted) regardless of whether/when a consumer processes the message.',
    reference: 'Amazon SQS Developer Guide - "How Amazon SQS works"',
    scenario: 'A web tier enqueues a message into SQS for asynchronous background processing.',
    configuration: { queue: 'healthy' },
    request: { operation: 'SendMessage' },
    expected: { success: true, statusCode: 202 },
    run: () => {
      const web = svc('web-1', 'ecs', { category: 'Containers', subnet: 'private' });
      const sqs = svc('sqs-1', 'sqs', { category: 'Integration & Messaging' });
      const result = runSimulation([web, sqs], [edge('e1', 'web-1', 'sqs-1')], scenario('web-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 202
      ? 'The simulator correctly returns 202 Accepted for an asynchronous enqueue, decoupling producer from consumer.'
      : `Got status ${actual.statusCode} - enqueuing into SQS should immediately acknowledge the producer, independent of consumer processing.`
  },
  {
    id: 'SVC-SQS-IAM-FAILURE-001',
    awsBehavior: 'SQS is an IAM-authenticated API - a caller with no permissions for sqs:SendMessage is denied.',
    reference: 'Amazon SQS Developer Guide - "Identity and access management for Amazon SQS"',
    scenario: 'A compute service with no IAM role attempts to send a message to SQS.',
    configuration: { iamRole: 'none' },
    request: { action: 'sqs:SendMessage' },
    expected: { hasIamFinding: true },
    run: () => {
      const web = svc('web-1', 'ecs', { category: 'Containers' });
      const sqs = svc('sqs-1', 'sqs', { category: 'Integration & Messaging' });
      const findings = validateArchitecture([web, sqs], [edge('e1', 'web-1', 'sqs-1')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'web-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags a call to SQS with no IAM role attached.'
      : 'The simulator failed to flag a missing IAM role for an SQS SendMessage call.'
  },
  {
    id: 'SVC-SNS-MODEL-001',
    awsBehavior: 'SNS is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "sns".',
    configuration: {},
    request: { serviceId: 'sns' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('sns')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'SNS correctly resolves to a Tier 1 model.' : 'SNS unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-SNS-IAM-FAILURE-001',
    awsBehavior: 'SNS is an IAM-authenticated API - a caller with no permissions for sns:Publish is denied.',
    reference: 'Amazon SNS Developer Guide - "Identity and access management in Amazon SNS"',
    scenario: 'A compute service with no IAM role attempts to publish to an SNS topic.',
    configuration: { iamRole: 'none' },
    request: { action: 'sns:Publish' },
    expected: { hasIamFinding: true },
    run: () => {
      const web = svc('web-1', 'ecs', { category: 'Containers' });
      const sns = svc('sns-1', 'sns', { category: 'Integration & Messaging' });
      const findings = validateArchitecture([web, sns], [edge('e1', 'web-1', 'sns-1', 'Event')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'web-1') };
    },
    explain: (actual) => actual.hasIamFinding
      ? 'The simulator correctly flags a call to SNS with no IAM role attached.'
      : 'The simulator failed to flag a missing IAM role for an SNS Publish call.'
  }
];

runConformanceCases(CASES);
