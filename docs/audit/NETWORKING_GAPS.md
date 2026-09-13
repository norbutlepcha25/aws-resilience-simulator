# NETWORKING_GAPS.md

Deep conformance audit: VPC, CIDR, Subnet, Route Table, Routes, IGW, NAT, Security Groups, NACL, ENI, Endpoints, DNS, AZs. Cross-references `docs/codebase/NETWORKING_CURRENT_STATE.md` (simulator) and `docs/aws-behavior/NETWORKING_BEHAVIOR.md` (AWS ground truth).

---

## VPC

1. **What simulator does**: a `boundaryType: 'vpc'` node with a CIDR string on `data.cidr`; contains subnets geometrically; no default SG/NACL auto-created; no attachment/gateway registry.
2. **What AWS does**: a regional isolation boundary; auto-creates a default SG (deny-all-inbound) and default NACL (allow-all) on creation; requires explicit gateways for any external connectivity.
3. **Match?**: partial — the isolation concept and CIDR ownership match; the auto-created-defaults behavior does not exist.
4. **Missing**: default SG/NACL auto-provisioning; secondary CIDR blocks; DNS support/hostnames toggles.
5. **Incorrect**: nothing actively wrong — everything missing is an omission, not a contradiction.
6. **Acceptable approximation**: yes — a teaching tool where every subnet's firewall behavior is explicitly configured (or explicitly absent = `NOT_EVALUATED`, per `docs/codebase/NETWORKING_CURRENT_STATE.md` §4) rather than defaulting to AWS's real default-SG/default-NACL starting point is a reasonable simplification, since the simulator's "no rules configured = not evaluated, nothing blocks" stance and AWS's real "default SG denies all inbound" stance actually point in *opposite* directions — this is worth flagging precisely because it's the one place the simplification changes the default outcome (see NACL section below for the sharper version of this same issue).
7. **Must change**: nothing urgent structurally; the sharper, must-fix version of this same gap is under NACL below.

**Severity: LOW | Status: APPROXIMATION** (the VPC entity itself; see NACL for the CRITICAL version of the same underlying gap)

---

## CIDR

1. **What simulator does**: `cidrAllocator.ts` parses a VPC CIDR, splits it into the smallest power-of-two count of equal blocks across contained subnets (ordered public-then-private, then position), refuses splits requiring smaller than `/28`, computes the 5 AWS-reserved addresses and usable host count per subnet.
2. **What AWS does**: identical reserved-address model (5 addresses, same roles/offsets) and identical `/28` minimum; but real AWS does **not** auto-split a VPC CIDR evenly across subnets — a human (or IaC template) assigns each subnet's CIDR manually, and subnets are very commonly *not* equal-sized in real deployments.
3. **Match?**: the arithmetic (reserved addresses, minimum size, usable-host math) matches exactly; the *allocation strategy* (auto-even-split) is a simulator-only convention, not real AWS behavior.
4. **Missing**: manual/unequal CIDR assignment; VPC secondary CIDR blocks; IPv6 CIDR.
5. **Incorrect**: nothing — the auto-split is a designed simplification, not a misrepresentation of a specific AWS rule (AWS doesn't do *any* particular default split, so there's no contradicted rule here).
6. **Acceptable approximation**: yes, explicitly labeled as such in `docs/codebase/NETWORKING_CURRENT_STATE.md` §3 ("intentional simplification for teaching purposes").
7. **Must change**: nothing.

**Severity: LOW | Status: APPROXIMATION**

---

## Subnet

1. **What simulator does**: a `boundaryType: 'public_subnet' | 'private_subnet'` node the user explicitly labels; a service node's `subnet` field is derived from live geometric containment against these boundary nodes (`deriveSubnetForNode`), never trusted as manually-set.
2. **What AWS does**: "public" is **exclusively** a consequence of the subnet's associated route table containing an IGW route — it is never a label a user sets directly on the subnet resource itself; there is no `subnet.type` attribute in the real EC2/VPC API at all.
3. **Match?**: **no** — this is a structural mismatch, not a detail. The simulator treats public/private as a **user-declared property of the subnet**; real AWS treats it as a **derived consequence of route-table contents**, which do not exist as a simulator entity at all.
4. **Missing**: the Route Table entity that would make "public" a computed fact rather than a label.
5. **Incorrect**: a user could label a subnet `public_subnet` in this simulator with no IGW anywhere on the canvas — the simulator's own 7A check (`docs/codebase/REQUEST_SIMULATOR.md` §5) does catch *this specific* inconsistency at simulation time (no IGW = 504 fail), which somewhat compensates for the missing Route Table entity for the one behavior that depends on it, but the subnet's *label* itself remains user-assertable and never independently re-derived from routing the way AWS derives it.
6. **Acceptable approximation**: the geometric-containment-is-truth design (`docs/codebase/NETWORKING_CURRENT_STATE.md` §1) is a strong, well-reasoned choice for *placement* (which subnet a resource sits in). Using a user-set label instead of route-table derivation for *public/private classification specifically* is the part that diverges from AWS's actual mechanism, even though the simulator's IGW-existence check (7A) catches the most common resulting error.
7. **Must change**: for full conformance, "public" should be computed from an actual Route Table entity's contents (see Route Table finding below) rather than being a label — this is a bigger structural change, not a quick fix, and is the shared root cause of the Route Table/Route findings below.

