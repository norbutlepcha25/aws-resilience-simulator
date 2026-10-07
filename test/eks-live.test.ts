import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveSimulation } from '../src/engine/simulation/liveSimulation.ts';
import { eksConfiguration, recommendEksReplicas, validateEks } from '../src/engine/service/models/eks.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../src/types/index.ts';

// EKS-READY: Services select pods; normal Service traffic requires Ready endpoints.
// Official sources: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-concepts.html
// https://kubernetes.io/docs/concepts/services-networking/service/
// Scenario: workload snapshot with independent desired/running/Ready counts.
// Expected behavior: only matching Ready endpoints serve; assertions are actual results.
const node = (id = 'app', serviceId = 'eks', eks = {}): Node<ServiceNodeData> => ({ id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Compute', health: 'healthy', subnet: 'private', az: 'AZ-A', replicas: 1, multiAz: false, customConfig: { eks } } });
const scenario: SimulationScenario = { id: 'eks', name: 'EKS request', startNodeId: 'app', method: 'GET', path: '/', trafficLevel: 'normal' };
const run = (app: Node<ServiceNodeData>) => runLiveSimulation([app], [], scenario);

test('EKS-READY-001: legacy workload succeeds; desired and running do not imply Ready', () => {
  assert.equal(run(node()).success, true);
  const app = node('app', 'eks', { desiredReplicas: 5, runningPods: 3, readyPods: 0 });
  const before = structuredClone(app);
  const result = run(app);
  assert.equal(result.success, false); assert.equal(result.statusCode, 503);
  assert.match(result.summary, /zero Ready/); assert.deepEqual(app, before);
});
test('EKS-READY-002: selector mismatch fails; matching Ready endpoints succeed deterministically', () => {
  const app = node('app', 'eks', { serviceSelector: 'web', podLabel: 'worker' });
  assert.equal(run(app).success, false);
  app.data.customConfig!.eks.podLabel = 'web';
  assert.equal(run(app).success, true); assert.deepEqual(run(app), run(app));
});
test('EKS-SCALE-001: load, multi-AZ and an ASG never create pods implicitly', () => {
  const app = node(); app.data.multiAz = true; app.data.replicas = 2;
  const nodes = [app, node('asg', 'autoscaling')]; const before = structuredClone(nodes);
  const result = runLiveSimulation(nodes, [], { ...scenario, trafficLevel: '100x' });
  assert.equal(result.success, true); assert.ok(!result.steps.some(s => /Scale-Out/.test(s.action)));
  assert.deepEqual(nodes, before);
});
test('EKS-CONTROL-001: control plane is not an application endpoint; existing Ready data path can survive API loss', () => {
  assert.equal(run(node('app', 'eks', { kind: 'control-plane' })).statusCode, 400);
  const app = node('app', 'eks', { controlPlaneAvailable: false, hpaEnabled: true, metricsAvailable: true });
  assert.equal(run(app).success, true); assert.equal(recommendEksReplicas(app.data).replicas, null);
});
test('EKS-CONFIG-001: invalid counts and ports cannot pass live validation', () => {
  const app = node('app', 'eks', { runningPods: 1, readyPods: 2, servicePort: 0 });
  assert.equal(validateEks(app.data).length, 2); assert.equal(run(app).statusCode, 400);
});
// EKS-HPA: basic ratio estimate only, deliberately excludes tolerance/stabilization.
// https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
// https://docs.aws.amazon.com/eks/latest/userguide/autoscaling.html
// Expected: metrics and CPU requests required; ceil(current * observed / target), bounded.
test('EKS-HPA-001: explicit metric prerequisites and bounded estimate; observed state unchanged', () => {
  const app = node('app', 'eks', { runningPods: 2, readyPods: 1, hpaEnabled: true, observedCpuPercent: 150, targetCpuPercent: 50, maxReplicas: 4 });
  assert.equal(recommendEksReplicas(app.data).replicas, null);
  app.data.customConfig!.eks.metricsAvailable = true;
  assert.equal(recommendEksReplicas(app.data).replicas, 4);
  assert.equal(eksConfiguration(app.data).runningPods, 2);
  app.data.customConfig!.eks.cpuRequestMilli = 0;
  assert.equal(recommendEksReplicas(app.data).replicas, null);
});
test('EKS-LB-001: load balancer omits zero-Ready workload snapshots; no eligible targets fails', () => {
  const alb = node('alb', 'alb'); alb.data.subnet = 'public';
  const a = node('a', 'eks', { readyPods: 0 }); const b = node('b');
  const edges: Edge<ConnectionData>[] = [a, b].map(n => ({ id: n.id, source: 'alb', target: n.id, data: { protocol: 'HTTP', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } }));
  const request = { ...scenario, startNodeId: 'alb' };
  const result = runLiveSimulation([alb, a, b], edges, request);
  assert.equal(result.success, true); assert.ok(result.steps.some(s => s.sourceNodeId === 'alb' && s.targetNodeId === 'b'));
  b.data.customConfig!.eks.readyPods = 0;
  assert.equal(runLiveSimulation([alb, a, b], edges, request).success, false);
});
test('EKS-SERVICE-001: direct internet client cannot expose a ClusterIP by drawing an edge', () => {
  const client = node('client', 'user'); client.data.subnet = 'global';
  const app = node(); app.data.subnet = 'public';
  const edge: Edge<ConnectionData> = { id: 'client-app', source: 'client', target: 'app', data: { protocol: 'HTTP', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
  const result = runLiveSimulation([client, app], [edge], { ...scenario, startNodeId: 'client' });
  assert.equal(result.success, false); assert.match(result.summary, /ClusterIP/);
});
