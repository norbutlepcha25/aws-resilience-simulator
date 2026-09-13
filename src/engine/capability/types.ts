/**
 * Phase 14: the Service Capability Registry. This simulator has 327 catalog services
 * (`serviceCatalog.ts`) and deliberately does NOT deeply simulate all of them at once - every
 * service instead gets an honest classification across 7 independent capability flags, derived
 * from what actually exists in the engines today, never from aspiration.
 *
 * Each flag answers one narrow question:
 *
 *  - CONFIGURATION       Does this service resolve to a real config surface (defaultConfig/
 *                        customConfig fields, a `ServiceModel`)? True for every catalog service -
 *                        even the Tier 3 fallback (`genericModel.ts`) gives every service this.
 *  - VALIDATION          Does `validateConfiguration()` actually run for it? Same universal
 *                        baseline as CONFIGURATION - Tier 3's check is minimal, but it is real.
 *  - CONNECTIVITY        Is this serviceId specifically recognized by name in the LIVE
 *                        `runSimulation` adapter pipeline (`engine/simulation/adapters/`) - as
 *                        opposed to falling through to the generic forward-or-terminal path?
 *  - NETWORK_BEHAVIOR    Is it subject to real structural network rules - subnet placement
 *                        (`SUBNET_REQUIRED_SERVICE_IDS`), NAT/IGW attachment, or VPC endpoint
 *                        routing? NOT_APPLICABLE for fully-managed/edge services AWS itself never
 *                        places in a customer subnet (DynamoDB, SQS, Route 53, ...).
 *  - IAM_BEHAVIOR        Does IAM meaningfully govern this service - either as the CALLER (an
 *                        attached role/policy, `IAM_CALLER_SERVICE_IDS`) or as an IAM-authenticated
 *                        API target (`IAM_AUTHENTICATED_ACTIONS`)? NOT_APPLICABLE for services IAM
 *                        genuinely does not gate (e.g. a plain database-credential SQL connection).
 *  - REQUEST_SIMULATION  Does an ACTUAL PASSING TEST demonstrate differentiated request behavior
 *                        for it through the live `runSimulation` engine (not just "doesn't
 *                        crash", and not the standalone/unwired Phase 7-8 engines)?
 *  - FAILURE_SIMULATION  Does an ACTUAL PASSING TEST demonstrate a differentiated failure/recovery
 *                        outcome for it (Multi-AZ failover, cache fallback, target-group failover,
 *                        AZ-scoped blast radius, ...) - not just the fully-generic "any node can be
 *                        marked health: 'failed'" mechanism every service already gets for free?
 *
 * CONFIGURATION and VALIDATION are near-universal by design (the Tier 3 fallback exists
 * specifically to give every service that much). The other five are where services actually
 * differentiate, and REQUEST_SIMULATION/FAILURE_SIMULATION in particular are never set true
 * without a specific, named, currently-passing test as evidence - see `registry.ts`'s `evidence`
 * field on every profile.
 */

export type CapabilityFlag =
  | 'CONFIGURATION'
  | 'VALIDATION'
  | 'CONNECTIVITY'
  | 'NETWORK_BEHAVIOR'
  | 'IAM_BEHAVIOR'
  | 'REQUEST_SIMULATION'
  | 'FAILURE_SIMULATION';

export const CAPABILITY_FLAGS: CapabilityFlag[] = [
  'CONFIGURATION',
  'VALIDATION',
  'CONNECTIVITY',
  'NETWORK_BEHAVIOR',
  'IAM_BEHAVIOR',
  'REQUEST_SIMULATION',
  'FAILURE_SIMULATION'
];

/** `NOT_APPLICABLE` is a distinct, equally-honest third state from `false` - it means "this axis
 *  genuinely does not apply to this service" (e.g. NETWORK_BEHAVIOR for a fully-managed service
 *  with no VPC placement), not "not yet built." Both `false` and `NOT_APPLICABLE` render as "-" in
 *  the spec's own example table; the distinction exists so a future contributor can tell "this is
 *  a real gap to close" apart from "there is nothing to build here." */
export type CapabilityStatus = true | false | 'NOT_APPLICABLE';

/** The two classification bookends this phase names alongside the 7 flags - both DERIVED, never
 *  set directly, from the flags above. */
export type ServiceClassification = 'METADATA_ONLY' | 'PARTIAL' | 'FULL_BEHAVIOR';

export interface ServiceCapabilityProfile {
  serviceId: string;
  name: string;
  category: string;
  flags: Record<CapabilityFlag, CapabilityStatus>;
  /** Why each `true`/`NOT_APPLICABLE` flag is set that way - a source module, a specific test id,
   *  or an AWS-behavior rationale. Every flag that isn't plain `false` has an entry here; a flag
   *  claimed true with no evidence is exactly the failure mode this phase exists to prevent. */
  evidence: Partial<Record<CapabilityFlag, string>>;
  classification: ServiceClassification;
}

/** Derives the classification bookend from the 7 flags: METADATA_ONLY when nothing beyond the
 *  universal Tier 3 baseline is true; FULL_BEHAVIOR only when every flag is true or legitimately
 *  not applicable (never merely "exists in the catalog" - see module doc); PARTIAL otherwise. */
export function classify(flags: Record<CapabilityFlag, CapabilityStatus>): ServiceClassification {
  const values = CAPABILITY_FLAGS.map(f => flags[f]);
  const anyTrue = values.some(v => v === true);
  if (!anyTrue) return 'METADATA_ONLY';
  const allSatisfied = values.every(v => v === true || v === 'NOT_APPLICABLE');
  return allSatisfied ? 'FULL_BEHAVIOR' : 'PARTIAL';
}