**Severity: HIGH | Status: PARTIAL** (reserved-address/CIDR/minimum-size math is CORRECT; public/private classification mechanism is a structural divergence, mitigated but not eliminated by the IGW-existence check)

---

## Route Table

1. **What simulator does**: **does not exist as an entity at all.** No node type, no data field, nothing in `containment.ts` or `requestSimulator.ts` represents a route table.
2. **What AWS does**: the single authoritative mechanism determining reachability for every subnet — longest-prefix-match route selection, static-over-propagated priority, blackhole routes on deleted targets.
3. **Match?**: no.
4. **Missing**: the entire entity.
5. **Incorrect**: n/a — nothing claims to model this, so nothing is wrong, only absent.
6. **Acceptable approximation**: **partially** — the simulator's IGW-existence-and-health check (`docs/codebase/REQUEST_SIMULATOR.md` §5 step 3) and the NAT-Gateway-placement check (Behavior 3) both hand-roll the *specific, most pedagogically important* consequences of route-table configuration (is there a path to the internet; is NAT correctly placed) without the underlying entity. This covers the two most commonly-taught scenarios well, but leaves an entire category (route matching, longest-prefix-match, blackhole routes, VPC Peering/Transit Gateway routing) completely unaddressable without the entity existing.
7. **Must change**: this is a scope decision, not a quick fix. If the simulator's ambitions include VPC Peering, Transit Gateway, or teaching route-table mechanics directly (as opposed to only their downstream consequences), a Route Table entity is a prerequisite. If the scope stays "IGW/NAT placement consequences only," the current hand-rolled checks are a reasonable stand-in.

**Severity: HIGH | Status: MISSING** (as an entity); the specific consequences most commonly taught are separately covered elsewhere at PARTIAL/APPROXIMATION level

---

## Routes

1. **What simulator does**: n/a — no Route entity, no CIDR-destination matching anywhere in the simulation loop. Reachability between two service nodes is instead determined by the presence of a drawn **edge** between them plus the 7A/7B/7C structural checks.
2. **What AWS does**: longest-prefix match per packet against the subnet's route table; static beats propagated for identical destinations; unreachable/deleted targets blackhole silently.
3. **Match?**: no — the simulator's edge-based reachability model ("this hop exists because a line was drawn") is a fundamentally different mechanism from AWS's CIDR-destination-matching model.
4. **Missing**: everything — no CIDR matching, no route priority, no blackhole concept.
5. **Incorrect**: n/a.
6. **Acceptable approximation**: **yes, for this simulator's current pedagogical scope** — the app teaches "which resources can reach which other resources and under what gating conditions" (subnet placement, firewall rules, IGW/NAT presence), not "how does a router pick among multiple candidate routes." A user drawing an edge to represent "these two things are meant to talk" is arguably a more approachable teaching abstraction than requiring students to author CIDR-based routes for a request-tracing tool. This is a legitimate design choice, not an oversight, provided it is not marketed as teaching real route-table mechanics.
7. **Must change**: nothing, **unless** a future goal is explicitly to teach route-table/CIDR-matching mechanics — then this is the same prerequisite as Route Table above.

**Severity: MEDIUM | Status: MISSING** (as a modeled AWS concept); the app's edge-based substitute is a reasonable design choice for its current scope, hence not CRITICAL

---

## Internet Gateway (IGW)

