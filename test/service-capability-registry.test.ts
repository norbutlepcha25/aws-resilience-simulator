import assert from 'node:assert';
import test from 'node:test';

import { AWS_SERVICES } from '../src/data/serviceCatalog.ts';
import {
  getServiceCapabilityRegistry,
  getServiceCapabilityProfile,
  CAPABILITY_FLAGS
} from '../src/engine/capability/index.ts';

const registry = getServiceCapabilityRegistry();

test('1. The registry classifies every catalog service - no service is left out', () => {
  assert.strictEqual(registry.length, AWS_SERVICES.length);
  const ids = new Set(registry.map(p => p.serviceId));
  for (const service of AWS_SERVICES) {
    assert.ok(ids.has(service.id), `${service.id} must have a capability profile`);
  }
});

test('2. Every profile carries all 7 flags and evidence for every true/NOT_APPLICABLE flag - no unexplained claim', () => {
  for (const profile of registry) {
    for (const flag of CAPABILITY_FLAGS) {
      assert.ok(flag in profile.flags, `${profile.serviceId} is missing the ${flag} flag`);
      const status = profile.flags[flag];
      if (status === true || status === 'NOT_APPLICABLE') {
        assert.ok(
          profile.evidence[flag] && profile.evidence[flag]!.length > 0,
          `${profile.serviceId}'s ${flag}=${status} claim has no supporting evidence - this is exactly the false-claim failure mode Phase 14 exists to prevent`
        );
      }
    }
  }
});

test('3. CONFIGURATION and VALIDATION are the universal Tier-3 baseline - true for every service', () => {
  for (const profile of registry) {
    assert.strictEqual(profile.flags.CONFIGURATION, true, `${profile.serviceId} must have CONFIGURATION (every service resolves to a ServiceModel)`);
    assert.strictEqual(profile.flags.VALIDATION, true, `${profile.serviceId} must have VALIDATION (validateConfiguration always runs)`);
  }
});

test('4. S3 matches the spec\'s own worked example: FULL_BEHAVIOR with every axis satisfied', () => {
  const s3 = getServiceCapabilityProfile('s3')!;
  assert.strictEqual(s3.flags.CONFIGURATION, true);
  assert.strictEqual(s3.flags.VALIDATION, true);
  assert.strictEqual(s3.flags.CONNECTIVITY, true);
  assert.strictEqual(s3.flags.IAM_BEHAVIOR, true);
  assert.strictEqual(s3.flags.REQUEST_SIMULATION, true);
  assert.strictEqual(s3.flags.FAILURE_SIMULATION, true);
  assert.strictEqual(s3.classification, 'FULL_BEHAVIOR');
});

test('5. Priority services 1-13 (EC2, Lambda, ECS/Fargate, S3, RDS, DynamoDB, ALB/NLB, API Gateway, SQS/SNS, CloudFront) reach at least PARTIAL, most reach FULL_BEHAVIOR', () => {
  const expectFull = ['ec2', 'lambda', 'fargate', 's3', 'rds', 'dynamodb', 'alb', 'nlb', 'cloudfront'];
  for (const id of expectFull) {
    const p = getServiceCapabilityProfile(id)!;
    assert.strictEqual(p.classification, 'FULL_BEHAVIOR', `${id} expected FULL_BEHAVIOR, got ${p.classification} (${JSON.stringify(p.flags)})`);
  }

  // These have real IAM/config/connectivity behavior but no dedicated SERVICE-FAILURE test yet -
  // PARTIAL is the honest, correct classification, not a bug.
  const expectPartial = ['ecs', 'sqs', 'sns', 'api_gateway'];
  for (const id of expectPartial) {
    const p = getServiceCapabilityProfile(id)!;
    assert.strictEqual(p.classification, 'PARTIAL', `${id} expected PARTIAL, got ${p.classification}`);
  }
});

test('6. EKS: a real, honest gap - dedicated config model, but not yet wired into the live compute/load-balancer/data-tier adapters', () => {
  const eks = getServiceCapabilityProfile('eks')!;
  assert.strictEqual(eks.flags.CONFIGURATION, true);
  assert.strictEqual(eks.flags.VALIDATION, true);
  assert.strictEqual(eks.flags.CONNECTIVITY, false, 'EKS is not yet in any live adapter\'s serviceId list - this is a real gap, not an oversight in the registry');
  assert.strictEqual(eks.flags.REQUEST_SIMULATION, false);
  assert.strictEqual(eks.flags.FAILURE_SIMULATION, false);
  assert.notStrictEqual(eks.classification, 'FULL_BEHAVIOR', 'EKS must never be marked FULL_BEHAVIOR merely because it exists in the catalog with a dedicated model');
});

test('7. SQS: IAM and request success are real, but failure simulation is honestly NOT claimed (a known, documented approximation)', () => {
  const sqs = getServiceCapabilityProfile('sqs')!;
  assert.strictEqual(sqs.flags.IAM_BEHAVIOR, true);
  assert.strictEqual(sqs.flags.REQUEST_SIMULATION, true);
  assert.strictEqual(sqs.flags.FAILURE_SIMULATION, false, 'SQS health has no effect on simulated outcome today (test/engine.test.ts S10) - this must not be claimed true');
  assert.strictEqual(sqs.classification, 'PARTIAL');
});

test('8. RDS: IAM is NOT_APPLICABLE (proven, not just unproven) - distinct from a service with no evidence either way', () => {
  const rds = getServiceCapabilityProfile('rds')!;
  assert.strictEqual(rds.flags.IAM_BEHAVIOR, 'NOT_APPLICABLE');
  assert.ok(rds.evidence.IAM_BEHAVIOR?.includes('SVC-RDS-IAM-N/A-001'));
});

test('9. Never mark "fully simulated" merely for existing in the catalog: a random, un-modeled service is METADATA_ONLY or PARTIAL, never FULL_BEHAVIOR', () => {
  const untouched = registry.filter(p =>
    p.flags.CONNECTIVITY === false &&
    p.flags.REQUEST_SIMULATION === false &&
    p.flags.FAILURE_SIMULATION === false
  );
  assert.ok(untouched.length > 200, `expected the vast majority of the 327 catalog services to still be at the baseline - got only ${untouched.length}`);
  for (const p of untouched) {
    assert.notStrictEqual(p.classification, 'FULL_BEHAVIOR', `${p.serviceId} has no live behavior at all and must not be classified FULL_BEHAVIOR`);
  }
});

test('10. Every FULL_BEHAVIOR service in the registry actually has REQUEST_SIMULATION and FAILURE_SIMULATION true or not_applicable - never derived from catalog presence alone', () => {
  const fullyBehaved = registry.filter(p => p.classification === 'FULL_BEHAVIOR');
  assert.ok(fullyBehaved.length > 0, 'at least the priority services should reach FULL_BEHAVIOR');
  for (const p of fullyBehaved) {
    assert.ok(
      p.flags.REQUEST_SIMULATION === true || p.flags.REQUEST_SIMULATION === 'NOT_APPLICABLE',
      `${p.serviceId} is FULL_BEHAVIOR but its REQUEST_SIMULATION flag is false`
    );
    assert.ok(
      p.flags.FAILURE_SIMULATION === true || p.flags.FAILURE_SIMULATION === 'NOT_APPLICABLE',
      `${p.serviceId} is FULL_BEHAVIOR but its FAILURE_SIMULATION flag is false`
    );
  }
});
