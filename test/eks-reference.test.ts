import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReference } from '../src/engine/persistence/references.ts';
import { runLiveSimulation } from '../src/engine/simulation/liveSimulation.ts';
import { carriesRequest } from '../src/engine/architecture/relationships.ts';

const original = parseReference(readFileSync(new URL('../src/data/references/15-eks-architecture.json', import.meta.url), 'utf8'));
// EKS-REF-001. AWS rule: managed control plane is separate from customer compute.
// Source: https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html
// Scenario: supplied architecture's management relationships, two nodes, three pod illustrations.
// Expected/actual: structure retained and management edges cannot forward application traffic.
test('EKS reference keeps control-plane and worker relationships outside application traversal', () => {
  assert.equal(original.name, 'EKS architecture');
  assert.equal(original.nodes.filter(n => n.data.serviceId === 'ec2').length, 2);
  assert.equal(original.nodes.filter(n => n.id.startsWith('eks-pod-')).length, 3);
  assert.ok(original.edges.every(e => !carriesRequest(e.data)));
  assert.equal(original.nodes.find(n => n.id === 'eks-control')!.data.visualContainerId, 'eks-region');
  assert.equal(original.nodes.find(n => n.id === 'eks-vpc')!.data.visualContainerId, 'eks-region');
  const endpoint = original.nodes.find(n => n.id === 'eks-cluster')!;
  assert.equal(endpoint.data.visualContainerId, 'eks-control');
  const apiServer = original.nodes.find(n => n.id === 'eks-api')!;
  assert.ok(endpoint.position.y + 130 < apiServer.position.y, 'endpoint and API server illustrations must not overlap');
});
// EKS-REF-002. Rule: ordinary Service endpoints require matching Ready pods.
// Source: https://kubernetes.io/docs/concepts/services-networking/service/
// Request: internal GET / at the selected workload snapshot. Expected: success, or 503
// with zero Ready / selector mismatch. Control-plane unavailability does not itself destroy pods.
test('EKS reference exercises readiness without inventing scheduling or control-plane application routing', () => {
  const ref = structuredClone(original);
  const workload = ref.nodes.find(n => n.id === 'eks-workload')!;
  const run = () => runLiveSimulation(ref.nodes, ref.edges, ref.scenario!);
  assert.equal(run().success, true); assert.deepEqual(run(), run());
  workload.data.customConfig.eks.controlPlaneAvailable = false;
  assert.equal(run().success, true);
  workload.data.customConfig.eks.readyPods = 0;
  assert.equal(run().statusCode, 503);
  workload.data.customConfig.eks.readyPods = 3;
  workload.data.customConfig.eks.serviceSelector = 'wrong-label';
  assert.equal(run().statusCode, 503);
  const result = runLiveSimulation(ref.nodes, ref.edges, { ...ref.scenario!, startNodeId: 'eks-cluster' });
  assert.equal(result.success, false); assert.equal(result.statusCode, 400);
});
test('EKS reference nested boxes and resources fit inside their declared boundaries', () => {
  for (const node of original.nodes.filter(n => n.data.visualContainerId)) {
    const parent = original.nodes.find(n => n.id === node.data.visualContainerId)!;
    assert.ok(node.position.x >= parent.position.x && node.position.y >= parent.position.y);
    assert.ok(node.position.x + (node.data.width ?? 150) <= parent.position.x + parent.data.width, node.id);
    assert.ok(node.position.y + (node.data.height ?? 130) <= parent.position.y + parent.data.height, node.id);
  }
});

test('EKS component links are conceptual API relationships, never application hops or VPCs', async () => {
  const { isEksManagementPair } = await import('../src/engine/architecture/eksRelationships.ts');
  const { checkConnection } = await import('../src/engine/architecture/connectionContracts.ts');
  const byId = (id: string) => original.nodes.find(n => n.id === id)!;
  for (const id of ['eks-etcd', 'eks-scheduler', 'eks-controllers']) {
    assert.equal(isEksManagementPair(byId('eks-api'), byId(id)), true);
    assert.equal(checkConnection(byId('eks-api'), byId(id), { relationship: 'manages', protocol: 'HTTPS' }).status, 'valid');
    assert.equal(checkConnection(byId('eks-api'), byId(id), { relationship: 'request', protocol: 'HTTPS' }).status, 'invalid');
    assert.notEqual(byId(id).data.boundaryType, 'vpc');
  }
  assert.equal(isEksManagementPair(byId('eks-worker-a'), byId('eks-etcd')), false);
  const otherCluster = structuredClone(byId('eks-scheduler')); otherCluster.data.eksClusterName = 'another';
  assert.equal(isEksManagementPair(byId('eks-api'), otherCluster), false);
});

// EKS-COMM-001: all node API usage terminates at kube-apiserver; endpoint is an address.
// https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/
// Expected: no endpoint-to-worker management actor; kubelet watches/status and API->kubelet
// operations have distinct conceptual links. Controllers/scheduler use API objects, not workers.
test('Both EKS references distinguish endpoint access from API server and kubelet operations', () => {
  for (const filename of ['15-eks-architecture.json', '16-eks-multi-cluster-architecture.json']) {
    const ref = parseReference(readFileSync(new URL(`../src/data/references/${filename}`, import.meta.url), 'utf8'));
    const by = new Map(ref.nodes.map(n => [n.id, n]));
    for (const worker of ref.nodes.filter(n => n.data.customConfig?.eksNode)) {
      const cluster = worker.data.customConfig.eksNode.clusterName;
      const server = ref.nodes.find(n => n.data.eksComponent === 'api-server' && n.data.eksClusterName === cluster)!;
      assert.ok(ref.edges.some(e => e.source === worker.id && e.target === server.id && /via private endpoint/.test(e.data.label)));
      assert.ok(ref.edges.some(e => e.source === server.id && e.target === worker.id && /logs \/ attach \/ port-forward/.test(e.data.label)));
      assert.ok(!ref.edges.some(e => (e.source === worker.id && by.get(e.target)?.data.eksComponent === 'api-endpoint') || (e.target === worker.id && by.get(e.source)?.data.eksComponent === 'api-endpoint')));
    }
    for (const component of ref.nodes.filter(n => ['controllers', 'scheduler'].includes(n.data.eksComponent))) {
      assert.ok(ref.edges.some(e => e.source === component.id && by.get(e.target)?.data.eksComponent === 'api-server'));
    }
    assert.ok(ref.edges.every(e => !carriesRequest(e.data)));
  }
});

test('Initial EKS references retain aggregate control planes without explicit managed NLB components', () => {
  for (const filename of ['15-eks-architecture.json', '16-eks-multi-cluster-architecture.json']) {
    const ref = parseReference(readFileSync(new URL(`../src/data/references/${filename}`, import.meta.url), 'utf8'));
    assert.ok(!ref.nodes.some(n => n.data.eksComponent === 'managed-nlb'));
    for (const endpoint of ref.nodes.filter(n => n.data.eksComponent === 'api-endpoint')) {
      assert.ok(ref.edges.some(e => e.source === endpoint.id && ref.nodes.find(n => n.id === e.target)?.data.eksComponent === 'api-server'));
    }
  }
});
