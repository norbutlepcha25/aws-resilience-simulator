/**
 * The Failure Simulation Engine's data model. A `Failure` is an injected fact about the
 * architecture ("this resource/hop is broken this way"), independent of `NodeHealth` -
 * `analyzeFailureImpact` (propagation.ts) is what turns a `Failure` into concrete consequences
 * (which nodes go down, which specific request paths are severed, what survives).
 */

export type FailureType =
  | 'network_failure'
  | 'route_failure'
  | 'nacl_denial'
  | 'security_group_denial'
  | 'iam_denial'
  | 'dns_failure'
  | 'service_unavailable'
  | 'instance_unavailable'
  | 'az_failure'
  | 'nat_failure'
  | 'load_balancer_target_failure'
  | 'database_unavailable'
  | 'dependency_failure'
  | 'configuration_failure';

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical';

/** How the failure came to exist - manual chaos injection vs. a consequence of another failure. */
export type FailureTrigger = 'manual' | 'chaos_experiment' | 'cascade' | 'scheduled';

export type FailureLifecycleState = 'active' | 'resolved';

/**
 * `network_failure`, `route_failure`, `nacl_denial`, `security_group_denial`, `iam_denial`,
 * `dns_failure`, and `nat_failure` sever specific request paths (edges) rather than making a
 * whole node unhealthy - real AWS never takes a resource itself offline because a Security Group
 * rule denies one caller. Everything else fails the target resource's own health.
 */
export const EDGE_BLOCKING_FAILURE_TYPES: readonly FailureType[] = [
  'network_failure',
  'route_failure',
  'nacl_denial',
  'security_group_denial',
  'iam_denial',
  'dns_failure',
  'nat_failure'
];

export function isEdgeBlockingFailureType(type: FailureType): boolean {
  return EDGE_BLOCKING_FAILURE_TYPES.includes(type);
}

export interface Failure {
  id: string;
  /** Node id the failure targets. For `az_failure` this is an `AvailabilityZone` value instead
   *  (e.g. 'AZ-A') - every node whose `data.az` matches is a direct target. */
  targetResourceId: string;
  failureType: FailureType;
  severity: FailureSeverity;
  trigger: FailureTrigger;
  state: FailureLifecycleState;
  triggeredAtMs: number;
  /** Indefinite (until manually resolved) when omitted. */
  durationMs?: number;
  reason?: string;
  /** IAM-denial-specific: the action being denied - narration/testing only, propagation treats
   *  every inbound edge to the target as denied regardless. */
  deniedAction?: string;
  /** Populated by `analyzeFailureImpact`, not by the caller that constructs the `Failure`. */
  affectedDependencies: string[];
}

export type FailureInput = Omit<Failure, 'id' | 'state' | 'triggeredAtMs' | 'affectedDependencies'> & {
  id?: string;
  triggeredAtMs?: number;
};

/** One node's outcome after propagating a `Failure` through the dependency graph. */
export interface DependentImpact {
  nodeId: string;
  survived: boolean;
  /** True when this node only failed as a consequence of another node failing (not the failure's
   *  direct target). */
  cascaded: boolean;
  reason: string;
  redundancyApplied?: string;
}

export interface FailureImpactAnalysis {
  failure: Failure;
  /** Nodes the failure itself directly targets (or, for edge-blocking types, nodes left with no
   *  viable inbound/outbound path at all - see propagation.ts). */
  directlyFailedNodeIds: string[];
  /** Nodes that failed only as a consequence of a direct target failing, with no redundancy. */
  cascadingFailedNodeIds: string[];
  /** Nodes that lost at least one path but retained at least one other (still functioning). */
  degradedNodeIds: string[];
  /** Direct dependents that were checked and found full redundancy - completely unaffected. */
  survivingNodeIds: string[];
  /** Every node touched in any way: directlyFailed + cascadingFailed + degraded. */
  affectedNodeIds: string[];
  /** Specific edges (request paths) severed by an edge-blocking failure type. Empty for
   *  node-health failure types. */
  blockedEdgeIds: string[];
  dependentImpacts: DependentImpact[];
  redundancyNotes: string[];
  summary: string;
}
