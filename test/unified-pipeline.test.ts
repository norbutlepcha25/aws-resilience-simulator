// End-to-end tests for the Phase 8 Unified Request/Flow Simulation Engine
// (src/engine/pipeline/) - the 7 required realistic architectures, each with a success, a
// failure, and an explanation (trace-format) scenario. Standalone against `runUnifiedPipeline`
// directly (see docs/aws-behavior/UNIFIED_PIPELINE_DEVIATIONS.md §0 for why this is not yet
// wired into `runSimulation`) - does not touch test/engine.test.ts, which stays untouched and
// must keep passing (95/95 after Phases 5-6, 107/107 after Phase 7).
import assert from 'node:assert';
import test from 'node:test';

import { runUnifiedPipeline } from '../src/engine/pipeline/engine.ts';
import { renderTrace } from '../src/engine/pipeline/trace.ts';
import { toSimulationResult } from '../src/engine/pipeline/adapter.ts';
import type { UnifiedRequest } from '../src/engine/pipeline/types.ts';
import type { Principal, Policy } from '../src/engine/iam/types.ts';

function svcNode(id: string, serviceId: string, overrides: Record<string, any> = {}) {
  return {
    id,
    type: 'serviceNode',
    position: { x: 0, y: 0 },
    data: { serviceId, label: overrides.label || id, category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', ...overrides }
  };
}

function edge(id: string, source: string, target: string, protocol: string) {
  return { id, source, target, type: 'custom', data: { protocol, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 } };
}

function allowPolicy(action: string, resourceArn = '*'): Policy {
  return { id: 'Allow', kind: 'identity', statements: [{ effect: 'Allow', actions: [action], resources: [resourceArn] }] };
}

function principal(id: string, policies: Policy[]): Principal {
  return { id, kind: 'role', accountId: 'acct-1', identityPolicies: policies };
}

// ---------------------------------------------------------------------------
// 1. Internet -> ALB -> EC2
// ---------------------------------------------------------------------------

function albEc2Nodes(ec2Health: 'healthy' | 'failed' = 'healthy') {
  return [
    svcNode('user', 'user', { label: 'User', subnet: 'global' }),
    svcNode('igw', 'internet_gateway', { label: 'IGW', subnet: 'public' }),
    svcNode('alb', 'alb', { label: 'ALB', subnet: 'public' }),
    svcNode('ec2', 'ec2', { label: 'Web Server', subnet: 'private', health: ec2Health })
  ];
}
const albEc2Edges = [edge('e1', 'user', 'igw', 'HTTPS'), edge('e2', 'igw', 'alb', 'HTTPS'), edge('e3', 'alb', 'ec2', 'HTTP')];

test('P1. Internet -> ALB -> EC2: success', () => {
  const result = runUnifiedPipeline(albEc2Nodes() as any, albEc2Edges as any, { source: 'user' });
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P1. Internet -> ALB -> EC2: failure (EC2 target down)', () => {
  const result = runUnifiedPipeline(albEc2Nodes('failed') as any, albEc2Edges as any, { source: 'user' });
  assert.strictEqual(result.status, 'UNAVAILABLE');
  assert.ok(result.reason.toLowerCase().includes('healthy'));
});

test('P1. Internet -> ALB -> EC2: explanation trace', () => {
  const result = runUnifiedPipeline(albEc2Nodes('failed') as any, albEc2Edges as any, { source: 'user' });
  const text = renderTrace(result);
  assert.ok(text.includes('ALB'));
  assert.ok(text.includes('✗'));
  assert.ok(text.includes('FINAL:'));
  assert.ok(text.includes('FAILED'));
  assert.ok(text.includes('REASON:'));

  const simResult = toSimulationResult({ id: 's', name: 'n', method: 'GET', path: '/', startNodeId: 'user', trafficLevel: 'normal' }, result);
  assert.strictEqual(simResult.success, false);
  assert.strictEqual(simResult.statusCode, 503);
  assert.ok(simResult.steps.length > 0, 'UI-compatible SimulationStep[] must be produced');
});

// ---------------------------------------------------------------------------
// 2. Internet -> ALB -> ECS -> RDS
// ---------------------------------------------------------------------------

function albEcsRdsNodes(rdsHealth: 'healthy' | 'failed' = 'healthy', multiAz = false) {
  return [
    svcNode('user', 'user', { label: 'User', subnet: 'global' }),
    svcNode('igw', 'internet_gateway', { label: 'IGW', subnet: 'public' }),
    svcNode('alb', 'alb', { label: 'ALB', subnet: 'public' }),
    svcNode('ecs', 'ecs', { label: 'ECS Service', subnet: 'private' }),
    svcNode('rds', 'rds', { label: 'Orders DB', subnet: 'private', health: rdsHealth, multiAz })
  ];
}
const albEcsRdsEdges = [edge('e1', 'user', 'igw', 'HTTPS'), edge('e2', 'igw', 'alb', 'HTTPS'), edge('e3', 'alb', 'ecs', 'HTTP'), edge('e4', 'ecs', 'rds', 'SQL')];

test('P2. Internet -> ALB -> ECS -> RDS: success', () => {
  const result = runUnifiedPipeline(albEcsRdsNodes() as any, albEcsRdsEdges as any, { source: 'user' });
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P2. Internet -> ALB -> ECS -> RDS: failure (single-AZ RDS down)', () => {
  const result = runUnifiedPipeline(albEcsRdsNodes('failed', false) as any, albEcsRdsEdges as any, { source: 'user' });
  assert.strictEqual(result.status, 'TIMEOUT');
});

test('P2. Internet -> ALB -> ECS -> RDS: explanation trace, and Multi-AZ survives failover', () => {
  const failoverResult = runUnifiedPipeline(albEcsRdsNodes('failed', true) as any, albEcsRdsEdges as any, { source: 'user' });
  assert.strictEqual(failoverResult.status, 'SUCCESS', 'Multi-AZ RDS must survive a failed primary via automated failover');

  const failResult = runUnifiedPipeline(albEcsRdsNodes('failed', false) as any, albEcsRdsEdges as any, { source: 'user' });
  const text = renderTrace(failResult);
  assert.ok(text.includes('Orders DB'));
  assert.ok(text.includes('FINAL:\nFAILED'));
});

// ---------------------------------------------------------------------------
// 3. API Gateway -> Lambda -> DynamoDB
// ---------------------------------------------------------------------------

function apiLambdaDdbNodes() {
  return [
    svcNode('apigw', 'api_gateway', { label: 'HTTP API', subnet: 'global' }),
    svcNode('lambda', 'lambda', { label: 'Order Handler', subnet: 'private' }),
    svcNode('ddb', 'dynamodb', { label: 'Orders Table', subnet: 'global' })
  ];
}
const apiLambdaDdbEdges = [edge('e1', 'apigw', 'lambda', 'HTTPS'), edge('e2', 'lambda', 'ddb', 'HTTPS')];

test('P3. API Gateway -> Lambda -> DynamoDB: success', () => {
  const result = runUnifiedPipeline(apiLambdaDdbNodes() as any, apiLambdaDdbEdges as any, { source: 'apigw' });
  assert.strictEqual(result.status, 'SUCCESS', 'API Gateway forwarding to a private-subnet Lambda is a legitimate mediated path, not a direct-ingress violation');
});

test('P3. API Gateway -> Lambda -> DynamoDB: failure (IAM denied on the table)', () => {
  const request: UnifiedRequest = {
    source: 'apigw',
    principal: principal('LambdaExecutionRole', []), // no policy at all
    action: 'dynamodb:PutItem',
    resource: 'arn:aws:dynamodb:::table/orders'
  };
  const result = runUnifiedPipeline(apiLambdaDdbNodes() as any, apiLambdaDdbEdges as any, request);
  assert.strictEqual(result.status, 'DENIED');
});

test('P3. API Gateway -> Lambda -> DynamoDB: explanation trace (allowed)', () => {
  const request: UnifiedRequest = {
    source: 'apigw',
    principal: principal('LambdaExecutionRole', [allowPolicy('dynamodb:PutItem')]),
    action: 'dynamodb:PutItem',
    resource: 'arn:aws:dynamodb:::table/orders'
  };
  const result = runUnifiedPipeline(apiLambdaDdbNodes() as any, apiLambdaDdbEdges as any, request);
  const text = renderTrace(result);
  assert.ok(text.includes('Orders Table'));
  assert.ok(text.includes('IAM authorization'));
  assert.ok(text.includes('FINAL:\nSUCCESS'));
});

// ---------------------------------------------------------------------------
// 4. EC2 -> S3
// ---------------------------------------------------------------------------

function ec2S3Nodes() {
  // A private-subnet resource reaching S3 needs a NAT Gateway or VPC Endpoint, exactly like the
  // rest of this simulator already requires (test 21/24 in test/engine.test.ts) - this fixture
  // includes the NAT Gateway so the "success" case is a realistic, complete architecture.
  return [
    svcNode('ec2', 'ec2', { label: 'App Server', subnet: 'private' }),
    svcNode('s3', 's3', { label: 'Assets Bucket', subnet: 'global' }),
    svcNode('nat', 'nat_gateway', { label: 'NAT Gateway', subnet: 'public' })
  ];
}
const ec2S3Edges = [edge('e1', 'ec2', 's3', 'HTTPS')];

test('P4. EC2 -> S3: success', () => {
  const result = runUnifiedPipeline(ec2S3Nodes() as any, ec2S3Edges as any, { source: 'ec2' });
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P4. EC2 -> S3: failure (Security Group blocks it)', () => {
  const nodes: any[] = ec2S3Nodes();
  nodes[1].data.securityGroupIds = ['sg1'];
  const sg = { id: 'sg1', type: 'boundaryNode', position: { x: -500, y: -500 }, data: { boundaryType: 'security_group', width: 10, height: 10, label: 'Restrictive SG', allowedProtocols: ['SQL'] } };
  const result = runUnifiedPipeline([...nodes, sg] as any, ec2S3Edges as any, { source: 'ec2' });
  assert.strictEqual(result.status, 'BLOCKED');
});

test('P4. EC2 -> S3: explanation trace', () => {
  const result = runUnifiedPipeline(ec2S3Nodes() as any, ec2S3Edges as any, { source: 'ec2' });
  const text = renderTrace(result);
  assert.ok(text.includes('Assets Bucket'));
  assert.ok(text.includes('FINAL:\nSUCCESS'));
});

// ---------------------------------------------------------------------------
// 5. Lambda -> S3
// ---------------------------------------------------------------------------

function lambdaS3Nodes() {
  return [
    svcNode('lambda', 'lambda', { label: 'Thumbnail Fn', subnet: 'private' }),
    svcNode('s3', 's3', { label: 'Photos Bucket', subnet: 'global' }),
    svcNode('nat', 'nat_gateway', { label: 'NAT Gateway', subnet: 'public' })
  ];
}
const lambdaS3Edges = [edge('e1', 'lambda', 's3', 'HTTPS')];

test('P5. Lambda -> S3: success', () => {
  const request: UnifiedRequest = { source: 'lambda', principal: principal('LambdaExecutionRole', [allowPolicy('s3:GetObject')]), action: 's3:GetObject', resource: 'arn:aws:s3:::photos/pic.jpg' };
  const result = runUnifiedPipeline(lambdaS3Nodes() as any, lambdaS3Edges as any, request);
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P5. Lambda -> S3: failure (execution role has no S3 permissions)', () => {
  const request: UnifiedRequest = { source: 'lambda', principal: principal('LambdaExecutionRole', []), action: 's3:GetObject', resource: 'arn:aws:s3:::photos/pic.jpg' };
  const result = runUnifiedPipeline(lambdaS3Nodes() as any, lambdaS3Edges as any, request);
  assert.strictEqual(result.status, 'DENIED');
});

test('P5. Lambda -> S3: explanation trace (denied)', () => {
  const request: UnifiedRequest = { source: 'lambda', principal: principal('LambdaExecutionRole', []), action: 's3:GetObject', resource: 'arn:aws:s3:::photos/pic.jpg' };
  const result = runUnifiedPipeline(lambdaS3Nodes() as any, lambdaS3Edges as any, request);
  const text = renderTrace(result);
  assert.ok(text.includes('✗ IAM authorization'));
  assert.ok(text.includes('FINAL:\nFAILED'));
});

// ---------------------------------------------------------------------------
// 6. Private EC2 -> Internet through NAT
// ---------------------------------------------------------------------------

function privateEc2NatNodes(includeNat: boolean, natHealth: 'healthy' | 'failed' = 'healthy') {
  const nodes: any[] = [
    svcNode('ec2', 'ec2', { label: 'App Server', subnet: 'private' }),
    svcNode('ext', 'api_client', { label: 'Payment API', subnet: 'global' })
  ];
  if (includeNat) nodes.push(svcNode('nat', 'nat_gateway', { label: 'NAT Gateway', subnet: 'public', health: natHealth }));
  return nodes;
}
const privateEc2NatEdges = [edge('e1', 'ec2', 'ext', 'HTTPS')];

test('P6. Private EC2 -> Internet through NAT: success', () => {
  const result = runUnifiedPipeline(privateEc2NatNodes(true) as any, privateEc2NatEdges as any, { source: 'ec2' });
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P6. Private EC2 -> Internet through NAT: failure (no NAT Gateway at all)', () => {
  const result = runUnifiedPipeline(privateEc2NatNodes(false) as any, privateEc2NatEdges as any, { source: 'ec2' });
  assert.strictEqual(result.status, 'MISCONFIGURED');
});

test('P6. Private EC2 -> Internet through NAT: explanation trace (NAT Gateway down)', () => {
  const result = runUnifiedPipeline(privateEc2NatNodes(true, 'failed') as any, privateEc2NatEdges as any, { source: 'ec2' });
  assert.strictEqual(result.status, 'UNAVAILABLE');
  const text = renderTrace(result);
  assert.ok(text.includes('NAT Gateway'));
  assert.ok(text.includes('FINAL:\nFAILED'));
});

// ---------------------------------------------------------------------------
// 7. ECS -> RDS
// ---------------------------------------------------------------------------

function ecsRdsNodes(rdsHealth: 'healthy' | 'failed' = 'healthy') {
  return [svcNode('ecs', 'ecs', { label: 'Order Service', subnet: 'private' }), svcNode('rds', 'rds', { label: 'Orders DB', subnet: 'private', health: rdsHealth })];
}
const ecsRdsEdges = [edge('e1', 'ecs', 'rds', 'SQL')];

test('P7. ECS -> RDS: success', () => {
  const result = runUnifiedPipeline(ecsRdsNodes() as any, ecsRdsEdges as any, { source: 'ecs' });
  assert.strictEqual(result.status, 'SUCCESS');
});

test('P7. ECS -> RDS: failure (single-AZ RDS down)', () => {
  const result = runUnifiedPipeline(ecsRdsNodes('failed') as any, ecsRdsEdges as any, { source: 'ecs' });
  assert.strictEqual(result.status, 'TIMEOUT');
});

test('P7. ECS -> RDS: explanation trace', () => {
  const result = runUnifiedPipeline(ecsRdsNodes('failed') as any, ecsRdsEdges as any, { source: 'ecs' });
  const text = renderTrace(result);
  assert.ok(text.includes('Order Service'));
  assert.ok(text.includes('Orders DB'));
  assert.ok(text.includes('FINAL:\nFAILED'));
  assert.ok(text.includes('REASON:'));
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('P8. Same request always produces the same result (deterministic)', () => {
  const nodes = albEc2Nodes();
  const first = runUnifiedPipeline(nodes as any, albEc2Edges as any, { source: 'user' });
  const second = runUnifiedPipeline(nodes as any, albEc2Edges as any, { source: 'user' });
  assert.strictEqual(first.status, second.status);
  assert.strictEqual(first.reason, second.reason);
});
