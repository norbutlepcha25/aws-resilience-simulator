import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { evaluateAuthorization } from '../../../src/engine/iam/evaluate.ts';
import type { Policy, Principal, ResourceRef } from '../../../src/engine/iam/types.ts';

interface Result { effect: 'Allow' | 'Deny' }

function principal(identityPolicies: Policy[], extra?: Partial<Principal>): Principal {
  return { id: 'test-principal', kind: 'role', accountId: '111111111111', identityPolicies, ...extra };
}
function resource(arn: string, extra?: Partial<ResourceRef>): ResourceRef {
  return { arn, accountId: '111111111111', ...extra };
}

const CASES: ConformanceCase<Result>[] = [
  {
    id: 'IAM-DENY-IMPLICIT-001',
    awsBehavior: 'IAM denies by default: if no policy statement explicitly ALLOWS an action, the request is denied - there is no "allow unless denied" fallback.',
    reference: 'IAM User Guide - "Policy evaluation logic": implicit deny',
    scenario: 'A principal with NO identity policies at all attempts s3:GetObject.',
    configuration: { identityPolicies: [] },
    request: { action: 's3:GetObject', resource: 'arn:aws:s3:::my-bucket/key' },
    expected: { effect: 'Deny' },
    run: () => ({ effect: evaluateAuthorization({ principal: principal([]), action: 's3:GetObject', resource: resource('arn:aws:s3:::my-bucket/key') }).effect }),
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly denies an action with no policy granting it at all - AWS\'s implicit deny.'
      : 'The simulator allowed an action with zero policies granting it - this is the opposite of AWS\'s default-deny posture.'
  },
  {
    id: 'IAM-DENY-EXPLICIT-001',
    awsBehavior: 'An explicit Deny in ANY applicable policy always wins, even when another policy explicitly Allows the same action - explicit deny cannot be overridden.',
    reference: 'IAM User Guide - "Policy evaluation logic": explicit deny always wins',
    scenario: 'One identity policy explicitly ALLOWS s3:DeleteObject; a second identity policy explicitly DENIES it.',
    configuration: { identityPolicies: ['Allow s3:DeleteObject', 'Deny s3:DeleteObject'] },
    request: { action: 's3:DeleteObject', resource: 'arn:aws:s3:::my-bucket/key' },
    expected: { effect: 'Deny' },
    run: () => {
      const allow: Policy = { id: 'allow-policy', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:DeleteObject'], resources: ['*'] }] };
      const deny: Policy = { id: 'deny-policy', kind: 'identity', statements: [{ effect: 'Deny', actions: ['s3:DeleteObject'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([allow, deny]), action: 's3:DeleteObject', resource: resource('arn:aws:s3:::my-bucket/key') }).effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly lets the explicit Deny override the explicit Allow from a different policy.'
      : 'The simulator let an Allow override an explicit Deny - this violates IAM\'s single most important evaluation rule.'
  },
  {
    id: 'IAM-ALLOW-IDENTITY-001',
    awsBehavior: 'An identity-based policy (attached to the principal) can grant permission on its own, with no resource policy required.',
    reference: 'IAM User Guide - "Policy evaluation logic": identity-based and resource-based policies',
    scenario: 'A principal\'s identity policy explicitly allows dynamodb:GetItem; the target table has no resource policy at all.',
    configuration: { identityPolicies: ['Allow dynamodb:GetItem'] },
    request: { action: 'dynamodb:GetItem', resource: 'arn:aws:dynamodb:::table/Orders' },
    expected: { effect: 'Allow' },
    run: () => {
      const policy: Policy = { id: 'ddb-read', kind: 'identity', statements: [{ effect: 'Allow', actions: ['dynamodb:GetItem'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([policy]), action: 'dynamodb:GetItem', resource: resource('arn:aws:dynamodb:::table/Orders') }).effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly grants access via the identity policy alone.'
      : 'The simulator denied an action that the principal\'s own identity policy explicitly allows.'
  },
  {
    id: 'IAM-ALLOW-RESOURCE-001',
    awsBehavior: 'A resource-based policy (e.g. an S3 bucket policy) can independently grant access, even when the principal\'s OWN identity policy grants nothing at all.',
    reference: 'IAM User Guide - "Policy evaluation logic": resource-based policies',
    scenario: 'A principal has no identity policies; the target S3 bucket\'s own resource (bucket) policy explicitly allows this principal to GetObject.',
    configuration: { identityPolicies: [], resourcePolicy: 'Allow s3:GetObject' },
    request: { action: 's3:GetObject', resource: 'arn:aws:s3:::shared-bucket/key' },
    expected: { effect: 'Allow' },
    run: () => {
      const bucketPolicy: Policy = { id: 'bucket-policy', kind: 'resource', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([]), action: 's3:GetObject', resource: resource('arn:aws:s3:::shared-bucket/key', { resourcePolicy: bucketPolicy }) }).effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly grants access via the resource policy alone, with no identity-policy grant needed.'
      : 'The simulator required an identity-policy grant even though the bucket\'s own resource policy explicitly allows this principal.'
  },
  {
    id: 'IAM-WILDCARD-ACTION-001',
    awsBehavior: 'A wildcard in an action pattern (e.g. "s3:Get*") matches any action sharing that prefix.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Action": wildcards',
    scenario: 'An identity policy grants "s3:Get*"; the request is for the specific action s3:GetObject.',
    configuration: { identityPolicies: ['Allow s3:Get*'] },
    request: { action: 's3:GetObject', resource: 'arn:aws:s3:::my-bucket/key' },
    expected: { effect: 'Allow' },
    run: () => {
      const policy: Policy = { id: 'wildcard-action', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:Get*'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([policy]), action: 's3:GetObject', resource: resource('arn:aws:s3:::my-bucket/key') }).effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly expands the "s3:Get*" wildcard to cover s3:GetObject.'
      : 'The simulator failed to match a wildcarded action pattern against a specific action it should cover.'
  },
  {
    id: 'IAM-WILDCARD-ACTION-002',
    awsBehavior: 'A wildcard action pattern only matches actions sharing its stated prefix/shape - it does not match an unrelated action in a different service or a non-matching verb.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Action": wildcards',
    scenario: 'An identity policy grants "s3:Get*"; the request is for s3:DeleteObject (a different verb, same service).',
    configuration: { identityPolicies: ['Allow s3:Get*'] },
    request: { action: 's3:DeleteObject', resource: 'arn:aws:s3:::my-bucket/key' },
    expected: { effect: 'Deny' },
    run: () => {
      const policy: Policy = { id: 'wildcard-action', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:Get*'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([policy]), action: 's3:DeleteObject', resource: resource('arn:aws:s3:::my-bucket/key') }).effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly refuses to let "s3:Get*" cover an unrelated action like s3:DeleteObject.'
      : 'The simulator over-matched a wildcard action pattern to an action it does not actually cover - this would teach a dangerously permissive mental model of wildcards.'
  },
  {
    id: 'IAM-WILDCARD-RESOURCE-001',
    awsBehavior: 'A wildcard "*" resource pattern grants the action on ANY resource.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Resource": wildcards',
    scenario: 'An identity policy grants s3:GetObject on resource "*"; the request targets one specific bucket/key.',
    configuration: { identityPolicies: ['Allow s3:GetObject on *'] },
    request: { action: 's3:GetObject', resource: 'arn:aws:s3:::any-bucket/any-key' },
    expected: { effect: 'Allow' },
    run: () => {
      const policy: Policy = { id: 'wildcard-resource', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([policy]), action: 's3:GetObject', resource: resource('arn:aws:s3:::any-bucket/any-key') }).effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly treats "*" as covering any resource ARN.'
      : 'The simulator failed to apply a "*" resource wildcard to a concrete resource ARN.'
  },
  {
    id: 'IAM-WILDCARD-RESOURCE-002',
    awsBehavior: 'A resource pattern with a specific ARN prefix (e.g. "arn:aws:s3:::my-bucket/*") only matches resources under that specific path, not an unrelated bucket.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Resource": ARN wildcards',
    scenario: 'An identity policy grants access scoped to "arn:aws:s3:::my-bucket/*"; the request targets a DIFFERENT bucket.',
    configuration: { identityPolicies: ['Allow s3:GetObject on arn:aws:s3:::my-bucket/*'] },
    request: { action: 's3:GetObject', resource: 'arn:aws:s3:::other-bucket/key' },
    expected: { effect: 'Deny' },
    run: () => {
      const policy: Policy = { id: 'scoped-resource', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::my-bucket/*'] }] };
      return { effect: evaluateAuthorization({ principal: principal([policy]), action: 's3:GetObject', resource: resource('arn:aws:s3:::other-bucket/key') }).effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly scopes the resource pattern to only "my-bucket", denying access to an unrelated bucket.'
      : 'The simulator over-matched a bucket-scoped resource pattern to a completely different bucket.'
  },
  {
    id: 'IAM-CONDITION-001',
    awsBehavior: 'A policy statement\'s Condition block must be satisfied for the statement to apply - an Allow with an unsatisfied condition does not grant access.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Condition"',
    scenario: 'An identity policy allows s3:GetObject only when aws:SourceIp is within 10.0.0.0/16; the request comes from an IP outside that range.',
    configuration: { identityPolicies: ['Allow s3:GetObject IF SourceIp in 10.0.0.0/16'] },
    request: { action: 's3:GetObject', sourceIp: '203.0.113.5' },
    expected: { effect: 'Deny' },
    run: () => {
      const policy: Policy = {
        id: 'conditional', kind: 'identity',
        statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'], condition: { IpAddress: { 'aws:SourceIp': '10.0.0.0/16' } } }]
      };
      return {
        effect: evaluateAuthorization({
          principal: principal([policy]), action: 's3:GetObject', resource: resource('arn:aws:s3:::my-bucket/key'),
          context: { sourceIp: '203.0.113.5' }
        }).effect
      };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly withholds the Allow when its Condition (source IP in range) is not satisfied.'
      : 'The simulator granted access despite the Condition not being satisfied - Conditions are supposed to be a hard requirement for the statement to apply.'
  },
  {
    id: 'IAM-CONDITION-002',
    awsBehavior: 'When a Condition IS satisfied, the statement applies normally.',
    reference: 'IAM User Guide - "IAM JSON policy elements: Condition"',
    scenario: 'The same conditional policy as above, but the request now comes from an IP inside the required CIDR.',
    configuration: { identityPolicies: ['Allow s3:GetObject IF SourceIp in 10.0.0.0/16'] },
    request: { action: 's3:GetObject', sourceIp: '10.0.5.20' },
    expected: { effect: 'Allow' },
    run: () => {
      const policy: Policy = {
        id: 'conditional', kind: 'identity',
        statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'], condition: { IpAddress: { 'aws:SourceIp': '10.0.0.0/16' } } }]
      };
      return {
        effect: evaluateAuthorization({
          principal: principal([policy]), action: 's3:GetObject', resource: resource('arn:aws:s3:::my-bucket/key'),
          context: { sourceIp: '10.0.5.20' }
        }).effect
      };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly applies the Allow once its Condition is satisfied.'
      : 'The simulator withheld an Allow whose Condition was actually satisfied.'
  }
];

runConformanceCases(CASES);
