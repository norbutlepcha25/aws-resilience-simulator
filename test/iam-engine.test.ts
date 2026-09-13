// Unit tests for the standalone IAM behavioral engine (src/engine/iam/) - Phase 6 of
// docs/target-architecture/MIGRATION_PLAN.md. This engine is not wired into the live request
// simulator (see docs/aws-behavior/IAM_ENGINE_DEVIATIONS.md), so none of these tests touch
// runSimulation or test/engine.test.ts, which is left completely untouched and must keep passing.
import assert from 'node:assert';
import test from 'node:test';

import { evaluateAuthorization } from '../src/engine/iam/evaluate.ts';
import { assumeRole } from '../src/engine/iam/roleAssumption.ts';
import { actionMatches } from '../src/engine/iam/actionMatch.ts';
import { resourceMatches } from '../src/engine/iam/resourceMatch.ts';
import { evaluateCondition } from '../src/engine/iam/conditions.ts';
import type { Policy, Principal, ResourceRef } from '../src/engine/iam/types.ts';

function principal(overrides: Partial<Principal>): Principal {
  return { id: 'p1', kind: 'user', accountId: 'acct-1', identityPolicies: [], ...overrides };
}

function resource(overrides: Partial<ResourceRef>): ResourceRef {
  return { arn: 'arn:aws:s3:::bucket/object.jpg', accountId: 'acct-1', ...overrides };
}

// ---------------------------------------------------------------------------
// Action / resource matching
// ---------------------------------------------------------------------------

test('I1. Action Matching: Exact and Wildcard', () => {
  assert.strictEqual(actionMatches('s3:GetObject', 's3:GetObject'), true);
  assert.strictEqual(actionMatches('s3:GetObject', 's3:PutObject'), false);
  assert.strictEqual(actionMatches('s3:Get*', 's3:GetObject'), true, 'Trailing wildcard must match a specific Get action');
  assert.strictEqual(actionMatches('s3:Get*', 's3:PutObject'), false);
  assert.strictEqual(actionMatches('*', 'anything:AtAll'), true, 'Bare "*" matches every action');
});

test('I2. Resource Matching: Exact ARN and Wildcard', () => {
  assert.strictEqual(resourceMatches('arn:aws:s3:::bucket/object.jpg', 'arn:aws:s3:::bucket/object.jpg'), true);
  assert.strictEqual(resourceMatches('arn:aws:s3:::bucket/*', 'arn:aws:s3:::bucket/thumbnails/cat.jpg'), true);
  assert.strictEqual(resourceMatches('arn:aws:s3:::bucket/*', 'arn:aws:s3:::other-bucket/cat.jpg'), false);
  assert.strictEqual(resourceMatches('*', 'arn:aws:dynamodb:::table/anything'), true);
});

// ---------------------------------------------------------------------------
// Core evaluation: implicit deny, identity allow, resource allow, explicit deny
// ---------------------------------------------------------------------------

test('I3. Implicit Deny: No Policy Grants the Action', () => {
  const decision = evaluateAuthorization({
    principal: principal({ identityPolicies: [] }),
    action: 's3:GetObject',
    resource: resource({})
  });

  assert.strictEqual(decision.effect, 'Deny');
  assert.strictEqual(decision.explicitDeny, null, 'This is a DEFAULT deny, not an explicit one');
  assert.ok(decision.finalReason.includes('Implicit deny'));
  assert.ok(decision.steps.some(s => s.stage === 'evaluate-allow' && s.outcome === 'deny'));
});

