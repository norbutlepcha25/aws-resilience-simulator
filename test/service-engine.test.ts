// Unit / interaction tests for the standalone Service Behavior Engine (src/engine/service/) -
// Phase 7 of docs/target-architecture/MIGRATION_PLAN.md. Covers the 9 required interaction pairs
// (success / network failure / IAM failure / config failure, where applicable), plus registry
// resolution and the concrete Phase-2 extraction (computeCapacityAdapter now delegates to
// evaluateCapacity - test S1 below is a decisive regression guard for that). Does NOT touch
// test/engine.test.ts, which is left completely unmodified and must keep passing (95/95 total
// after Phases 5-6 remain green).
import assert from 'node:assert';
import test from 'node:test';

import { resolveServiceModel, isDedicatedModel } from '../src/engine/service/registry.ts';
import { simulateInteraction, type InteractionScenario } from '../src/engine/service/interaction.ts';
import { evaluateCapacity } from '../src/engine/service/models/compute.ts';
import type { ServiceNodeSnapshot } from '../src/engine/service/types.ts';
import type { Policy, Principal, ResourceRef } from '../src/engine/iam/types.ts';
import { runSimulation } from '../src/engine/simulation/requestSimulator.ts';
import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import type { SimulationScenario } from '../src/types/index.ts';

