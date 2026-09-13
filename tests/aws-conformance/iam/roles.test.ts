import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { assumeRole } from '../../../src/engine/iam/roleAssumption.ts';
import { evaluateAuthorization } from '../../../src/engine/iam/evaluate.ts';
import type { Policy, Principal } from '../../../src/engine/iam/types.ts';

interface AssumeResult { allowed: boolean }
interface AuthResult { effect: 'Allow' | 'Deny' }

const CASES: ConformanceCase<any>[] = [
  {
    id: 'IAM-TRUST-001',
    awsBehavior: 'A role\'s trust policy must explicitly name the principal (or account/service) allowed to assume it via sts:AssumeRole - by default, a role trusts nobody.',
    reference: 'IAM User Guide - "IAM roles": role trust policies',
    scenario: 'A role has NO trust policy at all; an EC2 instance attempts to assume it.',
    configuration: { trustPolicy: 'none' },
    request: { caller: 'ec2-instance', action: 'sts:AssumeRole' },
    expected: { allowed: false },
    run: () => {
      const role: Principal = { id: 'app-role', kind: 'role', accountId: '111111111111', identityPolicies: [] };
      const caller: Principal = { id: 'ec2-instance', kind: 'service', accountId: '111111111111', identityPolicies: [] };
      return { allowed: assumeRole(caller, role).allowed } as AssumeResult;
    },
    explain: (actual) => !actual.allowed
      ? 'The simulator correctly refuses assumption of a role with no trust policy - trust must be explicitly granted.'
      : 'The simulator allowed a role to be assumed with no trust policy at all - AWS requires an explicit trust relationship.'
  },
  {
    id: 'IAM-TRUST-002',
    awsBehavior: 'A role\'s trust policy naming a specific principal allows exactly that principal (or account) to assume it.',
    reference: 'IAM User Guide - "IAM roles": role trust policies',
    scenario: 'A role\'s trust policy explicitly allows "ec2-instance" to assume it; that exact caller attempts to assume it.',
    configuration: { trustPolicy: 'allows ec2-instance' },
    request: { caller: 'ec2-instance', action: 'sts:AssumeRole' },
    expected: { allowed: true },
    run: () => {
      const trustPolicy: Policy = { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['ec2-instance'] }] };
      const role: Principal = { id: 'app-role', kind: 'role', accountId: '111111111111', trustPolicy, identityPolicies: [] };
      const caller: Principal = { id: 'ec2-instance', kind: 'service', accountId: '111111111111', identityPolicies: [] };
      return { allowed: assumeRole(caller, role).allowed } as AssumeResult;
    },
    explain: (actual) => actual.allowed
      ? 'The simulator correctly allows assumption when the caller is explicitly named in the trust policy.'
      : 'The simulator refused assumption despite the caller being explicitly named in the trust policy.'
  },
  {
    id: 'IAM-TRUST-003',
    awsBehavior: 'A trust policy only trusts the principal(s) it explicitly names - an unrelated caller is still denied, even if OTHER callers are trusted.',
    reference: 'IAM User Guide - "IAM roles": role trust policies',
    scenario: 'A role\'s trust policy allows "ec2-instance"; a DIFFERENT caller ("lambda-function") attempts to assume it.',
    configuration: { trustPolicy: 'allows ec2-instance only' },
    request: { caller: 'lambda-function', action: 'sts:AssumeRole' },
    expected: { allowed: false },
    run: () => {
      const trustPolicy: Policy = { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['ec2-instance'] }] };
      const role: Principal = { id: 'app-role', kind: 'role', accountId: '111111111111', trustPolicy, identityPolicies: [] };
      const caller: Principal = { id: 'lambda-function', kind: 'service', accountId: '111111111111', identityPolicies: [] };
      return { allowed: assumeRole(caller, role).allowed } as AssumeResult;
    },
    explain: (actual) => !actual.allowed
      ? 'The simulator correctly denies assumption to a caller the trust policy never named.'
      : 'The simulator allowed an untrusted caller to assume the role - trust is per-principal, not "anyone but explicitly denied".'
  },
  {
    id: 'IAM-TRUST-004',
    awsBehavior: 'A trust policy\'s wildcard principal "*" trusts any principal/account to assume the role.',
    reference: 'IAM User Guide - "IAM roles": role trust policies (wildcard principal)',
    scenario: 'A role\'s trust policy names "*" as the trusted principal; any caller attempts to assume it.',
    configuration: { trustPolicy: 'allows *' },
    request: { caller: 'anything', action: 'sts:AssumeRole' },
    expected: { allowed: true },
    run: () => {
      const trustPolicy: Policy = { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['*'] }] };
      const role: Principal = { id: 'app-role', kind: 'role', accountId: '111111111111', trustPolicy, identityPolicies: [] };
      const caller: Principal = { id: 'anything', kind: 'service', accountId: '999999999999', identityPolicies: [] };
      return { allowed: assumeRole(caller, role).allowed } as AssumeResult;
    },
    explain: (actual) => actual.allowed
      ? 'The simulator correctly treats a wildcard principal as trusting any caller.'
      : 'The simulator failed to honor a wildcard "*" principal in a trust policy.'
  },
  {
    id: 'IAM-ASSUME-001',
    awsBehavior: 'Assuming a role SWAPS the session\'s effective permissions to the ROLE\'s own identity policies - the caller\'s own permissions (or lack thereof) have no bearing once running as the role.',
    reference: 'IAM User Guide - "IAM roles": using roles for applications on EC2 / temporary credentials',
    scenario: 'A Lambda function (with no permissions of its own) assumes an execution role that grants s3:GetObject; it then attempts s3:GetObject as that role.',
    configuration: { callerPermissions: 'none', rolePermissions: 'Allow s3:GetObject' },
    request: { action: 's3:GetObject' },
    expected: { effect: 'Allow' },
    run: (): AuthResult => {
      const trustPolicy: Policy = { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['lambda-function'] }] };
      const identityPolicies: Policy[] = [{ id: 'exec-role-perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] }];
      const role: Principal = { id: 'lambda-exec-role', kind: 'role', accountId: '111111111111', trustPolicy, identityPolicies };
      const caller: Principal = { id: 'lambda-function', kind: 'service', accountId: '111111111111', identityPolicies: [] };
      const result = assumeRole(caller, role);
      const decision = evaluateAuthorization({ principal: result.sessionPrincipal!, action: 's3:GetObject', resource: { arn: 'arn:aws:s3:::my-bucket/key', accountId: '111111111111' } });
      return { effect: decision.effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly grants access based on the ASSUMED ROLE\'s policies, not the caller\'s own (empty) permissions.'
      : 'The simulator failed to apply the role\'s own identity policies to the assumed session.'
  },
  {
    id: 'IAM-BOUNDARY-001',
    awsBehavior: 'A permissions boundary is a CEILING, not a grant: even if the identity policy allows an action, the boundary must ALSO allow it, or the action is denied.',
    reference: 'IAM User Guide - "Permissions boundaries for IAM entities"',
    scenario: 'A principal\'s identity policy allows s3:DeleteObject, but its permissions boundary only allows s3:GetObject (not Delete).',
    configuration: { identityPolicy: 'Allow s3:DeleteObject', boundary: 'Allow s3:GetObject only' },
    request: { action: 's3:DeleteObject' },
    expected: { effect: 'Deny' },
    run: (): AuthResult => {
      const identityPolicies: Policy[] = [{ id: 'perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:DeleteObject'], resources: ['*'] }] }];
      const permissionsBoundary: Policy = { id: 'boundary', kind: 'boundary', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] };
      const principal: Principal = { id: 'p', kind: 'role', accountId: '111111111111', identityPolicies, permissionsBoundary };
      const decision = evaluateAuthorization({ principal, action: 's3:DeleteObject', resource: { arn: 'arn:aws:s3:::my-bucket/key', accountId: '111111111111' } });
      return { effect: decision.effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly caps the identity policy\'s grant at what the permissions boundary allows.'
      : 'The simulator let the identity policy\'s grant exceed its permissions boundary - a boundary is supposed to be a hard ceiling.'
  },
  {
    id: 'IAM-BOUNDARY-002',
    awsBehavior: 'A permissions boundary can only RESTRICT, never expand, what the identity policy grants - a boundary allowing an action the identity policy never granted still results in denial.',
    reference: 'IAM User Guide - "Permissions boundaries for IAM entities"',
    scenario: 'A principal\'s permissions boundary allows s3:DeleteObject, but its identity policy only grants s3:GetObject.',
    configuration: { identityPolicy: 'Allow s3:GetObject only', boundary: 'Allow s3:DeleteObject' },
    request: { action: 's3:DeleteObject' },
    expected: { effect: 'Deny' },
    run: (): AuthResult => {
      const identityPolicies: Policy[] = [{ id: 'perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] }];
      const permissionsBoundary: Policy = { id: 'boundary', kind: 'boundary', statements: [{ effect: 'Allow', actions: ['s3:DeleteObject'], resources: ['*'] }] };
      const principal: Principal = { id: 'p', kind: 'role', accountId: '111111111111', identityPolicies, permissionsBoundary };
      const decision = evaluateAuthorization({ principal, action: 's3:DeleteObject', resource: { arn: 'arn:aws:s3:::my-bucket/key', accountId: '111111111111' } });
      return { effect: decision.effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly refuses to let the boundary grant something the identity policy never did - a boundary restricts, it never adds permissions.'
      : 'The simulator let the permissions boundary act as an independent grant - boundaries can only narrow, never expand, permissions.'
  },
  {
    id: 'IAM-SCP-001',
    awsBehavior: 'A Service Control Policy (SCP) is an organization-wide ceiling: even if the identity policy allows an action, an applicable SCP must also allow it.',
    reference: 'AWS Organizations User Guide - "Service control policies (SCPs)"',
    scenario: 'A principal\'s identity policy allows ec2:TerminateInstances, but the account\'s attached SCP only allows ec2:DescribeInstances.',
    configuration: { identityPolicy: 'Allow ec2:TerminateInstances', scp: 'Allow ec2:DescribeInstances only' },
    request: { action: 'ec2:TerminateInstances' },
    expected: { effect: 'Deny' },
    run: (): AuthResult => {
      const identityPolicies: Policy[] = [{ id: 'perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['ec2:TerminateInstances'], resources: ['*'] }] }];
      const scp: Policy = { id: 'org-scp', kind: 'scp', statements: [{ effect: 'Allow', actions: ['ec2:DescribeInstances'], resources: ['*'] }] };
      const principal: Principal = { id: 'p', kind: 'role', accountId: '111111111111', identityPolicies };
      const decision = evaluateAuthorization({ principal, action: 'ec2:TerminateInstances', resource: { arn: 'arn:aws:ec2:::instance/i-123', accountId: '111111111111' }, organizationPolicies: [scp] });
      return { effect: decision.effect };
    },
    explain: (actual) => actual.effect === 'Deny'
      ? 'The simulator correctly enforces the SCP as an organization-wide ceiling above the identity policy\'s own grant.'
      : 'The simulator let the identity policy bypass the account\'s Service Control Policy - SCPs apply even when the identity policy already grants the action.'
  },
  {
    id: 'IAM-SCP-002',
    awsBehavior: 'When both the identity policy AND the applicable SCP allow an action, the request is permitted.',
    reference: 'AWS Organizations User Guide - "Service control policies (SCPs)"',
    scenario: 'A principal\'s identity policy allows ec2:DescribeInstances; the account\'s SCP also allows it.',
    configuration: { identityPolicy: 'Allow ec2:DescribeInstances', scp: 'Allow ec2:DescribeInstances' },
    request: { action: 'ec2:DescribeInstances' },
    expected: { effect: 'Allow' },
    run: (): AuthResult => {
      const identityPolicies: Policy[] = [{ id: 'perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['ec2:DescribeInstances'], resources: ['*'] }] }];
      const scp: Policy = { id: 'org-scp', kind: 'scp', statements: [{ effect: 'Allow', actions: ['ec2:DescribeInstances'], resources: ['*'] }] };
      const principal: Principal = { id: 'p', kind: 'role', accountId: '111111111111', identityPolicies };
      const decision = evaluateAuthorization({ principal, action: 'ec2:DescribeInstances', resource: { arn: 'arn:aws:ec2:::instance/i-123', accountId: '111111111111' }, organizationPolicies: [scp] });
      return { effect: decision.effect };
    },
    explain: (actual) => actual.effect === 'Allow'
      ? 'The simulator correctly allows the action when both the identity policy and the SCP agree.'
      : 'The simulator denied an action both the identity policy and the SCP allow.'
  }
];

runConformanceCases(CASES);
