// Phase 8: the Unified Request/Flow Simulation Engine. Every hop decision here is resolved
// through the Phase 5 (network), Phase 6 (IAM), and Phase 7 (service) engines - this module
// itself contains ZERO serviceId string-array checks. Where the pre-Phase-8 adapters
// (src/engine/simulation/adapters/) used e.g. `VPC_HOSTED_INGRESS_SERVICE_IDS.includes(id)`,
// this engine asks the destination's own ServiceModel: `resolveEndpoints(node).requiresEni`. See
// docs/aws-behavior/UNIFIED_PIPELINE_DEVIATIONS.md for the verified mapping from each removed
// array to its ServiceModel-driven replacement.
import type { AuthorizationContext, Principal } from '../iam/types.ts';

/** The request model this phase's brief specifies - deliberately loose (`Partial`-friendly):
 *  not every field is required for every request. `source`/`destination` are node ids on the
 *  canvas; when `destination` is omitted, the engine traverses the graph hop-by-hop from
 *  `source` exactly like the pre-Phase-8 engine already does. */
export interface UnifiedRequest {
  source: string;
  destination?: string;
  protocol?: string;
  port?: number;
  action?: string;
  resource?: string;
  payloadMetadata?: Record<string, unknown>;
  principal?: Principal;
  context?: AuthorizationContext;
  method?: string;
  path?: string;
  trafficLevel?: string;
}

export type PipelineResultStatus =
  | 'SUCCESS'
  | 'DENIED' // IAM explicit or implicit deny
  | 'BLOCKED' // NACL or Security Group blocked the packet
  | 'MISCONFIGURED' // structural: bad placement, missing required infrastructure, invalid config
  | 'UNAVAILABLE' // target/service reachable and authorized, but its own runtime state can't serve the request
  | 'TIMEOUT' // egress/return-path packet never arrived (NAT missing, stateless NACL return drop, saturation)
  | 'UNSUPPORTED'; // the graph itself doesn't resolve to a real request (dead end, unknown serviceId)

export interface HopCheck {
  /** One step of the 13-step pipeline this check belongs to. */
  step:
    | 'resolve-source' | 'resolve-destination' | 'resolve-identity' | 'resolve-network-path'
    | 'resolve-routes' | 'evaluate-nacl' | 'evaluate-security-group' | 'evaluate-service-endpoint'
    | 'evaluate-iam' | 'execute-service-behavior' | 'generate-response' | 'evaluate-return-path';
  label: string;
  passed: boolean;
  detail: string;
}

export interface HopTrace {
  nodeId: string;
  label: string;
  serviceId: string;
  checks: HopCheck[];
  outcome: 'passed' | 'failed' | 'terminal';
}

export interface PipelineResult {
  status: PipelineResultStatus;
  reason: string;
  hops: HopTrace[];
  /** Legacy-compatible HTTP-ish status code, used only by the UI-compatibility adapter
   *  (adapter.ts) - the canonical result is `status`, not this. */
  legacyStatusCode: number;
}
