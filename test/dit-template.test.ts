import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { runLiveSimulation } from '../src/engine/simulation/liveSimulation.ts';
// Sources: https://docs.aws.amazon.com/solutions/latest/dynamic-image-transformation-for-amazon-cloudfront/ecs-architecture.html
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html
const fixture = () => structuredClone(REFERENCE_ARCHITECTURES.find(a => a.id === 'ecs-architecture-high-performance-image-processing')!);
const run = (a: ReturnType<typeof fixture>, startNodeId = 'node-client') => runLiveSimulation(a.nodes, a.edges, { id: 'dit', name: 'DIT', startNodeId, method: 'GET', path: '/image.png', trafficLevel: 'normal' });
test('DIT image cache miss performs ECS DynamoDB subrequest, returns, and reaches S3', () => {
  const a = fixture(); const r = run(a);
  assert.equal(r.success, true, r.summary);
  const ids = r.steps.map(s => s.targetNodeId);
  assert.ok(ids.includes('node-ecs') && ids.includes('node-dynamodb-admin') && ids.includes('node-s3-its'));
  assert.ok(ids.indexOf('node-dynamodb-admin') < ids.indexOf('node-s3-its'));
  assert.ok(r.steps.some(step => step.sourceNodeId === 'node-ecs' && step.targetNodeId === 'node-dynamodb-admin' && step.details?.dependencyCall));
  assert.ok(!ids.includes('node-ecr') && !ids.includes('node-rekognition'));
  assert.equal(a.nodes.find(n => n.id === 'node-ecs')!.data.serviceId, 'ecs');
  assert.ok(a.edges.some(e => e.source === 'node-ecs' && e.target === 'node-dynamodb-admin'));
  assert.deepEqual(run(a), r);
});
test('DIT admin and portal flows reach their intended stores', () => {
  const a = fixture();
  for (const [source, target] of [['node-admin', 'node-dynamodb-admin'], ['node-cloudfront-portal', 'node-s3-portal']]) {
    const r = run(a, source); assert.equal(r.success, true, r.summary);
    assert.ok(r.steps.some(s => s.targetNodeId === target));
  }
});
test('DIT denies missing task permission, absent tasks, S3 failure and blocked task SG', () => {
  for (const change of [
    (a: ReturnType<typeof fixture>) => { a.nodes.find(n => n.id === 'node-ecs')!.data.iamRole = undefined; },
    (a: ReturnType<typeof fixture>) => { a.nodes.find(n => n.id === 'node-ecs')!.data.customConfig.ecs.runningCount = 0; },
    (a: ReturnType<typeof fixture>) => { a.nodes.find(n => n.id === 'node-s3-its')!.data.health = 'failed'; },
    (a: ReturnType<typeof fixture>) => { a.nodes.find(n => n.id === 'dit-task-sg')!.data.allowedProtocols = []; }
  ]) { const a = fixture(); change(a); assert.equal(run(a).success, false); }
});
test('DIT required DynamoDB lookup failure stops ECS before the S3 fetch', () => {
  const a = fixture();
  a.nodes.find(n => n.id === 'node-dynamodb-admin')!.data.health = 'failed';
  const r = run(a);
  assert.equal(r.success, false);
  assert.ok(r.steps.some(step => step.targetNodeId === 'node-dynamodb-admin' && step.status === 'failed'));
  assert.ok(!r.steps.some(step => step.targetNodeId === 'node-s3-its'));
});
test('DIT explicit cache hit survives failed origin; VPC origin prerequisite is checked on miss', () => {
  const a = fixture(); a.nodes.find(n => n.id === 'node-ecs')!.data.health = 'failed';
  a.nodes.find(n => n.id === 'node-cloudfront-its')!.data.customConfig.cacheState = 'hit';
  const r = run(a); assert.equal(r.success, true); assert.ok(!r.steps.some(s => s.targetNodeId === 'node-ecs'));
  const b = fixture(); b.nodes = b.nodes.filter(n => n.id !== 'node-igw'); assert.equal(run(b).success, false);
});
