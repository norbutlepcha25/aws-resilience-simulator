import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Load Balancing', health: 'healthy', az: 'AZ-A', subnet: 'public', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'TCP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-NLB-MODEL-001',
    awsBehavior: 'NLB is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "nlb".',
    configuration: {},
    request: { serviceId: 'nlb' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('nlb')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'NLB correctly resolves to a Tier 1 model.' : 'NLB unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-NLB-SUCCESS-001',
    awsBehavior: 'A Network Load Balancer with at least one healthy registered target routes traffic to it successfully - unlike an ALB, an NLB operates at Layer 4 (TCP/UDP) but performs the same target-health-based routing.',
    reference: 'Elastic Load Balancing User Guide - "Network Load Balancers"',
    scenario: 'An NLB has one healthy EC2 target.',
    configuration: { targets: ['healthy'] },
    request: { path: '/', method: 'GET' },
    expected: { success: true },
    run: () => {
      const nlb = svc('nlb-1', 'nlb');
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private' });
      const result = runSimulation([nlb, ec2], [edge('e1', 'nlb-1', 'ec2-1')], scenario('nlb-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly routes NLB traffic to its healthy target.' : 'Request unexpectedly failed against a healthy NLB target.'
  },
  {
    id: 'SVC-NLB-SERVICE-FAILURE-001',
    awsBehavior: 'When all of an NLB\'s registered targets fail their health checks, it has nothing to route to and the connection fails, exactly like an ALB with no healthy targets.',
    reference: 'Elastic Load Balancing User Guide - "Health checks for your target groups"',
    scenario: 'An NLB\'s sole registered target is unhealthy.',
    configuration: { targets: ['failed'] },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 503 },
    run: () => {
      const nlb = svc('nlb-1', 'nlb');
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute', subnet: 'private', health: 'failed' });
      const result = runSimulation([nlb, ec2], [edge('e1', 'nlb-1', 'ec2-1')], scenario('nlb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 503
      ? 'The simulator correctly returns 503 when the NLB has no healthy target.'
      : `Got status ${actual.statusCode} - an NLB with no healthy targets should behave exactly like an ALB in this situation.`
  }
];

runConformanceCases(CASES);
