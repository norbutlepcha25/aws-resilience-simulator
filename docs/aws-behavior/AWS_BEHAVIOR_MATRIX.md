# AWS_BEHAVIOR_MATRIX.md

Master flattened table. Every row is a single, independently-testable AWS behavior rule. "Simulator Requirement" states what `docs/codebase/` confirms the simulator currently does (implemented, partially implemented, not implemented, or implemented with a known discrepancy) — this is the column a future conformance test suite should be built from. Full detail and sourcing prose for every row lives in `NETWORKING_BEHAVIOR.md`, `IAM_BEHAVIOR.md`, `SERVICE_BEHAVIOR.md`, and `FAILURE_BEHAVIOR.md`; this file does not introduce new claims.

## Networking

| Component | Behavior | AWS Rule | Source | Simulator Requirement |
|---|---|---|---|---|
| VPC | Default isolation | No connectivity to/from a VPC without an explicit gateway/attachment | CONFIRMED — Amazon VPC User Guide | Implemented conceptually (nodes outside a VPC boundary have no special reachability) |
| VPC | Default SG behavior | New VPC's default SG denies all inbound, allows all outbound + intra-SG | CONFIRMED — Amazon VPC User Guide | Not implemented — simulator has no "default SG" concept, only explicitly-attached/configured SGs |
| Subnet | Public/private definition | "Public" = has a route to an IGW; NOT an inherent subnet property | CONFIRMED — Amazon VPC User Guide, Route tables | Implemented differently: simulator uses a `public_subnet`/`private_subnet` boundary-type label set by the user, not derived from actual route-table contents (no route table entity exists in the simulator at all) |
| Subnet | Reserved addresses | Exactly 5 reserved per subnet, fixed roles/offsets | CONFIRMED — Amazon VPC User Guide, Subnet sizing | Implemented — `cidrAllocator.ts` `getReservedAddresses()` matches exactly |
| Subnet | Minimum size | `/28` minimum | CONFIRMED — Amazon VPC User Guide | Implemented — `MIN_AWS_SUBNET_PREFIX = 28` enforced |
| Subnet | AZ pinning | A subnet belongs to exactly 1 AZ, permanently | CONFIRMED | Implemented — subnets are boundary nodes with a fixed AZ tag |
| Route Table | Route matching | Longest-prefix (most specific) match wins | CONFIRMED — Amazon VPC User Guide | Not implemented — simulator has no route table entity or CIDR-based route matching at all; routing is edge-based (an edge = "this hop is reachable") |
| Route Table | Static vs. propagated priority | Static route wins over propagated route for identical destination | CONFIRMED | Not implemented — no route table entity |
| Route | Blackhole routes | A route whose target no longer exists silently drops matching traffic | CONFIRMED | Not implemented — no route/route table entity |
| Internet Gateway | Attachment cardinality | At most 1 IGW attached per VPC | CONFIRMED | Not directly modeled as a cardinality constraint, but simulator does check for IGW *existence* and *health* before allowing public ingress (`REQUEST_SIMULATOR.md` §5 step 3) |
| Internet Gateway | NAT + route required | Both a route to the IGW AND a public IP on the resource are required; either alone is insufficient | CONFIRMED | Partially implemented — simulator checks IGW existence/health and subnet=public, but does not separately model "does this node have a public IP" as a distinct condition |
| NAT Gateway | Directionality | Outbound-initiated only; cannot accept unsolicited inbound | CONFIRMED — Amazon VPC User Guide | Implemented — simulator only ever routes private→external traffic through NAT, never treats it as an inbound path |
| NAT Gateway | Subnet placement requirement | Must be in a public subnet | CONFIRMED | Implemented — `REQUEST_SIMULATOR.md` Behavior 3 hard-fails a NAT Gateway placed in a private subnet |
| NAT Gateway | AZ scope | AZ-scoped; no automatic cross-AZ failover for a single NAT Gateway | CONFIRMED | Implemented — `spofDetector.ts` flags a single NAT Gateway serving >2 private-subnet-placed nodes as a SPOF |
| Security Group | Statefulness | Inbound-allow auto-permits the return leg outbound, and vice versa | CONFIRMED — Amazon EC2 User Guide | Implemented — simulator's SG check is unidirectional-per-hop by construction (never separately re-checks a return leg against the SG), which is behaviorally consistent with statefulness, though not an explicit modeled "state" |
| Security Group | Attachment model | By explicit reference (`security-group-ids`), independent of geometric/subnet placement | CONFIRMED | Implemented — `getAttachedSecurityGroups()` reads `data.securityGroupIds`, not geometry |
| Security Group | Rule composition across multiple attached groups | Union (allow if ANY attached group permits) | CONFIRMED | Implemented — `networkFirewalls.ts` `checkNetworkFirewalls` unions `configuredGroups` |
| Security Group | No deny capability | Cannot express an explicit deny — allow-list only | CONFIRMED | Implemented — simulator's SG model only ever has `allowedProtocols`, no deny list |
| NACL | Evaluation order | Ascending rule number, first match wins, implicit final deny-all (rule 32767) | CONFIRMED — Amazon VPC User Guide | Partially implemented — custom-NACL matcher sorts by rule number and takes first match, but has **no synthesized implicit final deny**; unmatched traffic is permitted by default (`NETWORKING_CURRENT_STATE.md` §4.1) — a confirmed simplification |
| NACL | Statelessness / ephemeral return ports | Return traffic needs its own explicit inbound rule (commonly for ports 1024-65535); not automatically permitted | CONFIRMED — Amazon VPC User Guide, Network ACLs — Ephemeral ports | Implemented for one specific scenario via `checkCustomNaclReturn`, but only invoked in a post-loop check scoped to the traversed path's compute/DB pair (fixed for path-awareness — see `docs/codebase/REQUEST_SIMULATOR.md` §6) — not a universal per-hop stateless check for every leg of every request |
| NACL | Subnet-level association | Attaches to subnets, never to individual ENIs | CONFIRMED | Implemented — `customNacl`/`naclDenyInbound` live on subnet boundary node data |
| NACL vs SG evaluation order | NACL evaluated before SG for inbound traffic | CONFIRMED | Implemented — `pushFirewallBlockIfAny` checks NACL first, returns early on NACL block before ever checking SG |
| ENI | Subnet/AZ permanence | An ENI is permanently bound to the subnet/AZ it was created in | CONFIRMED | Implemented conceptually — no simulator entity represents moving a node between subnets without recomputing containment fresh |
| Elastic IP | Idle-address billing | AWS charges for an allocated-but-unassociated EIP | CONFIRMED — AWS Pricing | Not implemented — `costCalculator.ts` has no EIP-specific line item at all |
| Gateway VPC Endpoint | Scope | S3 and DynamoDB only | CONFIRMED | Implemented — `s3_gateway_endpoint` catalog id models exactly this scope |
| Gateway VPC Endpoint | Cost | Free (no hourly/per-GB charge) | CONFIRMED | Implemented — `costCalculator.ts` prices `s3_gateway`/`vpc_endpoint` ids at $0.00 (note: see `SERVICE_SYSTEM.md`/`ANALYSIS_ENGINE.md` for the confirmed dead-id spelling mismatch — the catalog's real id is `s3_gateway_endpoint`, not `s3_gateway`) |
| Interface VPC Endpoint (PrivateLink) | ENI-based, billed | Creates ENIs per AZ; hourly + per-GB billing | CONFIRMED | Not priced distinctly in `costCalculator.ts` — falls through to the generic $5/mo fallback, since `privatelink` is not among the 15 priced service families |
| VPC Peering | Non-transitivity | A↔B and B↔C does not enable A↔C | CONFIRMED — Amazon VPC Peering Guide | Not implemented — no peering concept exists in the simulator at all |
| Transit Gateway | Transitive routing | Can enable transitive routing across attached VPCs, unlike Peering | CONFIRMED | Not implemented — no Transit Gateway concept exists in the simulator |
| DNS | Amazon-provided resolver location | Reserved at subnet base + offset 2 | CONFIRMED | Implemented — `getReservedAddresses()` role "Amazon-Provided DNS" at offset 2 |
| IPv4 | Public IPv4 metered billing | Every allocated public IPv4 address is hourly-billed | CONFIRMED — AWS pricing change | Not implemented — `costCalculator.ts` does not price public IPv4 addresses as a distinct line item |
| IPv6 | Fixed subnet size | IPv6 subnets are always exactly `/64` | CONFIRMED | Not implemented — simulator has no IPv6 addressing model at all |
| Availability Zones | Per-account AZ mapping | AWS maps friendly AZ names to physical AZs per-account (not globally identical) | CONFIRMED | Not implemented — simulator's `AZ-A`/`AZ-B`/`AZ-C` tags are abstract labels with no physical-mapping concept, which is a reasonable simplification for a teaching tool |

## IAM

| Component | Behavior | AWS Rule | Source | Simulator Requirement |
|---|---|---|---|---|
| Explicit deny | Precedence | Always overrides any Allow from any policy source | CONFIRMED — IAM User Guide, Policy evaluation logic | Not implemented — simulator has zero IAM/authorization modeling |
| Implicit deny | Default | No matching Allow = deny, by default | CONFIRMED | Not implemented |
| Permissions boundary / Session policy | Composition | Effective permissions = intersection with identity policy, never a union/addition | CONFIRMED | Not implemented |
| SCP | Composition | Ceiling only, never a grant; applies even to the account root user | CONFIRMED — AWS Organizations User Guide | Not implemented |
| Role assumption | Temporary, exclusive scope | Assumed-role permissions replace, not add to, the calling principal's own permissions for the session | CONFIRMED — IAM User Guide | Not implemented |
| Cross-account access | Two mechanisms only | Resource-based policy, or role assumption via trust policy — no third mechanism | CONFIRMED | Not implemented |
| Full evaluation order | 8-step precedence (SCP → resource-deny → identity-deny → boundary → session → resource-allow → identity-allow → default-deny) | CONFIRMED — IAM User Guide | Not implemented; this is the CONFIRMED target for any future IAM feature, per `IAM_BEHAVIOR.md` §15 |

## Services

| Component | Behavior | AWS Rule | Source | Simulator Requirement |
|---|---|---|---|---|
| CloudFront | Cache HIT bypasses origin entirely | On a cache hit, the origin is never contacted; origin health is irrelevant | CONFIRMED — CloudFront Developer Guide | Implemented — `REQUEST_SIMULATOR.md` Behavior 4 `break`s on cache HIT before any origin-reachability logic runs |
| Route 53 | DNS failover is TTL-bounded, not instant | Clients/resolvers keep using a cached answer until TTL expiry | CONFIRMED | Not implemented — `route53` is a behaviorally-referenced id (per `SERVICE_SYSTEM.md`) but the simulator has no DNS-caching/TTL concept |
| AWS WAF | Rule evaluated in priority order, Block short-circuits | CONFIRMED | Implemented (simplified) — one regex stand-in for a managed rule group, not per-rule priority evaluation — an APPROXIMATION flagged in `SERVICE_BEHAVIOR.md` |
| AWS Shield vs WAF | Different attack layers (L3/L4 vs. L7); not interchangeable | CONFIRMED | Not implemented distinctly — simulator conflates `waf`/`shield` behavior (`REQUEST_SIMULATOR.md` Behavior 1), a confirmed discrepancy |
| EC2 | Standalone instance (no ASG) is a documented SPOF pattern | CONFIRMED — AWS Well-Architected Framework | Implemented — `spofDetector.ts` check #1 |
| ECS/Fargate | Replacement performed by the **service scheduler**, not literally an EC2 ASG | CONFIRMED — Amazon ECS Developer Guide | Implemented with a known discrepancy — simulator's ALB narration text (`REQUEST_SIMULATOR.md` Behavior 5) attributes replacement to "the Auto Scaling Group" generically |
| Lambda | VPC config replaces default internet access rather than adding to it | CONFIRMED — AWS Lambda Developer Guide | Not modeled as a distinct state — simulator has no separate "Lambda in VPC vs. not" branch |
| ALB | All-targets-unhealthy status code is 503 | CONFIRMED — Elastic Load Balancing User Guide | Implemented with a known discrepancy — simulator returns 502 for this case (`REQUEST_SIMULATOR.md` Behavior 5) |
| ALB | Health-check-driven routing-away is immediate; target *replacement* is a separate system | CONFIRMED | Implemented — `REQUEST_SIMULATOR.md` Behavior 5 correctly separates "removed from rotation" (ALB) from "replaced" (narrated ASG text) |
| API Gateway | No VPC placement for a standard public API | CONFIRMED | Implemented — `api_gateway` deliberately excluded from `SUBNET_REQUIRED_SERVICE_IDS` in `containment.ts` |
| API Gateway | 29-second hard integration timeout | CONFIRMED | Not implemented — simulator has no per-hop timeout modeling |
| RDS | Single-AZ has no automatic failover | CONFIRMED — Amazon RDS User Guide | Implemented — `REQUEST_SIMULATOR.md` Behavior 6 hard-fails a non-Multi-AZ, non-Aurora DB on health=failed |
| RDS | Multi-AZ failover typically 60-120s | CONFIRMED (typical range, not SLA) | Implemented with a known discrepancy — simulator narrates ~35 seconds, faster than AWS's documented typical range |
| Aurora | Storage replicated across multiple AZs unconditionally | CONFIRMED — Amazon Aurora User Guide | Implemented — `REQUEST_SIMULATOR.md` Behavior 6 treats `serviceId === 'aurora'` as inherently Multi-AZ-capable regardless of its own flag |
| DynamoDB | Multi-AZ replication unconditional for every table | CONFIRMED — Amazon DynamoDB Developer Guide | Implemented — `rulesEngine.ts` treats any DynamoDB presence as satisfying Multi-AZ scoring unconditionally |
| S3 | One Zone-IA is explicitly not AZ-resilient | CONFIRMED — Amazon S3 User Guide | Not implemented — simulator's S3 pricing/behavior model doesn't distinguish storage classes for resilience purposes, only for cost |
| SQS | Enqueue success ≠ eventual processing success | CONFIRMED — Amazon SQS Developer Guide | Implemented — `REQUEST_SIMULATOR.md` Behavior 6 treats a successful enqueue as terminal request success, matching this real decoupling semantic |
| EventBridge | Content-based event pattern matching, not just event-type matching | CONFIRMED — Amazon EventBridge User Guide | Not implemented — simulator's `isManagedEventTrigger` check is a binary edge-protocol-type check (`protocol === 'Event'`), not content-based pattern matching — a confirmed APPROXIMATION |

## Failure / Recovery

| Component | Behavior | AWS Rule | Source | Simulator Requirement |
|---|---|---|---|---|
| Three health-check systems | ELB target health, ASG health, ECS scheduler health are independent systems, not one unified concept | CONFIRMED | Partially implemented — simulator's ALB check and DB Multi-AZ check are separate code paths (structurally consistent with independence) but the narration text sometimes blends ASG/ECS-scheduler language together |
| Cascading failure narrative | The simulator's fixed 4-stage walkthrough is a plausible but non-deterministic, application-architecture-dependent sequence, not a guaranteed AWS behavior chain | APPROXIMATION (per-stage assessment in `FAILURE_BEHAVIOR.md` §3) | Not implemented as a computed simulation at all — confirmed to be a static, canvas-independent slideshow (`docs/codebase/FAILURE_SYSTEM.md`) |
| AZ outage | Removes all resources pinned to that AZ's subnets from availability simultaneously | CONFIRMED | Implemented — `failAvailabilityZone()` sets every node tagged with the given AZ to `health: 'failed'` |
| Region-level failure | Out of current scope (no cross-Region service modeled) | N/A | N/A | Not implemented; not currently in scope |
