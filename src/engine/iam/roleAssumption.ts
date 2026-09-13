// Role assumption: Principal -> Trust Policy -> AssumeRole -> Temporary role session ->
// Permission policies. Modeled per docs/aws-behavior/IAM_BEHAVIOR.md §8: the resulting session
// principal's effective identity policies are the ROLE's own policies, never the caller's -
// assuming a role SWAPS your effective permissions, it does not add to them.
import { anyActionMatches } from './actionMatch.ts';
import { evaluateCondition } from './conditions.ts';
import type { AuthorizationContext, Policy, Principal } from './types.ts';

export interface AssumeRoleResult {
  allowed: boolean;
  reason: string;
  /** The temporary session principal, present only when `allowed` is true. Its `id` records both
   *  the role and the caller (`RoleId[callerId]`) purely for trace readability - it is a distinct
   *  principal from both the role definition and the original caller. */
  sessionPrincipal?: Principal;
}

const ASSUME_ROLE_ACTION = 'sts:AssumeRole';

function trustPolicyAllows(role: Principal, caller: Principal, context?: AuthorizationContext): { allowed: boolean; reason: string } {
  if (!role.trustPolicy) {
    return { allowed: false, reason: `${role.id} has no trust policy at all - by default, nothing may assume it.` };
  }

  const denyStatement = role.trustPolicy.statements.find(stmt =>
    stmt.effect === 'Deny' &&
    anyActionMatches(stmt.actions, ASSUME_ROLE_ACTION) &&
    (stmt.principals || []).some(p => p === '*' || p === caller.id || p === caller.accountId) &&
    evaluateCondition(stmt.condition, context).satisfied
  );
  if (denyStatement) {
    return { allowed: false, reason: `${role.id}'s trust policy explicitly denies ${caller.id} from assuming this role.` };
  }

  const allowStatement = role.trustPolicy.statements.find(stmt =>
    stmt.effect === 'Allow' &&
    anyActionMatches(stmt.actions, ASSUME_ROLE_ACTION) &&
    (stmt.principals || []).some(p => p === '*' || p === caller.id || p === caller.accountId) &&
    evaluateCondition(stmt.condition, context).satisfied
  );
  if (!allowStatement) {
    return { allowed: false, reason: `${role.id}'s trust policy does not name ${caller.id} (or its account ${caller.accountId}) as a trusted principal for sts:AssumeRole.` };
  }

  return { allowed: true, reason: `${role.id}'s trust policy allows ${caller.id} to assume it.` };
}

/**
 * Attempts to assume `role` as `caller`. On success, the returned session principal carries the
 * ROLE's own identity policies and permissions boundary (never the caller's) - this is the one
 * behavior real AWS is strict about and this task's example diagram (Lambda -> Execution Role ->
 * s3:GetObject) depends on: the Lambda function's own identity has no bearing on what it can do
 * once it is running as its execution role.
 */
export function assumeRole(
  caller: Principal,
  role: Principal,
  opts?: { sessionPolicy?: Policy; context?: AuthorizationContext }
): AssumeRoleResult {
  if (role.kind !== 'role') {
    return { allowed: false, reason: `${role.id} is not an assumable role (kind: ${role.kind}).` };
  }

  const trustCheck = trustPolicyAllows(role, caller, opts?.context);
  if (!trustCheck.allowed) {
    return { allowed: false, reason: trustCheck.reason };
  }

  const sessionPrincipal: Principal = {
    id: `${role.id}[${caller.id}]`,
    kind: 'role',
    accountId: role.accountId,
    identityPolicies: role.identityPolicies,
    permissionsBoundary: role.permissionsBoundary,
    sessionPolicy: opts?.sessionPolicy
  };

  return { allowed: true, reason: trustCheck.reason, sessionPrincipal };
}
