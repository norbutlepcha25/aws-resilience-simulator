import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReference } from '../src/engine/persistence/references.ts';
import { runLiveSimulation } from '../src/engine/simulation/liveSimulation.ts';
import { carriesRequest } from '../src/engine/architecture/relationships.ts';
const ref = parseReference(readFileSync(new URL('../src/data/references/17-eks-managed-control-plane-nlb.json', import.meta.url), 'utf8'));
// AWS rule/source: managed endpoint uses NLB, with ENIs for private/control-plane connectivity.
// https://docs.aws.amazon.com/eks/latest/best-practices/control-plane.html
// Scenario: supplied single-cluster multi-AZ image. Expected/actual: one cluster and NLB,
// representative replicas and ENIs; management illustrations never become request paths.
test('Image-based EKS reference is one cluster with replicated internals and distinct private networking', () => {
  const count = (kind: string) => ref.nodes.filter(n => n.data.eksComponent === kind).length;
  assert.equal(count('api-endpoint'), 1); assert.equal(count('managed-nlb'), 1);
  assert.equal(count('api-server'), 3); assert.equal(count('etcd'), 3);
  assert.equal(count('cross-account-eni'), 2); assert.equal(count('kubelet'), 2);
  assert.equal(count('kube-proxy'), 2);
  assert.ok(ref.edges.every(e => !carriesRequest(e.data)));
  assert.equal(runLiveSimulation(ref.nodes, ref.edges, ref.scenario!).success, true);
  const changed = structuredClone(ref);
  changed.nodes.find(n => n.id === 'ha-workload')!.data.customConfig.eks.readyPods = 0;
  assert.equal(runLiveSimulation(changed.nodes, changed.edges, changed.scenario!).statusCode, 503);
});
test('Image-based EKS component boxes and resources fit their declared boundaries', () => {
  for (const node of ref.nodes.filter(n => n.data.visualContainerId)) {
    const parent = ref.nodes.find(n => n.id === node.data.visualContainerId)!;
    assert.ok(node.position.x >= parent.position.x && node.position.y >= parent.position.y, node.id);
    assert.ok(node.position.x + (node.data.width ?? 150) <= parent.position.x + parent.data.width, node.id);
    assert.ok(node.position.y + (node.data.height ?? 130) <= parent.position.y + parent.data.height, node.id);
  }
});
