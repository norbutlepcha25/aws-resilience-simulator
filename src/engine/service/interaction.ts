// The "request -> resolve service model -> service model handles behavior" pipeline this phase
// asked for, composed with the two engines already built in earlier phases: the Network Engine
// (Phase 5 - NACL/Security Group reachability) and the IAM Engine (Phase 6 - authorization).
// Standalone and deterministic, like both of those engines - not wired into the live
// `runSimulation` traversal (see SERVICE_ENGINE_DEVIATIONS.md §0 for why, consistent with the
// same decision made for Phase 5/6).
import type { Node } from '@xyflow/react';
import { checkNetworkFirewalls } from '../simulation/networkFirewalls.ts';
import { evaluateAuthorization } from '../iam/evaluate.ts';
import type { AuthorizationContext, AuthorizationDecision, Policy, Principal, ResourceRef } from '../iam/types.ts';
import { resolveServiceModel } from './registry.ts';
import type { ServiceNodeSnapshot, ServiceRequestOutcome } from './types.ts';

export interface InteractionAuthorization {
  principal: Principal;
  resource: ResourceRef;
  organizationPolicies?: Policy[];
  context?: AuthorizationContext;
}

export interface InteractionScenario {
  caller: ServiceNodeSnapshot;
  target: ServiceNodeSnapshot;
  action: string;
  protocol: string;
  /** NACL/Security Group boundary nodes to evaluate the caller -> target hop against. Omit
   *  entirely to skip the network layer (an undecorated boundary is indistinguishable from "no
   *  network check configured" anyway - see networkFirewalls.ts's own `NOT_EVALUATED` convention). */
  boundaryNodes?: Node<any>[];
  /** Only needed by models whose processRequest depends on a peer-node list (ALB/NLB target
   *  selection, compute auto-scaling-sibling detection). */
  siblingSnapshots?: ServiceNodeSnapshot[];
  /** Omit entirely to skip the IAM layer - matches how an architecture with no `principalId` set
   *  (docs/target-architecture/DOMAIN_MODEL.md §3) never triggers authorization evaluation. */
  authorization?: InteractionAuthorization;
  trafficLevel?: string;
  path?: string;
}

export type InteractionOutcome = 'success' | 'network_failure' | 'iam_failure' | 'config_failure' | 'service_failure';

export interface InteractionResult {
  outcome: InteractionOutcome;
  reason: string;
  iamDecision?: AuthorizationDecision;
  serviceOutcome?: ServiceRequestOutcome;
}

function toFakeNode(id: string, snapshot: ServiceNodeSnapshot): Node<any> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: snapshot } as unknown as Node<any>;
}

export function simulateInteraction(scenario: InteractionScenario): InteractionResult {
  const targetModel = resolveServiceModel(scenario.target.serviceId);
  const callerModel = resolveServiceModel(scenario.caller.serviceId);

  if (!targetModel) return { outcome: 'config_failure', reason: `No service model (or catalog entry) resolves for target serviceId "${scenario.target.serviceId}".` };
  if (!callerModel) return { outcome: 'config_failure', reason: `No service model (or catalog entry) resolves for caller serviceId "${scenario.caller.serviceId}".` };

  // Stage 1: configuration validation (both ends).
  const configIssues = [...targetModel.validateConfiguration(scenario.target), ...callerModel.validateConfiguration(scenario.caller)];
  if (configIssues.length > 0) {
    return { outcome: 'config_failure', reason: configIssues.map(i => `${i.field}: ${i.message}`).join('; ') };
  }

  // Stage 2: structural send/receive gates.
  const sendCheck = callerModel.canSend(scenario.caller, scenario.action);
  if (!sendCheck.ok) return { outcome: 'config_failure', reason: sendCheck.reason || `${scenario.caller.label} cannot send ${scenario.action}.` };
  const receiveCheck = targetModel.canReceive(scenario.target, scenario.action);
  if (!receiveCheck.ok) return { outcome: 'config_failure', reason: receiveCheck.reason || `${scenario.target.label} cannot receive ${scenario.action}.` };

  // Stage 3: network reachability (Phase 5 - NACL then Security Group, in that order).
  if (scenario.boundaryNodes) {
    const callerNode = toFakeNode('caller', scenario.caller);
    const targetNode = toFakeNode('target', scenario.target);
    const firewall = checkNetworkFirewalls(scenario.protocol, targetNode, scenario.boundaryNodes, callerNode);
    if (firewall.nacl.blocked) return { outcome: 'network_failure', reason: firewall.nacl.note || 'Blocked by Network ACL.' };
    if (firewall.securityGroup.blocked) return { outcome: 'network_failure', reason: firewall.securityGroup.note || 'Blocked by Security Group.' };
  }

  // Stage 4: IAM authorization (Phase 6).
  let iamDecision: AuthorizationDecision | undefined;
  if (scenario.authorization) {
    iamDecision = evaluateAuthorization({
      principal: scenario.authorization.principal,
      action: scenario.action,
      resource: scenario.authorization.resource,
      context: scenario.authorization.context,
      organizationPolicies: scenario.authorization.organizationPolicies
    });
    if (iamDecision.effect === 'Deny') {
      return { outcome: 'iam_failure', reason: iamDecision.finalReason, iamDecision };
    }
  }

  // Stage 5: service behavior (Phase 7) - the target's own ServiceModel decides the outcome.
  const serviceOutcome = targetModel.processRequest({
    target: scenario.target,
    caller: scenario.caller,
    siblingNodes: scenario.siblingSnapshots,
    action: scenario.action,
    trafficLevel: scenario.trafficLevel,
    path: scenario.path
  });

  if (serviceOutcome.status === 'failure') {
    return { outcome: 'service_failure', reason: serviceOutcome.reason, iamDecision, serviceOutcome };
  }

  return { outcome: 'success', reason: serviceOutcome.detail, iamDecision, serviceOutcome };
}
