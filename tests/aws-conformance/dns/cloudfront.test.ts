import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { explainHop } from '../../../src/engine/trace/explainHop.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'DNS / Edge', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: true, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'HTTPS'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 } };
}
const scenario = (startNodeId: string, path: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path, startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-CF-MODEL-001',
    awsBehavior: 'CloudFront is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "cloudfront".',
    configuration: {},
    request: { serviceId: 'cloudfront' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('cloudfront')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'CloudFront correctly resolves to a Tier 1 model.' : 'CloudFront unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-CF-CACHE-HIT-001',
    awsBehavior: 'A CloudFront cache HIT for a static asset is served directly from the edge location and never contacts the origin.',
    reference: 'Amazon CloudFront Developer Guide - "How CloudFront delivers content"',
    scenario: 'A request for a static asset (/static/logo.png) reaches a healthy CloudFront distribution.',
    configuration: { path: '/static/logo.png' },
    request: { operation: 'GET /static/logo.png' },
    expected: { success: true, cacheHit: true },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const cf = svc('cf-1', 'cloudfront');
      const origin = svc('origin-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A', multiAz: false });
      const result = runSimulation([user, cf, origin], [edge('e1', 'user-1', 'cf-1'), edge('e2', 'cf-1', 'origin-1', 'HTTP')], scenario('user-1', '/static/logo.png'));
      const cacheStep = result.steps.find(s => s.details?.cacheHit === true);
      return { success: result.success, cacheHit: Boolean(cacheStep) };
    },
    explain: (actual) => actual.cacheHit
      ? 'The simulator correctly serves a static-path request as an edge cache hit, never reaching the origin.'
      : 'The simulator did not record a cache hit for a static asset path.'
  },
  {
    id: 'SVC-CF-CACHE-MISS-001',
    awsBehavior: 'A CloudFront cache MISS (a dynamic, non-static route) is forwarded to the origin - the response still depends on the origin\'s own health.',
    reference: 'Amazon CloudFront Developer Guide - "How CloudFront delivers content"',
    scenario: 'A request for a dynamic API route reaches CloudFront, whose origin is unhealthy.',
    configuration: { path: '/api/orders' },
    request: { operation: 'GET /api/orders' },
    expected: { success: false },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const cf = svc('cf-1', 'cloudfront');
      const origin = svc('origin-1', 'ec2', { category: 'Compute', subnet: 'private', az: 'AZ-A', multiAz: false, health: 'failed', failureReason: 'Origin down' });
      const result = runSimulation([user, cf, origin], [edge('e1', 'user-1', 'cf-1'), edge('e2', 'cf-1', 'origin-1', 'HTTP')], scenario('user-1', '/api/orders'));
      return { success: result.success };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly forwards a cache-miss request to the origin and fails when that origin is unhealthy - a cache miss is not itself a failure, but it does not mask a real origin outage either.'
      : 'The simulator succeeded despite an unhealthy origin on a cache-miss path - a dynamic route must actually reach the origin.'
  },
  {
    id: 'SVC-CF-IAM-NA-001',
    awsBehavior: 'Serving a viewer request through a CloudFront distribution (a cache hit or a cache-miss fetch from the origin) is not an IAM-authorized action - IAM only governs the CloudFront MANAGEMENT API (creating/updating distributions), or optionally Origin Access Control, neither of which this simulator models as part of request serving.',
    reference: 'Amazon CloudFront Developer Guide - "Identity and access management in CloudFront" (governs the API, not viewer request serving)',
    scenario: 'A viewer request is served by CloudFront with no IAM role or credentials of any kind.',
    configuration: { iamRole: 'none' },
    request: { operation: 'GET (served by CloudFront)' },
    expected: { decision: 'NOT_REQUIRED' },
    run: () => {
      const user = svc('user-1', 'user', { category: 'Client / Ingress' });
      const cf = svc('cf-1', 'cloudfront');
      const entries = explainHop([user, cf], [], user, cf, 'HTTPS');
      const iam = entries.find(e => e.component === 'IAM')!;
      return { decision: iam.decision };
    },
    explain: (actual) => actual.decision === 'NOT_REQUIRED'
      ? 'The simulator correctly treats CloudFront request serving as not requiring IAM authorization.'
      : 'The simulator incorrectly required IAM to serve a CloudFront viewer request.'
  }
];

runConformanceCases(CASES);
