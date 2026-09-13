import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Containers', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 } };
}
const scenario = (startNodeId: string, trafficLevel: SimulationScenario['trafficLevel'] = 'normal'): SimulationScenario => ({
  id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel
});

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-FARGATE-MODEL-001',
    awsBehavior: 'Fargate is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "fargate".',
    configuration: {},
    request: { serviceId: 'fargate' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('fargate')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'Fargate correctly resolves to a Tier 1 model.' : 'Fargate unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-FARGATE-SUCCESS-001',
    awsBehavior: 'A healthy Fargate task behind an ALB serves requests successfully - Fargate is a serverless container launch type, so unlike EC2 it never fails on "instance capacity" alone.',
    reference: 'Amazon ECS Developer Guide - "AWS Fargate"',
    scenario: 'An ALB routes a request to a single healthy Fargate task.',
    configuration: { health: 'healthy' },
    request: { path: '/', method: 'GET' },
    expected: { success: true },
    run: () => {
      const alb = svc('alb-1', 'alb', { category: 'Load Balancing', subnet: 'public', replicas: 1 });
      const fargate = svc('fargate-1', 'fargate');
      const result = runSimulation([alb, fargate], [edge('e1', 'alb-1', 'fargate-1')], scenario('alb-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly serves a request through a healthy Fargate task.' : 'Request unexpectedly failed against a healthy Fargate task.'
  },
  {
    id: 'SVC-FARGATE-SERVERLESS-SCALING-001',
    awsBehavior: 'Fargate scales elastically per-task under load without a customer-managed Auto Scaling Group - a traffic surge should not saturate a single Fargate task the way it would an un-scaled EC2 instance.',
    reference: 'Amazon ECS Developer Guide - "AWS Fargate"',
    scenario: 'A single Fargate task (replicas: 1) receives a 10x traffic surge.',
    configuration: { replicas: 1, trafficLevel: '10x' },
    request: { path: '/', method: 'GET', trafficLevel: '10x' },
    expected: { success: true },
    run: () => {
      const alb = svc('alb-1', 'alb', { category: 'Load Balancing', subnet: 'public', replicas: 1 });
      const fargate = svc('fargate-1', 'fargate', { replicas: 1 });
      const result = runSimulation([alb, fargate], [edge('e1', 'alb-1', 'fargate-1')], scenario('alb-1', '10x'));
      return { success: result.success };
    },
    explain: (actual) => actual.success
      ? 'The simulator correctly models Fargate\'s serverless elastic scaling surviving a traffic surge with no manual Auto Scaling Group.'
      : 'The simulator incorrectly saturated a Fargate task the same way it would an un-scaled EC2 instance - Fargate has no such capacity ceiling to configure.'
  },
  {
    id: 'SVC-FARGATE-SERVICE-FAILURE-001',
    awsBehavior: 'A failed Fargate task cannot serve requests routed to it - if it is the ALB\'s only target, the request fails.',
    reference: 'Amazon ECS Developer Guide - "Amazon ECS task health"',
    scenario: 'An ALB\'s sole Fargate target is unhealthy.',
    configuration: { health: 'failed' },
    request: { path: '/', method: 'GET' },
    expected: { success: false, statusCode: 503 },
    run: () => {
      const alb = svc('alb-1', 'alb', { category: 'Load Balancing', subnet: 'public', replicas: 1 });
      const fargate = svc('fargate-1', 'fargate', { health: 'failed' });
      const result = runSimulation([alb, fargate], [edge('e1', 'alb-1', 'fargate-1')], scenario('alb-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 503
      ? 'The simulator correctly returns 503 when the ALB\'s only Fargate target is unhealthy.'
      : `Got status ${actual.statusCode} - matches ALB "no healthy targets" behavior.`
  }
];

runConformanceCases(CASES);
