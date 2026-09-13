import assert from 'node:assert';
import test from 'node:test';

import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import {
  createFailure,
  analyzeFailureImpact,
  computeEffectiveArchitectureState
} from '../src/engine/failure/index.ts';
import { runSimulation } from '../src/engine/simulation/requestSimulator.ts';
import type { SimulationScenario } from '../src/types/index.ts';

const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
const spofArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'basic-spof-app')!;

assert.ok(haArch, 'highly-available-multiaz template must exist');
assert.ok(spofArch, 'basic-spof-app template must exist');

test('1. Single component failure: a leaf node with no dependents affects only itself', () => {
  const failure = createFailure({
    targetResourceId: 'node-rds-multi-az',
    failureType: 'database_unavailable',
    severity: 'high',
    trigger: 'manual',
    reason: 'Storage volume corruption'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.deepStrictEqual(impact.directlyFailedNodeIds, ['node-rds-multi-az']);
  // Multi-AZ RDS self-heals for every caller (both ECS tasks), so nothing cascades.
  assert.deepStrictEqual(impact.cascadingFailedNodeIds, []);
  assert.ok(impact.survivingNodeIds.includes('node-ecs-az-a'));
  assert.ok(impact.survivingNodeIds.includes('node-ecs-az-b'));
});

test('2. Dependency failure: a single-instance DB failing cascades to its sole dependent', () => {
  const failure = createFailure({
    targetResourceId: 'node-rds',
    failureType: 'dependency_failure',
    severity: 'critical',
    trigger: 'manual'
  });

  const impact = analyzeFailureImpact(spofArch.nodes as any, spofArch.edges as any, failure);

  assert.deepStrictEqual(impact.directlyFailedNodeIds, ['node-rds']);
  // node-ec2 has no Multi-AZ, no cache, no sibling - it has no way to serve requests without RDS.
  assert.ok(impact.cascadingFailedNodeIds.includes('node-ec2'));
  // node-igw is pure network infra - it degrades (errors on this path) but never itself "fails".
  assert.ok(impact.degradedNodeIds.includes('node-igw'));
  assert.ok(!impact.cascadingFailedNodeIds.includes('node-igw'));
  // Route 53 / the client are never touched - propagation stops at the infra hop.
  assert.ok(!impact.affectedNodeIds.includes('node-route53'));
  assert.ok(!impact.affectedNodeIds.includes('node-user'));
});

test('3. Multi-AZ resilience: an AZ-A outage does not destroy AZ-B or cross-AZ dependents', () => {
  const failure = createFailure({
    targetResourceId: 'AZ-A',
    failureType: 'az_failure',
    severity: 'critical',
    trigger: 'manual'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.deepStrictEqual(impact.directlyFailedNodeIds, ['node-ecs-az-a']);
  assert.ok(!impact.affectedNodeIds.includes('node-ecs-az-b'), 'AZ-B compute must be untouched');
  assert.ok(!impact.affectedNodeIds.includes('node-rds-multi-az'), 'Multi-AZ RDS must be untouched');
  // ALB has a healthy alternate target (AZ-B) - it fully survives, never cascades to IGW/CF/etc.
  assert.ok(impact.survivingNodeIds.includes('node-alb'));
  assert.deepStrictEqual(impact.cascadingFailedNodeIds, []);

  // And a real request against the resulting effective state actually succeeds via AZ-B.
  const { nodes: effNodes, edges: effEdges } = computeEffectiveArchitectureState(
    haArch.nodes as any, haArch.edges as any, [failure]
  );
  const scenario: SimulationScenario = {
    id: 's', name: 'GET', method: 'GET', path: '/', startNodeId: 'node-user', trafficLevel: 'normal'
  };
  const result = runSimulation(effNodes, effEdges, scenario);
  assert.strictEqual(result.success, true, 'request must survive the AZ-A outage via AZ-B failover');
});

test('4. NAT Gateway failure: private compute loses internet egress, keeps intra-VPC paths', () => {
  const arch = REFERENCE_ARCHITECTURES.find(a => a.id === 'ecommerce-serverless-nat')
    || REFERENCE_ARCHITECTURES.find(a => a.nodes.some((n: any) => n.data?.serviceId === 'nat_gateway'));
  assert.ok(arch, 'a template with a NAT Gateway must exist');

  const natNode = arch!.nodes.find((n: any) => n.data?.serviceId === 'nat_gateway')!;
  const privateNode = arch!.nodes.find((n: any) =>
    (n.data?.subnet === 'private' || n.data?.subnet === 'isolated') &&
    arch!.edges.some((e: any) => e.source === n.id)
  );
  assert.ok(privateNode, 'template must have a private-subnet node with outgoing edges');

  const failure = createFailure({
    targetResourceId: natNode.id,
    failureType: 'nat_failure',
    severity: 'high',
    trigger: 'manual'
  });

  const impact = analyzeFailureImpact(arch!.nodes as any, arch!.edges as any, failure);

  assert.deepStrictEqual(impact.directlyFailedNodeIds, [natNode.id]);

  const dbTargetEdge = arch!.edges.find((e: any) =>
    e.source === privateNode!.id &&
    ['rds', 'aurora', 'dynamodb'].includes((arch!.nodes.find((n: any) => n.id === e.target)?.data?.serviceId))
  );
  if (dbTargetEdge) {
    assert.ok(!impact.blockedEdgeIds.includes(dbTargetEdge.id), 'intra-VPC edge to the database must survive a NAT failure');
  }
});

test('5. ALB target failure: ALB survives via the surviving healthy target', () => {
  const failure = createFailure({
    targetResourceId: 'node-ecs-az-a',
    failureType: 'load_balancer_target_failure',
    severity: 'medium',
    trigger: 'manual'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.deepStrictEqual(impact.directlyFailedNodeIds, ['node-ecs-az-a']);
  assert.ok(impact.survivingNodeIds.includes('node-alb'));
  assert.deepStrictEqual(impact.cascadingFailedNodeIds, []);

  const scenario: SimulationScenario = {
    id: 's', name: 'GET', method: 'GET', path: '/', startNodeId: 'node-user', trafficLevel: 'normal'
  };
  const { nodes: effNodes, edges: effEdges } = computeEffectiveArchitectureState(
    haArch.nodes as any, haArch.edges as any, [failure]
  );
  const result = runSimulation(effNodes, effEdges, scenario);
  assert.strictEqual(result.success, true, 'ALB must fail over to node-ecs-az-b');
  const albStep = result.steps.find(s => s.sourceNodeId === 'node-alb');
  assert.strictEqual(albStep?.targetNodeId, 'node-ecs-az-b');
});

test('6. ALB target failure with no surviving targets: full outage cascades to the ALB', () => {
  const failureA = createFailure({
    targetResourceId: 'node-ecs-az-a', failureType: 'load_balancer_target_failure', severity: 'high', trigger: 'manual'
  });
  const failureB = createFailure({
    targetResourceId: 'node-ecs-az-b', failureType: 'load_balancer_target_failure', severity: 'high', trigger: 'manual'
  });

  const { nodes: effNodes, edges: effEdges } = computeEffectiveArchitectureState(
    haArch.nodes as any, haArch.edges as any, [failureA, failureB]
  );

  const impactB = analyzeFailureImpact(effNodes, effEdges, failureB);
  // With AZ-A's task already down, AZ-B's task has no sibling left - ALB has zero healthy
  // targets and, per the loadBalancer adapter's own real 503 semantics, degrades (not "fails").
  assert.ok(impactB.degradedNodeIds.includes('node-alb') || impactB.cascadingFailedNodeIds.includes('node-alb'));

  const scenario: SimulationScenario = {
    id: 's', name: 'GET', method: 'GET', path: '/', startNodeId: 'node-user', trafficLevel: 'normal'
  };
  const result = runSimulation(effNodes, effEdges, scenario);
  assert.strictEqual(result.success, false, 'request must fail with no healthy ALB targets');
  assert.strictEqual(result.statusCode, 503);
});

test('7. IAM denial: blocks the specific hop without marking the target node unhealthy', () => {
  const failure = createFailure({
    targetResourceId: 'node-rds',
    failureType: 'iam_denial',
    severity: 'high',
    trigger: 'manual',
    deniedAction: 'rds-db:connect',
    reason: 'Explicit Deny statement blocks rds-db:connect for this role'
  });

  const impact = analyzeFailureImpact(spofArch.nodes as any, spofArch.edges as any, failure);

  assert.ok(impact.blockedEdgeIds.length > 0, 'the edge into node-rds must be blocked');
  assert.ok(impact.cascadingFailedNodeIds.includes('node-ec2'), 'ec2 has no other way to reach rds');

  const { nodes: effNodes } = computeEffectiveArchitectureState(spofArch.nodes as any, spofArch.edges as any, [failure]);
  const rdsNode = effNodes.find(n => n.id === 'node-rds')!;
  assert.strictEqual(rdsNode.data.health, 'healthy', 'IAM denial must not mark the resource itself unhealthy');
});

test('8. Route failure: severs reachability to the target, sparing unrelated edges', () => {
  const failure = createFailure({
    targetResourceId: 'node-ecs-az-b',
    failureType: 'route_failure',
    severity: 'high',
    trigger: 'manual',
    reason: 'Route table missing entry for AZ-B subnet'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.ok(impact.blockedEdgeIds.includes('e-alb-ecs-b'));
  assert.ok(!impact.blockedEdgeIds.includes('e-alb-ecs-a'), 'the AZ-A route is unrelated and must be untouched');
  // ALB still has a healthy path via AZ-A.
  assert.ok(impact.survivingNodeIds.includes('node-alb') ||
    !impact.cascadingFailedNodeIds.includes('node-alb'));
});

test('9. NACL denial: blocks inbound traffic to the target resource', () => {
  const failure = createFailure({
    targetResourceId: 'node-rds',
    failureType: 'nacl_denial',
    severity: 'high',
    trigger: 'manual',
    reason: 'Subnet NACL explicit DENY rule added for SQL traffic'
  });

  const impact = analyzeFailureImpact(spofArch.nodes as any, spofArch.edges as any, failure);

  assert.ok(impact.blockedEdgeIds.includes('edge-ec2-rds'));
  assert.ok(impact.cascadingFailedNodeIds.includes('node-ec2'));
});

test('10. Security Group denial: blocks the hop; a redundant sibling absorbs it when present', () => {
  const failure = createFailure({
    targetResourceId: 'node-ecs-az-a',
    failureType: 'security_group_denial',
    severity: 'medium',
    trigger: 'manual',
    reason: 'Security Group inbound rule for HTTP removed'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.ok(impact.blockedEdgeIds.includes('e-alb-ecs-a'));
  // ALB still has AZ-B's task reachable - it survives entirely.
  assert.ok(impact.survivingNodeIds.includes('node-alb'));
  assert.deepStrictEqual(impact.cascadingFailedNodeIds, []);
});

test('11. DNS failure: severs resolution-dependent reachability to the target', () => {
  const failure = createFailure({
    targetResourceId: 'node-cf',
    failureType: 'dns_failure',
    severity: 'critical',
    trigger: 'manual',
    reason: 'Route 53 health check marks the record unhealthy; no failover record configured'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  assert.ok(impact.blockedEdgeIds.includes('e-r53-cf'));
  // Route 53 is pure edge infra - it degrades, it does not go "down" and drag the client with it.
  assert.ok(!impact.cascadingFailedNodeIds.includes('node-r53'));
  assert.ok(!impact.affectedNodeIds.includes('node-user'));
});

test('12. Surviving components: an unrelated tier is never touched by a failure elsewhere', () => {
  const failure = createFailure({
    targetResourceId: 'node-ecs-az-a',
    failureType: 'instance_unavailable',
    severity: 'medium',
    trigger: 'manual'
  });

  const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);

  // Route 53, CloudFront and the client are all upstream-unrelated to a single ECS task and must
  // never appear in any impact bucket.
  for (const untouched of ['node-r53', 'node-cf', 'node-user']) {
    assert.ok(!impact.affectedNodeIds.includes(untouched), `${untouched} must be untouched`);
  }
});

test('13. Restoring a failure (resolving it) removes its effect from the effective state', () => {
  const failure = createFailure({
    targetResourceId: 'node-rds', failureType: 'database_unavailable', severity: 'high', trigger: 'manual'
  });

  const withFailure = computeEffectiveArchitectureState(spofArch.nodes as any, spofArch.edges as any, [failure]);
  assert.strictEqual(withFailure.nodes.find(n => n.id === 'node-rds')!.data.health, 'failed');
  assert.strictEqual(withFailure.nodes.find(n => n.id === 'node-ec2')!.data.health, 'failed');

  const resolved = { ...failure, state: 'resolved' as const };
  const afterResolve = computeEffectiveArchitectureState(spofArch.nodes as any, spofArch.edges as any, [resolved]);
  assert.strictEqual(afterResolve.nodes.find(n => n.id === 'node-rds')!.data.health, 'healthy');
  assert.strictEqual(afterResolve.nodes.find(n => n.id === 'node-ec2')!.data.health, 'healthy');
});
