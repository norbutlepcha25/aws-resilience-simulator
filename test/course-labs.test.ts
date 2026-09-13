import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_LABS } from '../src/data/courseLabs.ts';
import { runLabReference } from '../src/engine/labs/runLabReference.ts';
import { AWS_SERVICES } from '../src/data/serviceCatalog.ts';

const denied = new Set(['lab0-implicit-deny', 'lab0-explicit-deny', 'lab1-deny', 'lab3-blocked', 'lab7-unavailable', 'lab8-unavailable']);
test('Course index has all nine course lab references', () => {
  assert.deepEqual(COURSE_LABS.map(l => l.number), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(COURSE_LABS.map(l => l.sourceUrl)).size, 9);
});
for (const lab of COURSE_LABS) for (const ref of lab.references) {
  test(`${ref.id}: reference outcome, valid graph, immutable and deterministic`, () => {
    const before = structuredClone(ref);
    for (const node of ref.nodes.filter(n => n.type === 'serviceNode')) assert.ok(AWS_SERVICES.some(s => s.id === node.data.serviceId), node.data.serviceId);
    for (const edge of ref.edges) {
      assert.ok(ref.nodes.some(n => n.id === edge.source));
      assert.ok(ref.nodes.some(n => n.id === edge.target));
    }
    const result = runLabReference(ref);
    assert.equal(result.success, !denied.has(ref.id), result.summary);
    assert.ok(result.steps.length);
    assert.deepEqual(ref, before);
    assert.deepEqual(runLabReference(ref), result);
    if (ref.id === 'lab5-failover') {
      assert.ok(result.path.includes('lab-task-b'));
      assert.ok(!result.path.includes('lab-task-a'));
    }
    if (ref.id === 'lab3-blocked') assert.match(result.summary, /Security Group/);
    if (ref.authorization) assert.ok(result.steps.every(s => s.details?.decision?.component === 'IAM'));
    if (lab.number >= 7) {
      assert.deepEqual(result.path, ['lab-gateway', ref.scenario.path === '/results/' ? 'lab-results' : 'lab-enrolment']);
      assert.match(result.summary, /no scheduler, HPA/);
      assert.equal(ref.nodes.find(n => n.id === 'lab-results')!.data.health, 'healthy');
      assert.equal(ref.nodes.find(n => n.id === 'lab-cluster')!.data.customConfig!.managedNodeGroup.desiredSize, 2);
      assert.equal(ref.nodes.find(n => n.id === 'lab-enrolment')!.data.replicas, ['lab8-five', 'lab8-unavailable'].includes(ref.id) ? 5 : 2);
    }
  });
}
