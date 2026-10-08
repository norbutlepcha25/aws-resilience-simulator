import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReference } from '../src/engine/persistence/references.ts';
import { runLiveSimulation } from '../src/engine/simulation/liveSimulation.ts';
import { isEksManagementPair } from '../src/engine/architecture/eksRelationships.ts';
import { carriesRequest } from '../src/engine/architecture/relationships.ts';
const reference = parseReference(readFileSync(new URL('../src/data/references/16-eks-multi-cluster-architecture.json', import.meta.url), 'utf8'));
// EKS-MULTI-001. AWS rule: every EKS cluster has its own unique control plane.
// Source: https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html
// Scenario: two clusters, separate VPCs, independent observed Service readiness.
// Expected/actual: Alpha NotReady fails without changing Beta; no invented inter-cluster routing.
test('Multi-cluster reference preserves independent control planes and workload outcomes', () => {
  const ref = structuredClone(reference);
  const alpha = ref.nodes.find(n => n.id === 'alpha-eks-workload')!;
  const beta = ref.nodes.find(n => n.id === 'beta-eks-workload')!;
  const run = (startNodeId: string) => runLiveSimulation(ref.nodes, ref.edges, { ...ref.scenario!, startNodeId });
  assert.equal(run(alpha.id).success, true); assert.equal(run(beta.id).success, true);
  const before = run(beta.id);
  alpha.data.customConfig.eks.readyPods = 0;
  assert.equal(run(alpha.id).statusCode, 503); assert.deepEqual(run(beta.id), before);
  assert.notEqual(alpha.data.customConfig.eks.clusterName, beta.data.customConfig.eks.clusterName);
  assert.equal(ref.nodes.filter(n => n.data.eksComponent === 'control-plane').length, 2);
  assert.equal(ref.nodes.filter(n => n.data.eksComponent === 'etcd').length, 2);
  assert.equal(ref.nodes.filter(n => n.data.serviceId === 'ec2').length, 4);
  assert.ok(ref.edges.every(e => !carriesRequest(e.data)));
  assert.equal(isEksManagementPair(ref.nodes.find(n => n.id === 'alpha-eks-api'), ref.nodes.find(n => n.id === 'beta-eks-scheduler')), false);
});
test('Multi-cluster boxes fit their boundaries and use distinct VPC CIDRs', () => {
  const vpcs = reference.nodes.filter(n => n.data.boundaryType === 'vpc');
  assert.deepEqual(vpcs.map(n => n.data.cidr), ['10.70.0.0/16', '10.71.0.0/16']);
  for (const node of reference.nodes.filter(n => n.data.visualContainerId)) {
    const parent = reference.nodes.find(n => n.id === node.data.visualContainerId)!;
    assert.ok(node.position.x >= parent.position.x && node.position.y >= parent.position.y, node.id);
    assert.ok(node.position.x + (node.data.width ?? 150) <= parent.position.x + parent.data.width, node.id);
    assert.ok(node.position.y + (node.data.height ?? 130) <= parent.position.y + parent.data.height, node.id);
  }
});