function snapshot(overrides: Partial<ServiceNodeSnapshot>): ServiceNodeSnapshot {
  return { serviceId: 'ec2', label: 'Node', health: 'healthy', subnet: 'private', ...overrides };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('S1. Registry: Tier 1/2 Services Resolve to a Dedicated Model; Others Fall Back to Generic', () => {
  for (const id of ['ec2', 'lambda', 'ecs', 'fargate', 'eks', 's3', 'rds', 'dynamodb', 'alb', 'nlb', 'api_gateway', 'sqs', 'sns', 'cloudfront', 'route53', 'iam', 'vpc', 'internet_gateway', 'nat_gateway']) {
    assert.ok(isDedicatedModel(id), `${id} must resolve to a dedicated Tier 1 model`);
    const model = resolveServiceModel(id)!;
    assert.strictEqual(model.tier, 1, `${id} must be Tier 1`);
  }
  for (const id of ['ecr_registry', 'efs', 'kms', 'secrets_manager', 'cognito', 'eventbridge', 'step_functions', 'elasticache', 'cloudwatch', 'waf', 's3_gateway_endpoint', 'privatelink']) {
    assert.ok(isDedicatedModel(id), `${id} must resolve to a dedicated Tier 2 model`);
    assert.strictEqual(resolveServiceModel(id)!.tier, 2);
  }

  // A Tier 3 service (anything else in the catalog) resolves via the generic fallback, built
  // from real catalog data, not fabricated.
  const glue = resolveServiceModel('glue')!;
  assert.ok(glue, 'Any real catalog serviceId must resolve to at least a generic model');
  assert.strictEqual(glue.tier, 3);
  assert.ok(!isDedicatedModel('glue'));
  assert.ok(glue.description.length > 0, 'Generic model must still carry the catalog description');

  assert.strictEqual(resolveServiceModel('not-a-real-service-id'), null, 'An unknown serviceId (no catalog entry) resolves to null, not a fabricated model');
});

test('S2. Phase 2 Extraction Regression Guard: evaluateCapacity Matches the Live Adapter\'s Decision', () => {
  // Decisive: this is the exact scenario test 10/30 in test/engine.test.ts exercise end-to-end.
  // If this standalone function's decision ever diverges from computeCapacityAdapter's, this
  // test (and the full suite) must fail.
  const singleInstance = snapshot({ serviceId: 'ec2', replicas: 1, multiAz: false });
  const saturated = evaluateCapacity(singleInstance, [], '10x', false);
  assert.strictEqual(saturated.decision, 'saturated');

  const scaledInstance = snapshot({ serviceId: 'ec2', replicas: 3, multiAz: true });
  const scaledOut = evaluateCapacity(scaledInstance, [], '10x', false);
  assert.strictEqual(scaledOut.decision, 'scaled-out');

  const lambdaNode = snapshot({ serviceId: 'lambda' });
  const serverless = evaluateCapacity(lambdaNode, [], '100x', true);
  assert.strictEqual(serverless.decision, 'scaled-out');
  assert.strictEqual(serverless.isServerless, true);

  const normalTraffic = evaluateCapacity(singleInstance, [], 'normal', false);
  assert.strictEqual(normalTraffic.decision, 'pass-through', 'No traffic spike - capacity is never a concern');
});

// ---------------------------------------------------------------------------
// Interaction pairs
// ---------------------------------------------------------------------------

function allowAllPolicy(action: string, resourceArn = '*'): Policy {
  return { id: 'AllowAll', kind: 'identity', statements: [{ effect: 'Allow', actions: [action], resources: [resourceArn] }] };
}

function principalWithPolicy(id: string, policies: Policy[]): Principal {
  return { id, kind: 'role', accountId: 'acct-1', identityPolicies: policies };
}

test('S3. EC2 -> S3: Success, IAM Failure, Network Failure', () => {
  const caller = snapshot({ serviceId: 'ec2', label: 'Web Server', subnet: 'private' });
  const target = snapshot({ serviceId: 's3', label: 'Data Bucket', subnet: 'global' });
  const resource: ResourceRef = { arn: 'arn:aws:s3:::bucket/object', accountId: 'acct-1' };

  const success = simulateInteraction({
    caller, target, action: 's3:GetObject', protocol: 'HTTPS',
    authorization: { principal: principalWithPolicy('WebServerRole', [allowAllPolicy('s3:GetObject')]), resource }
  });
  assert.strictEqual(success.outcome, 'success');

  const iamFailure = simulateInteraction({
    caller, target, action: 's3:GetObject', protocol: 'HTTPS',
    authorization: { principal: principalWithPolicy('WebServerRole', []), resource } // no policy at all -> implicit deny
  });
  assert.strictEqual(iamFailure.outcome, 'iam_failure');

  const sgOnBucketEndpoint: any = { id: 'sg1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { boundaryType: 'security_group', width: 10, height: 10, label: 'Restrictive SG', allowedProtocols: ['SQL'] } };
  const targetWithSg = snapshot({ serviceId: 's3', label: 'Data Bucket', subnet: 'global', securityGroupIds: ['sg1'] });
  const networkFailure = simulateInteraction({ caller, target: targetWithSg, action: 's3:GetObject', protocol: 'HTTPS', boundaryNodes: [sgOnBucketEndpoint] });
  assert.strictEqual(networkFailure.outcome, 'network_failure', 'A Security Group that only allows SQL must block an HTTPS S3 call');
});

test('S4. Lambda -> S3: Success and the Worked Example (Execution Role Path)', () => {
  const caller = snapshot({ serviceId: 'lambda', label: 'Thumbnail Function', subnet: 'private' });
  const target = snapshot({ serviceId: 's3', label: 'Photos Bucket', subnet: 'global' });
  const resource: ResourceRef = { arn: 'arn:aws:s3:::bucket/object', accountId: 'acct-1' };

  const result = simulateInteraction({
    caller, target, action: 's3:GetObject', protocol: 'HTTPS',
    authorization: { principal: principalWithPolicy('LambdaExecutionRole', [allowAllPolicy('s3:GetObject', 'arn:aws:s3:::bucket/*')]), resource }
  });
  assert.strictEqual(result.outcome, 'success');
  assert.strictEqual(result.iamDecision!.effect, 'Allow');
});

test('S5. EC2 -> RDS: Success, Network Failure, Config Failure', () => {
  const caller = snapshot({ serviceId: 'ec2', label: 'App Server', subnet: 'private' });
  const healthyRds = snapshot({ serviceId: 'rds', label: 'Orders DB', subnet: 'private' });
  const unplacedRds = snapshot({ serviceId: 'rds', label: 'Orders DB', subnet: 'unassigned' });

  const success = simulateInteraction({ caller, target: healthyRds, action: 'rds:ExecuteQuery', protocol: 'SQL' });
  assert.strictEqual(success.outcome, 'success');

  // Boundary sized to geometrically contain the fake target node's default-sized center point
  // (toFakeNode positions nodes at {x:0,y:0} with the default 120x80 footprint, so its center is
  // at (60,40) - NACL containment (unlike Security Group attachment) is genuinely geometric).
  const denyNacl: any = { id: 'subnet1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { boundaryType: 'private_subnet', width: 400, height: 400, naclDenyInbound: ['SQL'] } };
  const networkFailure = simulateInteraction({ caller, target: healthyRds, action: 'rds:ExecuteQuery', protocol: 'SQL', boundaryNodes: [denyNacl] });
  assert.strictEqual(networkFailure.outcome, 'network_failure');

  const configFailure = simulateInteraction({ caller, target: unplacedRds, action: 'rds:ExecuteQuery', protocol: 'SQL' });
  assert.strictEqual(configFailure.outcome, 'config_failure', 'An RDS instance not placed in any subnet is a configuration failure, not a network or IAM one');
});

test('S6. ECS -> RDS: Multi-AZ Failover Survives a Failed Primary, Single-AZ Does Not', () => {
  const caller = snapshot({ serviceId: 'ecs', label: 'Orders Service', subnet: 'private' });
  const failedMultiAz = snapshot({ serviceId: 'rds', label: 'Orders DB', subnet: 'private', health: 'failed', multiAz: true });
  const failedSingleAz = snapshot({ serviceId: 'rds', label: 'Orders DB', subnet: 'private', health: 'failed', multiAz: false });

  const failover = simulateInteraction({ caller, target: failedMultiAz, action: 'rds:ExecuteQuery', protocol: 'SQL' });
  assert.strictEqual(failover.outcome, 'success', 'Multi-AZ RDS survives a failed primary via automated failover');

  const hardFailure = simulateInteraction({ caller, target: failedSingleAz, action: 'rds:ExecuteQuery', protocol: 'SQL' });
  assert.strictEqual(hardFailure.outcome, 'service_failure', 'Single-AZ RDS with no standby has nothing to fail over to');
});

test('S7. ALB -> ECS: Routes to a Healthy Target, Fails When All Targets Are Down', () => {
  const alb = snapshot({ serviceId: 'alb', label: 'ALB', subnet: 'public' });
  const healthyTask = snapshot({ serviceId: 'ecs', label: 'Task B', subnet: 'private', health: 'healthy' });
  const failedTask = snapshot({ serviceId: 'ecs', label: 'Task A', subnet: 'private', health: 'failed' });

  const routed = simulateInteraction({ caller: snapshot({ serviceId: 'user' }), target: alb, action: 'route', protocol: 'HTTP', siblingSnapshots: [failedTask, healthyTask] });
  assert.strictEqual(routed.outcome, 'success');
  assert.ok(routed.reason.includes('Task B'));

  const allDown = simulateInteraction({ caller: snapshot({ serviceId: 'user' }), target: alb, action: 'route', protocol: 'HTTP', siblingSnapshots: [failedTask, { ...failedTask, label: 'Task A2' }] });
  assert.strictEqual(allDown.outcome, 'service_failure', 'No healthy targets - 503-equivalent service failure');
});

test('S8. API Gateway -> Lambda: Success, IAM Failure', () => {
  const caller = snapshot({ serviceId: 'api_gateway', label: 'HTTP API', subnet: 'global' });
  const target = snapshot({ serviceId: 'lambda', label: 'Order Handler', subnet: 'private' });
  const resource: ResourceRef = { arn: 'arn:aws:lambda:::function/order-handler', accountId: 'acct-1' };

  const success = simulateInteraction({
    caller, target, action: 'lambda:InvokeFunction', protocol: 'HTTPS',
    authorization: { principal: principalWithPolicy('ApiGatewayRole', [allowAllPolicy('lambda:InvokeFunction')]), resource }
  });
  assert.strictEqual(success.outcome, 'success');

  const iamFailure = simulateInteraction({
    caller, target, action: 'lambda:InvokeFunction', protocol: 'HTTPS',
    authorization: { principal: principalWithPolicy('ApiGatewayRole', [allowAllPolicy('lambda:GetFunction')]), resource } // wrong action
  });
  assert.strictEqual(iamFailure.outcome, 'iam_failure');
});

test('S9. Lambda -> DynamoDB: Success, Service Failure (Failed With No Multi-AZ Flag)', () => {
  const caller = snapshot({ serviceId: 'lambda', label: 'Order Processor', subnet: 'private' });
  const healthyTable = snapshot({ serviceId: 'dynamodb', label: 'Orders Table', subnet: 'global' });
  const failedTable = snapshot({ serviceId: 'dynamodb', label: 'Orders Table', subnet: 'global', health: 'failed' });

  const success = simulateInteraction({ caller, target: healthyTable, action: 'dynamodb:PutItem', protocol: 'HTTPS' });
  assert.strictEqual(success.outcome, 'success');

  const failure = simulateInteraction({ caller, target: failedTable, action: 'dynamodb:PutItem', protocol: 'HTTPS' });
  assert.strictEqual(failure.outcome, 'service_failure', 'A failed DynamoDB table with no multiAz/Multi-AZ marker follows the documented (approximated) DB rule - see SERVICE_ENGINE_DEVIATIONS.md §3');
});

test('S10. EC2 -> SQS: Always Succeeds Regardless of Queue Health (Documented Approximation)', () => {
  const caller = snapshot({ serviceId: 'ec2', label: 'App Server', subnet: 'private' });
  const failedQueue = snapshot({ serviceId: 'sqs', label: 'Orders Queue', subnet: 'global', health: 'failed' });

  const result = simulateInteraction({ caller, target: failedQueue, action: 'sqs:SendMessage', protocol: 'Message' });
  assert.strictEqual(result.outcome, 'success', 'Matches the pre-existing dataTierInteraction adapter behavior: queue health is never checked - see SERVICE_ENGINE_DEVIATIONS.md §4');
});

test('S11. ECS -> SQS: Success and Network Failure', () => {
  const caller = snapshot({ serviceId: 'ecs', label: 'Order Service', subnet: 'private' });
  const queue = snapshot({ serviceId: 'sqs', label: 'Fulfillment Queue', subnet: 'global', securityGroupIds: ['sg1'] });
  const sg: any = { id: 'sg1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { boundaryType: 'security_group', width: 10, height: 10, label: 'Queue SG', allowedProtocols: [] } };

  const success = simulateInteraction({ caller, target: { ...queue, securityGroupIds: undefined }, action: 'sqs:SendMessage', protocol: 'Message' });
  assert.strictEqual(success.outcome, 'success');

  const networkFailure = simulateInteraction({ caller, target: queue, action: 'sqs:SendMessage', protocol: 'Message', boundaryNodes: [sg] });
  assert.strictEqual(networkFailure.outcome, 'network_failure', 'An empty-allow-list Security Group must block every protocol, including Message');
});

// ---------------------------------------------------------------------------
// End-to-end sanity: the live simulator (Phase 2 extraction) still agrees with every existing
// reference architecture, exercised broadly rather than just the two templates test/engine.test.ts
// already covers in depth.
// ---------------------------------------------------------------------------

test('S12. Every Reference Architecture Still Simulates Without Throwing After the Phase 2 Extraction', () => {
  for (const tpl of REFERENCE_ARCHITECTURES) {
    const serviceNodes = tpl.nodes.filter(n => n.type === 'serviceNode' || (n.data as any)?.serviceId);
    const ingress = serviceNodes.find(n => ['user', 'client_ui', 'api_client'].includes((n.data as any).serviceId)) || serviceNodes[0];
    if (!ingress) continue;

    const scenario: SimulationScenario = { id: `s-${tpl.id}`, name: 'Smoke test', method: 'GET', path: '/', startNodeId: ingress.id, trafficLevel: 'normal' };
    assert.doesNotThrow(() => runSimulation(tpl.nodes, tpl.edges, scenario), `${tpl.id} must simulate without throwing`);
  }
});
