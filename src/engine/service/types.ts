// Service Behavior Engine (Phase 7 of docs/target-architecture/MIGRATION_PLAN.md) - see
// SERVICE_ENGINE.md for the original design. A ServiceModel is the "behavioral model instead of
// only catalog metadata" this phase asks for: given a service's live node state, it can validate
// its own configuration, describe what it exposes on the network, gate whether it can send/
// receive a given action, and decide the observable outcome of a request reaching it - all keyed
// by serviceId in `registry.ts`, exactly like the already-proven `costCalculator.ts` pricing-
// module registry and the Phase 5/6 engines.
import type { AvailabilityZone, NodeHealth, SubnetType } from '../../types/index.ts';

/** A minimal, framework-independent snapshot of one service node's live state - deliberately not
 *  `Node<ServiceNodeData>` itself, so this engine can be exercised with hand-built fixtures in
 *  isolation (as the Phase 5/6 engines are), independent of @xyflow/react. */
export interface ServiceNodeSnapshot {
  serviceId: string;
  label: string;
  health: NodeHealth;
  subnet: SubnetType;
  az?: AvailabilityZone;
  replicas?: number;
  multiAz?: boolean;
  securityGroupIds?: string[];
  customConfig?: Record<string, unknown>;
}

export interface ConfigIssue {
  field: string;
  message: string;
}

/** What a service exposes on the network - see docs/target-architecture/NETWORK_ENGINE.md §3.
 *  This is the same shape that document proposed adding to `AWSService`; Phase 7 is the first
 *  place it is actually implemented, per-service, rather than left as a design sketch. */
export interface EndpointCapabilities {
  requiresEni: boolean;
  isIngressProxy: boolean;
  isManagedEventTarget: boolean;
  isVpcEndpoint: 'gateway' | 'interface' | null;
  /** True only for services that select among multiple registered downstream targets by health
   *  (ALB/NLB/API Gateway) - distinct from `isIngressProxy`, which also covers CloudFront (a
   *  valid direct-hit edge target that does NOT perform target-group health-based routing).
   *  Optional/defaults to false-ish so every pre-existing `EndpointCapabilities` literal stays
   *  valid without editing every model file - see UNIFIED_PIPELINE_DEVIATIONS.md §2. */
  performsTargetRouting?: boolean;
}

export interface FailureModeDescriptor {
  id: string;
  description: string;
  detectionSystem: 'elb_health_check' | 'asg_health_check' | 'ecs_scheduler' | 'managed' | 'manual';
}

export type ServiceRequestOutcome =
  | { status: 'success'; detail: string; recoveryApplied?: string }
  | { status: 'failure'; statusCode: number; reason: string };

export interface ServiceRequestInput {
  target: ServiceNodeSnapshot;
  caller?: ServiceNodeSnapshot;
  /** All nodes on the canvas - only needed by the handful of models whose behavior depends on a
   *  sibling node's presence (e.g. an EC2 Auto Scaling Group node existing elsewhere). */
  siblingNodes?: ServiceNodeSnapshot[];
  action: string;
  trafficLevel?: string;
  /** Request path - only consulted by the handful of models whose behavior depends on it
   *  (CloudFront's cache-hit heuristic, WAF's pattern inspection). */
  path?: string;
}

export type ServiceTier = 1 | 2 | 3;

/**
 * One behavioral model per AWS service, resolved by serviceId (`registry.ts`). Adapted from the
 * brief's suggested `AWSServiceModel` shape to what this codebase's data actually supports -
 * `getDependencies`/`getFailureModes` are thin reads of the existing `AWSService` catalog entry
 * (src/data/serviceCatalog.ts), not new data.
 */
export interface ServiceModel {
  id: string;
  tier: ServiceTier;
  description: string;
  validateConfiguration(node: ServiceNodeSnapshot): ConfigIssue[];
  resolveEndpoints(node: ServiceNodeSnapshot): EndpointCapabilities;
  canReceive(node: ServiceNodeSnapshot, action: string): { ok: boolean; reason?: string };
  canSend(node: ServiceNodeSnapshot, action: string): { ok: boolean; reason?: string };
  processRequest(input: ServiceRequestInput): ServiceRequestOutcome;
  getDependencies(): string[];
  getFailureModes(): FailureModeDescriptor[];
}
