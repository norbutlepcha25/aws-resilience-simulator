import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { explainHop } from '../../../src/engine/trace/explainHop.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'DNS / Edge', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: true, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'DNS'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-R53-MODEL-001',
    awsBehavior: 'Route 53 is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "route53".',
    configuration: {},
    request: { serviceId: 'route53' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('route53')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'Route 53 correctly resolves to a Tier 1 model.' : 'Route 53 unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-R53-SUCCESS-001',
    awsBehavior: 'Route 53 is a fully-managed, globally-distributed DNS service with a 100% availability SLA - a healthy record resolves successfully to its target.',
    reference: 'Amazon Route 53 Developer Guide - "What is Amazon Route 53?"',
    scenario: 'A client resolves a domain name via a healthy Route 53 hosted zone.',
    configuration: { health: 'healthy' },
    request: { operation: 'DNS resolution' },
    expected: { success: true },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const r53 = svc('r53-1', 'route53');
      const cf = svc('cf-1', 'cloudfront', { category: 'DNS / Edge' });
      const result = runSimulation([user, r53, cf], [edge('e1', 'user-1', 'r53-1'), edge('e2', 'r53-1', 'cf-1', 'HTTPS')], scenario('user-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly resolves DNS and reaches the target through a healthy Route 53 record.' : 'Request unexpectedly failed through a healthy Route 53 hosted zone.'
  },
  {
    id: 'SVC-R53-SERVICE-FAILURE-001',
    awsBehavior: 'If Route 53 itself (or the specific record\'s resolution) is marked as failed with no healthy failover record configured, resolution fails and the client cannot reach any target at all - regardless of whether the origin server itself is healthy.',
    reference: 'Amazon Route 53 Developer Guide - "Configuring DNS failover"',
    scenario: 'A client attempts to resolve a domain whose Route 53 hosted zone is marked failed, with a healthy origin behind it.',
    configuration: { health: 'failed', failoverRecord: 'none' },
    request: { operation: 'DNS resolution' },
    expected: { success: false },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const r53 = svc('r53-1', 'route53', { health: 'failed', failureReason: 'Hosted zone resolution failure, no healthy failover record' });
      const cf = svc('cf-1', 'cloudfront', { category: 'DNS / Edge' });
      const result = runSimulation([user, r53, cf], [edge('e1', 'user-1', 'r53-1'), edge('e2', 'r53-1', 'cf-1', 'HTTPS')], scenario('user-1'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly fails the request when DNS resolution itself fails, even though the origin behind it is healthy.'
      : 'The simulator succeeded despite DNS resolution failing - without a resolvable name, the client has no address to connect to at all.'
  },
  {
    id: 'SVC-R53-IAM-NA-001',
    awsBehavior: 'DNS resolution (a client resolving a name to an IP) is not an IAM-authorized action - IAM only governs the Route 53 MANAGEMENT API (creating/modifying hosted zones and records), not the resolution protocol itself.',
    reference: 'Amazon Route 53 Developer Guide - "Identity and access management in Amazon Route 53" (governs the API, not DNS resolution traffic)',
    scenario: 'A client resolves a domain name with no IAM role or credentials of any kind.',
    configuration: { iamRole: 'none' },
    request: { operation: 'DNS resolution' },
    expected: { decision: 'NOT_REQUIRED' },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const r53 = svc('r53-1', 'route53');
      const entries = explainHop([user, r53], [], user, r53, 'DNS');
      const iam = entries.find(e => e.component === 'IAM')!;
      return { decision: iam.decision };
    },
    explain: (actual) => actual.decision === 'NOT_REQUIRED'
      ? 'The simulator correctly treats plain DNS resolution as not requiring IAM authorization.'
      : 'The simulator incorrectly required IAM for a DNS resolution request - this would misteach where IAM actually applies to Route 53.'
  }
];

runConformanceCases(CASES);