test('I4. Identity Policy Allow Grants the Action', () => {
  const allowPolicy: Policy = {
    id: 'LambdaExecutionRolePolicy',
    kind: 'identity',
    statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::bucket/*'] }]
  };

  const decision = evaluateAuthorization({
    principal: principal({ id: 'LambdaExecutionRole', kind: 'role', identityPolicies: [allowPolicy] }),
    action: 's3:GetObject',
    resource: resource({})
  });

  assert.strictEqual(decision.effect, 'Allow');
  assert.ok(decision.policiesConsidered.includes('LambdaExecutionRolePolicy'));
  assert.strictEqual(decision.matchedStatements.length, 1);
});

test('I5. Resource Policy Allow Alone Is Sufficient - No Identity Policy Required', () => {
  const bucketPolicy: Policy = {
    id: 'BucketPolicy',
    kind: 'resource',
    statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::bucket/*'] }]
  };

  const decision = evaluateAuthorization({
    principal: principal({ identityPolicies: [] }), // no identity policy at all
    action: 's3:GetObject',
    resource: resource({ resourcePolicy: bucketPolicy })
  });

  assert.strictEqual(decision.effect, 'Allow', 'A resource policy allow is sufficient by itself, exactly like a real S3 bucket policy granting cross-principal access');
});

test('I6. Explicit Deny Always Wins Over Any Allow', () => {
  const allowPolicy: Policy = {
    id: 'BroadAllow',
    kind: 'identity',
    statements: [{ effect: 'Allow', actions: ['s3:*'], resources: ['*'] }]
  };
  const denyPolicy: Policy = {
    id: 'ExplicitDenyPolicy',
    kind: 'identity',
    statements: [{ sid: 'DenyDelete', effect: 'Deny', actions: ['s3:DeleteObject'], resources: ['*'] }]
  };

  const decision = evaluateAuthorization({
    principal: principal({ identityPolicies: [allowPolicy, denyPolicy] }),
    action: 's3:DeleteObject',
    resource: resource({})
  });

  assert.strictEqual(decision.effect, 'Deny');
  assert.ok(decision.explicitDeny, 'Must be recorded as an EXPLICIT deny, not an implicit one');
  assert.strictEqual(decision.explicitDeny!.policy.id, 'ExplicitDenyPolicy');
  assert.ok(decision.finalReason.includes('Explicit deny'));
});

test('I7. Wildcard Action in an Allow Statement', () => {
  const policy: Policy = { id: 'ReadOnly', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:Get*', 's3:List*'], resources: ['*'] }] };
  const allowed = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 's3:GetObject', resource: resource({}) });
  const denied = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 's3:PutObject', resource: resource({}) });

  assert.strictEqual(allowed.effect, 'Allow', 's3:Get* must match s3:GetObject');
  assert.strictEqual(denied.effect, 'Deny', 's3:Get* must NOT match s3:PutObject');
});

test('I8. Wildcard Resource in an Allow Statement', () => {
  const policy: Policy = { id: 'BucketReader', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::my-bucket/*'] }] };
  const inBucket = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 's3:GetObject', resource: resource({ arn: 'arn:aws:s3:::my-bucket/photos/1.jpg' }) });
  const otherBucket = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 's3:GetObject', resource: resource({ arn: 'arn:aws:s3:::other-bucket/photos/1.jpg' }) });

  assert.strictEqual(inBucket.effect, 'Allow');
  assert.strictEqual(otherBucket.effect, 'Deny', 'Wildcard is scoped to the named bucket only, not every bucket');
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

test('I9. Condition: StringEquals on a Principal Tag Gates the Allow', () => {
  const policy: Policy = {
    id: 'TeamScopedAccess',
    kind: 'identity',
    statements: [{
      effect: 'Allow',
      actions: ['s3:GetObject'],
      resources: ['*'],
      condition: { StringEquals: { 'aws:PrincipalTag/team': 'payments' } }
    }]
  };

  const matchingTag = evaluateAuthorization({
    principal: principal({ identityPolicies: [policy] }),
    action: 's3:GetObject',
    resource: resource({}),
    context: { principalTags: { team: 'payments' } }
  });
  const wrongTag = evaluateAuthorization({
    principal: principal({ identityPolicies: [policy] }),
    action: 's3:GetObject',
    resource: resource({}),
    context: { principalTags: { team: 'marketing' } }
  });
  const noContext = evaluateAuthorization({
    principal: principal({ identityPolicies: [policy] }),
    action: 's3:GetObject',
    resource: resource({})
  });

  assert.strictEqual(matchingTag.effect, 'Allow');
  assert.strictEqual(wrongTag.effect, 'Deny', 'A present but non-matching tag must fail the condition');
  assert.strictEqual(noContext.effect, 'Deny', 'A missing context value must fail the condition, not pass by default');
});

test('I10. Condition: IpAddress Restricts an Allow to a Source CIDR', () => {
  const policy: Policy = {
    id: 'VpcOnlyAccess',
    kind: 'identity',
    statements: [{ effect: 'Allow', actions: ['dynamodb:Query'], resources: ['*'], condition: { IpAddress: { 'aws:SourceIp': '10.0.0.0/16' } } }]
  };

  const fromVpc = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 'dynamodb:Query', resource: resource({}), context: { sourceIp: '10.0.5.20' } });
  const fromInternet = evaluateAuthorization({ principal: principal({ identityPolicies: [policy] }), action: 'dynamodb:Query', resource: resource({}), context: { sourceIp: '203.0.113.9' } });

  assert.strictEqual(fromVpc.effect, 'Allow');
  assert.strictEqual(fromInternet.effect, 'Deny');
});

test('I11. Condition Evaluator Unit Behavior: Missing Context Fails, No Condition Passes', () => {
  const noBlock = evaluateCondition(undefined, {});
  assert.strictEqual(noBlock.satisfied, true, 'A statement with no condition block is unconditional');

  const missingKey = evaluateCondition({ StringEquals: { 'aws:SourceVpc': 'vpc-1' } }, {});
  assert.strictEqual(missingKey.satisfied, false, 'A condition key with no context value must fail, not silently pass');

  const boolCondition = evaluateCondition({ Bool: { 'aws:MultiFactorAuthPresent': true } }, { 'aws:MultiFactorAuthPresent': true } as any);
  assert.strictEqual(boolCondition.satisfied, true);
});

// ---------------------------------------------------------------------------
// Role trust and assumption
// ---------------------------------------------------------------------------

test('I12. Role Trust: A Role Refuses an Untrusted Caller', () => {
  const role: Principal = {
    id: 'DataAnalystRole',
    kind: 'role',
    accountId: 'acct-1',
    identityPolicies: [],
    trustPolicy: { id: 'DataAnalystTrust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['LambdaExecutionRole'] }] }
  };
  const untrustedCaller = principal({ id: 'RandomUser' });

  const result = assumeRole(untrustedCaller, role);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('does not name'));
  assert.strictEqual(result.sessionPrincipal, undefined);
});

test('I13. Role Assumption: Session Principal Uses the ROLE\'s Permissions, Not the Caller\'s', () => {
  // This is the exact scenario in the task's worked example: Lambda -> Execution Role -> S3.
  const s3ReadPolicy: Policy = { id: 'S3ReadOnly', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::bucket/*'] }] };
  const executionRole: Principal = {
    id: 'LambdaExecutionRole',
    kind: 'role',
    accountId: 'acct-1',
    identityPolicies: [s3ReadPolicy],
    trustPolicy: { id: 'LambdaTrust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['lambda.amazonaws.com'] }] }
  };
  const lambdaFunction = principal({ id: 'lambda.amazonaws.com', kind: 'service', identityPolicies: [] }); // the CALLER has no permissions of its own

  const assumption = assumeRole(lambdaFunction, executionRole);
  assert.strictEqual(assumption.allowed, true);
  assert.ok(assumption.sessionPrincipal);

  const decision = evaluateAuthorization({
    principal: assumption.sessionPrincipal!,
    action: 's3:GetObject',
    resource: resource({ arn: 'arn:aws:s3:::bucket/object' })
  });

  assert.strictEqual(decision.effect, 'Allow', 'The assumed-role session must be authorized using the role\'s own S3ReadOnly policy');
  assert.strictEqual(decision.principal, 'LambdaExecutionRole[lambda.amazonaws.com]');

  // The ORIGINAL caller, evaluated directly (never assuming the role), has no permissions at all.
  const callerDirectDecision = evaluateAuthorization({ principal: lambdaFunction, action: 's3:GetObject', resource: resource({ arn: 'arn:aws:s3:::bucket/object' }) });
  assert.strictEqual(callerDirectDecision.effect, 'Deny', 'The caller\'s OWN identity has no S3 permissions - only the assumed role does');
});

test('I14. Role Assumption: Trust Policy Explicit Deny Blocks Assumption Even for a Named Principal', () => {
  const role: Principal = {
    id: 'RestrictedRole',
    kind: 'role',
    accountId: 'acct-1',
    identityPolicies: [],
    trustPolicy: {
      id: 'RestrictedTrust', kind: 'trust',
      statements: [
        { effect: 'Deny', actions: ['sts:AssumeRole'], resources: [], principals: ['suspended-user'] },
        { effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['*'] }
      ]
    }
  };
  const suspendedUser = principal({ id: 'suspended-user' });
  const result = assumeRole(suspendedUser, role);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('explicitly denies'));
});

// ---------------------------------------------------------------------------
// Permissions boundaries and SCPs (ceilings)
// ---------------------------------------------------------------------------

test('I15. Permissions Boundary Caps an Identity Policy That Would Otherwise Allow', () => {
  const broadIdentityPolicy: Policy = { id: 'PowerUserPolicy', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:*'], resources: ['*'] }] };
  const narrowBoundary: Policy = { id: 'ReadOnlyBoundary', kind: 'boundary', statements: [{ effect: 'Allow', actions: ['s3:Get*', 's3:List*'], resources: ['*'] }] };

  const readAllowed = evaluateAuthorization({
    principal: principal({ identityPolicies: [broadIdentityPolicy], permissionsBoundary: narrowBoundary }),
    action: 's3:GetObject',
    resource: resource({})
  });
  const deleteDenied = evaluateAuthorization({
    principal: principal({ identityPolicies: [broadIdentityPolicy], permissionsBoundary: narrowBoundary }),
    action: 's3:DeleteObject',
    resource: resource({})
  });

  assert.strictEqual(readAllowed.effect, 'Allow', 'Read is within both the identity policy and the boundary');
  assert.strictEqual(deleteDenied.effect, 'Deny', 'Delete is granted by the identity policy but the boundary does not include it - the boundary wins as a ceiling');
  assert.ok(deleteDenied.finalReason.includes('boundary'));
});

test('I16. A Permissions Boundary Can Never Grant Anything by Itself', () => {
  // The boundary allows s3:GetObject, but there is no identity/resource policy allow at all -
  // a boundary is a ceiling on existing grants, never a grant of its own.
  const permissiveBoundary: Policy = { id: 'PermissiveBoundary', kind: 'boundary', statements: [{ effect: 'Allow', actions: ['s3:*'], resources: ['*'] }] };
  const decision = evaluateAuthorization({
    principal: principal({ identityPolicies: [], permissionsBoundary: permissiveBoundary }),
    action: 's3:GetObject',
    resource: resource({})
  });
  assert.strictEqual(decision.effect, 'Deny', 'No identity or resource policy grants anything, so the boundary having no restriction is irrelevant - there is nothing to cap');
});

test('I17. Service Control Policy Caps an Account Even When the Identity Policy Allows', () => {
  const identityPolicy: Policy = { id: 'FullS3Access', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:*'], resources: ['*'] }] };
  const restrictiveScp: Policy = { id: 'DenyS3DeleteOrgWide', kind: 'scp', statements: [{ effect: 'Allow', actions: ['s3:Get*', 's3:List*', 's3:Put*'], resources: ['*'] }] };

  const decision = evaluateAuthorization({
    principal: principal({ identityPolicies: [identityPolicy] }),
    action: 's3:DeleteObject',
    resource: resource({}),
    organizationPolicies: [restrictiveScp]
  });

  assert.strictEqual(decision.effect, 'Deny');
  assert.ok(decision.finalReason.includes('Service Control'));
});

// ---------------------------------------------------------------------------
// Cross-account
// ---------------------------------------------------------------------------

test('I18. Cross-Account Role Assumption: Trust Policy Can Name Another Account', () => {
  const crossAccountRole: Principal = {
    id: 'CrossAccountAuditRole',
    kind: 'role',
    accountId: 'acct-security',
    identityPolicies: [{ id: 'AuditReadOnly', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] }],
    trustPolicy: { id: 'CrossAccountTrust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['acct-app'] }] }
  };

  const callerFromTrustedAccount = principal({ id: 'auditor-1', accountId: 'acct-app' });
  const callerFromUntrustedAccount = principal({ id: 'auditor-2', accountId: 'acct-other' });

  const trusted = assumeRole(callerFromTrustedAccount, crossAccountRole);
  const untrusted = assumeRole(callerFromUntrustedAccount, crossAccountRole);

  assert.strictEqual(trusted.allowed, true, 'Trust policy names the CALLER\'S ACCOUNT (acct-app), so any principal in that account may assume it');
  assert.strictEqual(untrusted.allowed, false, 'A caller from an unlisted account must be refused');
});

test('I19. Cross-Account Resource Policy Grants Access Without Role Assumption', () => {
  // A bucket in account acct-1 grants read access directly to a principal in acct-2 via its
  // resource (bucket) policy - no role assumption involved, matching real S3 cross-account access.
  const crossAccountBucketPolicy: Policy = {
    id: 'CrossAccountBucketPolicy', kind: 'resource',
    statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::shared-bucket/*'] }]
  };
  const externalPrincipal = principal({ id: 'partner-user', accountId: 'acct-2', identityPolicies: [] });

  const decision = evaluateAuthorization({
    principal: externalPrincipal,
    action: 's3:GetObject',
    resource: { arn: 'arn:aws:s3:::shared-bucket/report.csv', accountId: 'acct-1', resourcePolicy: crossAccountBucketPolicy }
  });

  assert.strictEqual(decision.effect, 'Allow', 'A resource policy can grant access to a principal with zero identity policies of its own, from a different account');
});

// ---------------------------------------------------------------------------
// Determinism and explainability
// ---------------------------------------------------------------------------

test('I20. Same Request Always Produces the Same Decision (Deterministic)', () => {
  const policy: Policy = { id: 'P', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] };
  const request = { principal: principal({ identityPolicies: [policy] }), action: 's3:GetObject', resource: resource({}) };

  const first = evaluateAuthorization(request);
  const second = evaluateAuthorization(request);
  assert.strictEqual(first.effect, second.effect);
  assert.deepStrictEqual(first.matchedStatements.map(m => m.statement), second.matchedStatements.map(m => m.statement));
});

test('I21. Every Decision Carries the Full Explainability Trace', () => {
  const policy: Policy = { id: 'P', kind: 'identity', statements: [{ sid: 'AllowGet', effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] };
  const decision = evaluateAuthorization({ principal: principal({ id: 'LambdaExecutionRole', identityPolicies: [policy] }), action: 's3:GetObject', resource: resource({}) });

  assert.strictEqual(decision.principal, 'LambdaExecutionRole');
  assert.strictEqual(decision.action, 's3:GetObject');
  assert.strictEqual(decision.resource, 'arn:aws:s3:::bucket/object.jpg');
  assert.ok(decision.policiesConsidered.includes('P'));
  assert.strictEqual(decision.matchedStatements[0].statement.sid, 'AllowGet');
  assert.strictEqual(decision.explicitDeny, null);
  assert.ok(decision.finalReason.length > 0);
  const stages = decision.steps.map(s => s.stage);
  assert.deepStrictEqual(stages, ['authenticate', 'resolve-identity', 'resolve-resource', 'explicit-deny', 'evaluate-allow', 'evaluate-boundary', 'evaluate-scp', 'evaluate-conditions', 'final']);
});
