// The main authorization pipeline: Authenticate -> resolve identity policies -> resolve resource
// policies -> check explicit denies -> evaluate allows -> evaluate boundaries -> evaluate
// organization restrictions (SCPs) -> evaluate conditions -> final decision. This is exactly the
// stage order given in the Phase 6 task brief - not invented here. Conditions are mechanically
// checked as part of whether a statement matches at all (real AWS evaluates a statement's
// condition together with its action/resource match, not as a separate late gate); the dedicated
// "evaluate-conditions" trace stage below is a summary/confirmation step for explainability, not
// a second independent check - see the comment at that stage.
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationRequest,
  IamTraceStep,
  Policy,
  PolicyStatement,
  StatementMatch
} from './types.ts';
import { anyActionMatches } from './actionMatch.ts';
import { anyResourceMatches } from './resourceMatch.ts';
import { evaluateCondition } from './conditions.ts';

function findMatches(policies: Policy[], effect: 'Allow' | 'Deny', action: string, resourceArn: string, context: AuthorizationContext | undefined): StatementMatch[] {
  const matches: StatementMatch[] = [];
  for (const policy of policies) {
    for (const statement of policy.statements) {
      if (statement.effect !== effect) continue;
      if (!anyActionMatches(statement.actions, action)) continue;
      if (!anyResourceMatches(statement.resources, resourceArn)) continue;
      const condition = evaluateCondition(statement.condition, context);
      matches.push({ policy, statement, conditionSatisfied: condition.satisfied, conditionDetail: condition.detail });
    }
  }
  return matches;
}

function describeStatement(m: StatementMatch): string {
  return `${m.policy.kind} policy "${m.policy.id}" statement ${m.statement.sid ? `"${m.statement.sid}"` : '(unnamed)'}`;
}