1. **What simulator does**: checks IGW *existence anywhere on the canvas* and its `health` before allowing traffic to a public-subnet-placed, ingress-capable target from a public origin (`docs/codebase/REQUEST_SIMULATOR.md` §5 step 3). No attachment-cardinality check (a canvas could have 2 IGWs; simulator doesn't care), no route-table-based derivation of the "has a route to the IGW" fact (see Subnet/Route Table above — it substitutes "does an IGW node exist and is it healthy" for "does the actual route table contain an IGW route").
2. **What AWS does**: at most 1 IGW attached per VPC; a subnet is only reachable via the IGW if its route table has an explicit route to it, AND the target resource has a public IP.
3. **Match?**: partial — the *existence-and-health* gating is a reasonable proxy for "is there a working path to the internet," and produces the correct fail-fast behavior (504, "No Internet Gateway Attached") for the most common classroom mistake (forgetting the IGW entirely). It does not check attachment cardinality, does not verify an actual route exists (it can't — no Route Table entity), and does not separately verify the target has a public IP (assumes any node correctly placed in a `public_subnet` boundary has one).
4. **Missing**: cardinality check; explicit public-IP-on-resource as a distinct condition from subnet-labeled-public.
5. **Incorrect**: nothing contradicts a CONFIRMED AWS rule; the substitutions are reasonable stand-ins given the missing Route Table entity.
6. **Acceptable approximation**: yes.
7. **Must change**: nothing urgent.

**Severity: LOW | Status: APPROXIMATION**

---

## NAT Gateway

1. **What simulator does**: fails if placed in a private subnet (`subnet !== 'public'`); fails if no NAT Gateway node exists anywhere and a private-subnet resource needs external egress; fails if the NAT Gateway's `health === 'failed'`; otherwise emits a correct SNAT narration. `spofDetector.ts` separately flags a single NAT Gateway serving >2 private-subnet-placed nodes as a Single Point of Failure.
2. **What AWS does**: NAT Gateway must be in a public subnet; is outbound-initiation-only (no inbound NAT); is AZ-scoped with no automatic cross-AZ failover for a single instance.
3. **Match?**: strong match on placement rule, directionality (simulator never treats NAT as an inbound path), and the AZ-scoped-SPOF risk (correctly flagged by `spofDetector.ts`).
4. **Missing**: no per-connection quota modeling (55,000 connections/destination) — reasonable to omit, not a commonly-taught failure mode at this level.
5. **Incorrect**: nothing.
6. **Acceptable approximation**: yes, across the board.
7. **Must change**: nothing.

**Severity: LOW | Status: CORRECT** (for the rules it actually models; connection-quota omission is an acceptable, unadvertised scope gap)

---

## Security Groups

1. **What simulator does**: explicit attachment by `securityGroupIds` reference (not geometry); rules across multiple attached groups are **unioned** (allow if any group permits); a group only participates if `allowedProtocols` is explicitly set (an attached-but-unconfigured group is `NOT_EVALUATED`, treated as not blocking); no explicit deny concept exists in the model at all (matches AWS, which also has no SG deny).
2. **What AWS does**: stateful (return traffic auto-permitted); explicit-reference attachment; union across multiple attached groups; allow-list-only, no deny.
3. **Match?**: **strong match** on attachment model, union-across-groups, and allow-only semantics.
4. **Missing**: no explicit outbound/egress rule modeling distinct from inbound (the simulator only ever evaluates one direction per hop, which is directionally consistent with statefulness making a separate outbound check for the return leg unnecessary, but the simulator also never checks an *originating* outbound rule set for the forward leg either — see finding below).
5. **Incorrect**: nothing.
6. **Acceptable approximation**: the "no egress rule check at all, only ingress at the target" model is a reasonable simplification **precisely because** SGs are stateful and this app never simulates a scenario where an SG's own egress rules would matter (e.g., a locked-down egress-restricted SG blocking outbound to a specific destination) — a real gap in coverage, but not a misrepresentation, since nothing the simulator does contradicts statefulness.
7. **Must change**: nothing urgent; if the app later wants to teach egress-restricted SGs specifically, that's new scope, not a bug fix.

**Severity: LOW | Status: CORRECT** (for the scenarios it claims to model; egress-rule scenarios are an unadvertised scope gap, not an error)

---

## NACL

1. **What simulator does** (`networkFirewalls.ts`, per `docs/codebase/NETWORKING_CURRENT_STATE.md` §4.1): two paths. **Custom-NACL path**: sorts rules by ascending rule number, takes the first matching rule for the protocol; if the protocol matches a rule, that rule's action (ALLOW/DENY) applies; **if no rule matches at all, traffic is permitted** ("evaluated ... permitted: no matching rule"). **Legacy path** (`naclDenyInbound`): a flat deny-list of protocol strings.
2. **What AWS does**: ascending rule-number, first-match evaluation — **identical so far** — but every real NACL has an immutable, non-removable final rule (number 32767) that explicitly **DENIES everything not matched by an earlier rule**. Unmatched traffic is **always denied** in real AWS, never permitted by default.
3. **Match?**: **no — this is a direct, confirmed contradiction of a CONFIRMED AWS rule, not a simplification of an undocumented detail.** The simulator's custom-NACL matcher does the *opposite* of AWS's documented default posture: AWS defaults to deny-unmatched, the simulator defaults to allow-unmatched.
4. **Missing**: the synthesized implicit final-deny rule.
5. **Incorrect**: **yes, explicitly** — a custom NACL configured in this simulator with (say) only an ALLOW rule for HTTP and nothing else will **permit** an unrelated SQL request to the same subnet, whereas a real AWS NACL configured the same way would **block** that same SQL request via its implicit final deny. This is the single most consequential finding in this entire networking audit: it means any custom-NACL scenario a template author builds is *more permissive than real AWS* for every protocol the author didn't think to add an explicit rule for.
6. **Acceptable approximation**: **no** — this is not a scope gap or a reasonable simplification; it inverts a security-relevant default. A teaching tool inverting "NACLs are deny-by-default" into "this simulator's custom NACLs are allow-by-default" is actively counter-pedagogical for the exact concept (NACLs) this scenario type exists to teach.
7. **Must change**: **yes.** Add a synthesized final rule — after no explicit rule matches, treat the result as `blocked: true` (a deny), exactly mirroring AWS's rule 32767 — to `checkNetworkFirewalls`'s custom-NACL branch in `networkFirewalls.ts`. This is a small, isolated, testable fix (see `PRIORITIZED_REFACTOR_PLAN.md` item 2 for the concrete plan).

**Severity: CRITICAL | Status: INCORRECT**

Separately: the **stateless-return check** (`checkCustomNaclReturn`) correctly models the ephemeral-port-return concept for the one scenario it's wired into, and evaluation order (NACL before Security Group) is correctly implemented in `pushFirewallBlockIfAny`. Both of these sub-behaviors are CORRECT; the implicit-deny gap above is isolated to the primary protocol-matching path.

---

## ENI

1. **What simulator does**: no distinct ENI entity; a service node's position/geometry stands in for "this resource's ENI is in this subnet." Security Groups attach to the service node's `data.securityGroupIds` directly (conceptually, "the node's ENI"), not to a separate ENI object.
2. **What AWS does**: every VPC-hosted resource with network reachability has one or more actual ENI objects; multi-ENI/multi-subnet-within-one-AZ instances are possible.
3. **Match?**: the simulator's node-as-ENI-proxy simplification is reasonable for a diagramming tool where a "service" is the unit of interest, not its individual network interfaces.
4. **Missing**: multi-ENI-per-instance scenarios (dual-homed instances); this is a narrow, rarely-taught scenario at the introductory level this app targets.
5. **Incorrect**: nothing.
6. **Acceptable approximation**: yes.
7. **Must change**: nothing.

**Severity: LOW | Status: APPROXIMATION**

---

## Endpoints (Gateway & Interface VPC Endpoints)

1. **What simulator does**: `s3_gateway_endpoint` explicitly modeled (Behavior 6B / 7C in `requestSimulator.ts`) as a private-backbone route for S3/DynamoDB, correctly bypassing NAT Gateway; `privatelink` modeled as a generic Interface-Endpoint-equivalent hop. **Neither hop runs a firewall check** (`pushFirewallBlockIfAny` is not called on these two code paths — confirmed gap, `docs/codebase/REQUEST_SIMULATOR.md` §8).
2. **What AWS does**: Gateway Endpoints are free, route-table-based, S3/DynamoDB-only, no ENI; Interface Endpoints are ENI-based (billed, subject to Security Groups); both support an optional endpoint policy as an additional authorization layer.
3. **Match?**: the conceptual distinction (free/route-based vs. billed/ENI-based) is correctly reflected in `costCalculator.ts`'s $0.00 pricing for the gateway-endpoint ids, though `privatelink` (the Interface Endpoint stand-in) isn't priced as a distinct line item at all (falls to the generic $5/mo fallback — see `SERVICE_GAPS.md`).
4. **Missing**: endpoint policies (the additional authorization layer) are not modeled at all — consistent with the simulator's total absence of IAM/resource-policy modeling generally (see `IAM_GAPS.md`); Interface Endpoint Security-Group-based access control is not modeled (an Interface Endpoint's own Security Group isn't checked the way a real PrivateLink endpoint's would be).
5. **Incorrect**: nothing contradicts a CONFIRMED rule.
6. **Acceptable approximation**: mostly — except the missing firewall check on these two hop types, which is a genuine, confirmed gap (traffic through a VPC endpoint should still be subject to whatever Security Group is attached to the endpoint's own ENIs for an Interface Endpoint specifically; the simulator currently can never block this path regardless of configuration).
7. **Must change**: add `pushFirewallBlockIfAny` calls to the VPC-endpoint and managed-event-trigger hops (already identified as a gap in `docs/codebase/REQUEST_SIMULATOR.md` §8, now confirmed against AWS ground truth as a real, not just internally-inconsistent, gap for the Interface Endpoint case specifically).

**Severity: MEDIUM | Status: PARTIAL**

---

## DNS

1. **What simulator does**: reserves the correct offset (+2) for the Amazon-provided DNS server in every subnet's CIDR math; `route53` is behaviorally referenced as a valid ingress-origin service id, but **no TTL/caching/DNS-resolution-delay concept exists anywhere** in the simulation loop.
2. **What AWS does**: DNS resolution precedes every connection; Route 53 failover routing policy changes are bounded below by record TTL, not instantaneous; RDS Multi-AZ failover itself relies on a DNS CNAME repoint.
3. **Match?**: the reserved-address fact matches exactly; the *behavioral* role of DNS (resolution step, TTL-bounded propagation) is entirely unmodeled.
4. **Missing**: DNS resolution as a distinct step in the request trace; TTL-bounded failover delay for Route 53 or RDS Multi-AZ (the RDS Multi-AZ failover is modeled as instantaneous within one simulated "hop," when in reality the DNS CNAME repoint + client-side caching is part of why real failover isn't instant).
5. **Incorrect**: nothing directly contradicts a CONFIRMED rule (the simulator doesn't claim DNS is instant, it simply doesn't model DNS as a distinct concern at all).
6. **Acceptable approximation**: yes, for a request-tracing tool operating at the level of "does the request reach the destination," modeling every DNS-resolution step explicitly would add complexity disproportionate to its current teaching value — this is a legitimate scope boundary.
7. **Must change**: nothing urgent.

**Severity: LOW | Status: MISSING** (as a modeled concept, but a defensible scope boundary, not a defect)

---

## Availability Zones (AZs)

1. **What simulator does**: an abstract `AZ-A`/`AZ-B`/`AZ-C` tag on nodes; `failAvailabilityZone(az)` fails every node sharing that tag simultaneously; `rulesEngine.ts`/`spofDetector.ts` reward/penalize AZ spread.
2. **What AWS does**: AZs are physically independent facilities with a per-account friendly-name-to-physical-AZ mapping; an AZ can fail independently of others in the same Region.
3. **Match?**: the *simultaneous-failure-of-everything-tagged-with-this-AZ* mechanic correctly captures the pedagogically important consequence (co-locating resources in one AZ is a correlated-failure risk) without needing to model the physical-mapping obfuscation detail, which has no bearing on architectural decision-making anyway.
4. **Missing**: nothing pedagogically important.
5. **Incorrect**: nothing.
6. **Acceptable approximation**: yes.
7. **Must change**: nothing.

**Severity: LOW | Status: APPROXIMATION**

---

## Summary table

| Component | Severity | Status |
|---|---|---|
| VPC | LOW | APPROXIMATION |
| CIDR | LOW | APPROXIMATION |
| Subnet (public/private classification) | HIGH | PARTIAL |
| Route Table | HIGH | MISSING |
| Routes | MEDIUM | MISSING (defensible scope choice) |
| Internet Gateway | LOW | APPROXIMATION |
| NAT Gateway | LOW | CORRECT |
| Security Groups | LOW | CORRECT |
| **NACL (implicit deny)** | **CRITICAL** | **INCORRECT** |
| ENI | LOW | APPROXIMATION |
| Endpoints (firewall-check gap) | MEDIUM | PARTIAL |
| DNS | LOW | MISSING (defensible scope choice) |
| Availability Zones | LOW | APPROXIMATION |