export function evaluateAuthorization(request: AuthorizationRequest): AuthorizationDecision {
  const { principal, action, resource, context, organizationPolicies = [] } = request;
  const steps: IamTraceStep[] = [];

  steps.push({
    stage: 'authenticate',
    outcome: 'ok',
    detail: `Principal ${principal.id} (${principal.kind}, account ${principal.accountId}) authenticated.`
  });

  const identityPolicies = principal.identityPolicies || [];
  steps.push({
    stage: 'resolve-identity',
    outcome: 'ok',
    detail: `${identityPolicies.length} identity polic${identityPolicies.length === 1 ? 'y' : 'ies'} attached to ${principal.id}: [${identityPolicies.map(p => p.id).join(', ') || 'none'}].`
  });

  const resourcePolicies: Policy[] = resource.resourcePolicy ? [resource.resourcePolicy] : [];
  steps.push({
    stage: 'resolve-resource',
    outcome: 'ok',
    detail: resource.resourcePolicy
      ? `Resource ${resource.arn} carries resource policy "${resource.resourcePolicy.id}".`
      : `Resource ${resource.arn} has no resource policy attached.`
  });

  const boundaryPolicies: Policy[] = principal.permissionsBoundary ? [principal.permissionsBoundary] : [];
  const sessionPolicies: Policy[] = principal.sessionPolicy ? [principal.sessionPolicy] : [];

  const policiesConsidered = [...identityPolicies, ...resourcePolicies, ...organizationPolicies, ...boundaryPolicies, ...sessionPolicies].map(p => p.id);

  function finalize(effect: 'Allow' | 'Deny', matchedStatements: StatementMatch[], explicitDeny: StatementMatch | null, finalReason: string): AuthorizationDecision {
    steps.push({ stage: 'final', outcome: effect === 'Allow' ? 'allow' : 'deny', detail: finalReason });
    return {
      effect,
      principal: principal.id,
      action,
      resource: resource.arn,
      policiesConsidered,
      matchedStatements,
      explicitDeny,
      finalReason,
      steps
    };
  }

  // Check explicit denies - across every policy type that can carry one (identity, resource,
  // SCP, boundary, session). Explicit deny always wins, at any stage, over any allow.
  const denyCandidates = [
    ...findMatches(identityPolicies, 'Deny', action, resource.arn, context),
    ...findMatches(resourcePolicies, 'Deny', action, resource.arn, context),
    ...findMatches(organizationPolicies, 'Deny', action, resource.arn, context),
    ...findMatches(boundaryPolicies, 'Deny', action, resource.arn, context),
    ...findMatches(sessionPolicies, 'Deny', action, resource.arn, context)
  ];
  const explicitDeny = denyCandidates.find(m => m.conditionSatisfied) || null;

  if (explicitDeny) {
    steps.push({ stage: 'explicit-deny', outcome: 'deny', detail: `${describeStatement(explicitDeny)} explicitly denies ${action} on ${resource.arn}.` });
    return finalize('Deny', [explicitDeny], explicitDeny, `Explicit deny in ${describeStatement(explicitDeny)} - explicit deny always overrides any allow, evaluated at any stage.`);
  }
  steps.push({ stage: 'explicit-deny', outcome: 'none', detail: 'No matching explicit deny statement found in any attached policy.' });

  // Evaluate allows - an identity policy OR a resource policy must grant the action. Neither is
  // required to grant it alone; either is sufficient at this stage (boundary/SCP ceilings, below,
  // can still cut it back down).
  const identityAllows = findMatches(identityPolicies, 'Allow', action, resource.arn, context).filter(m => m.conditionSatisfied);
  const resourceAllows = findMatches(resourcePolicies, 'Allow', action, resource.arn, context).filter(m => m.conditionSatisfied);
  const baseAllows = [...identityAllows, ...resourceAllows];

  if (baseAllows.length === 0) {
    steps.push({ stage: 'evaluate-allow', outcome: 'deny', detail: 'No identity or resource policy allow statement matched this action/resource (or their conditions were not satisfied).' });
    return finalize('Deny', [], null, `Implicit deny: neither ${principal.id}'s identity policies nor ${resource.arn}'s resource policy grant ${action} - AWS denies by default when nothing explicitly allows.`);
  }
  steps.push({ stage: 'evaluate-allow', outcome: 'allow', detail: `${baseAllows.length} allow statement(s) matched: ${baseAllows.map(describeStatement).join('; ')}.` });

  // Evaluate boundaries - a permissions boundary is a ceiling, never a grant: it must ALSO allow
  // the action, independent of whether the identity/resource policy already did.
  if (boundaryPolicies.length > 0) {
    const boundaryAllows = findMatches(boundaryPolicies, 'Allow', action, resource.arn, context).filter(m => m.conditionSatisfied);
    if (boundaryAllows.length === 0) {
      steps.push({ stage: 'evaluate-boundary', outcome: 'deny', detail: `Permissions boundary "${principal.permissionsBoundary!.id}" does not include an allow statement for ${action} on ${resource.arn}.` });
      return finalize('Deny', baseAllows, null, `Implicit deny: permissions boundary "${principal.permissionsBoundary!.id}" caps ${principal.id}'s effective permissions below what the identity/resource policy granted - a boundary can only restrict, never grant.`);
    }
    steps.push({ stage: 'evaluate-boundary', outcome: 'allow', detail: `Permissions boundary "${principal.permissionsBoundary!.id}" also permits this action.` });
  } else {
    steps.push({ stage: 'evaluate-boundary', outcome: 'n/a', detail: `${principal.id} has no permissions boundary attached.` });
  }

  // Evaluate session policy (an active assumed-role session's own inline ceiling) - same logic as
  // a permissions boundary: it can only restrict what the role's identity policies already grant.
  if (sessionPolicies.length > 0) {
    const sessionAllows = findMatches(sessionPolicies, 'Allow', action, resource.arn, context).filter(m => m.conditionSatisfied);
    if (sessionAllows.length === 0) {
      steps.push({ stage: 'evaluate-boundary', outcome: 'deny', detail: `Session policy "${principal.sessionPolicy!.id}" does not include an allow statement for ${action} on ${resource.arn}.` });
      return finalize('Deny', baseAllows, null, `Implicit deny: this session's inline session policy "${principal.sessionPolicy!.id}" does not grant ${action} - a session policy can only restrict the role's permissions, never expand them.`);
    }
  }

  // Evaluate organization restrictions (SCPs) - another ceiling: the account's attached Service
  // Control Policies must also allow the action.
  if (organizationPolicies.length > 0) {
    const scpAllows = findMatches(organizationPolicies, 'Allow', action, resource.arn, context).filter(m => m.conditionSatisfied);
    if (scpAllows.length === 0) {
      steps.push({ stage: 'evaluate-scp', outcome: 'deny', detail: `No attached Service Control Policy includes an allow statement for ${action} on ${resource.arn}.` });
      return finalize('Deny', baseAllows, null, `Implicit deny: ${principal.accountId}'s Service Control Policies do not allow ${action} - an SCP is an organization-wide ceiling that applies even when the identity/resource policy already grants it.`);
    }
    steps.push({ stage: 'evaluate-scp', outcome: 'allow', detail: 'Attached Service Control Polic(y/ies) also permit this action.' });
  } else {
    steps.push({ stage: 'evaluate-scp', outcome: 'n/a', detail: `No Service Control Policy is attached to account ${principal.accountId}.` });
  }

  // Conditions were already checked as part of every match above (real AWS evaluates a
  // statement's Condition block together with its Action/Resource match, not as a trailing gate);
  // this step exists purely to surface that confirmation in the trace, per the requested pipeline
  // shape, and lists the specific condition checks that applied to the deciding allow statement(s).
  const conditionDetail = baseAllows.flatMap(m => m.conditionDetail);
  steps.push({
    stage: 'evaluate-conditions',
    outcome: 'satisfied',
    detail: conditionDetail.length > 0 ? conditionDetail.join(' | ') : 'The deciding allow statement(s) carried no condition block.'
  });

  return finalize('Allow', baseAllows, null, `Allowed: ${describeStatement(baseAllows[0])} grants ${action} on ${resource.arn}, no explicit deny applies, and every attached boundary/session/SCP ceiling also permits it.`);
}
