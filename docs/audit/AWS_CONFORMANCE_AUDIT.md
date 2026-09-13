# AWS_CONFORMANCE_AUDIT.md — Behavioral Conformance Audit

Compares the simulator's actual implementation (`docs/codebase/*`) against the AWS ground-truth specification (`docs/aws-behavior/*`). No code was changed to produce this audit. Every finding in every file under `docs/audit/` carries two independent labels:

- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **Status**: CORRECT / PARTIAL / INCORRECT / MISSING / APPROXIMATION

## Severity rubric (applied consistently across all 7 audit files)

| Severity | Meaning |
|---|---|
| CRITICAL | Produces a wrong pass/fail outcome, a wrong status code a student would memorize incorrectly, or actively conflates two distinct AWS concepts under one name |
| HIGH | A structurally significant AWS behavior (an entire rule category, not one detail) is absent or replaced by a materially different mechanism, on a commonly-exercised path |
| MEDIUM | A real, narrower-scope inaccuracy — wrong timing, an edge case, a rarely-hit path, or a simplification that changes the mechanism but not the observable pass/fail outcome |
| LOW | A deliberate, reasonable teaching simplification, or a gap in a feature this simulator has never claimed to model (e.g., IPv6, Transit Gateway) |

## Status rubric

| Status | Meaning |
|---|---|
| CORRECT | Matches the CONFIRMED AWS rule with no material simplification |
| PARTIAL | The mechanism exists but only covers a subset of the cases real AWS covers, or is only reachable via one specific path/template |
| INCORRECT | The simulator does something that contradicts the CONFIRMED AWS rule (not just simplifies it) |
| MISSING | No implementation exists at all |
| APPROXIMATION | A deliberate, reasonable simplification of a real mechanism, explicitly acceptable for a teaching tool at its current scope |

## 1. Executive summary, by area

| Area | Detail file | Overall conformance | Worst finding |
|---|---|---|---|
| Networking | `NETWORKING_GAPS.md` | Mixed — subnet/CIDR/SG/NACL core mechanics are strong; Route Table, Route, VPC Peering, Transit Gateway are entirely absent as modeled entities | CRITICAL: NACL matcher has no implicit final deny (default-permits unmatched traffic — the opposite of real AWS's default-deny posture) |
| IAM | `IAM_GAPS.md` | Zero implementation across all 10 audited constructs | CRITICAL: an architecture with a publicly-exposed database and a maximally permissive IAM configuration would simulate identically to a well-secured one — IAM has no bearing on any simulated outcome |
| Services | `SERVICE_GAPS.md` | 28/327 catalog services have any simulation participation at all; of those 28, coverage across UI/Config/Validation/Simulation/Failure/IAM/Network axes is uneven | HIGH: IAM support column is MISSING for all 28 services, no exceptions |
| Request simulation | `SIMULATION_GAPS.md` | A single ~850-line function with 30+ serviceId-keyed conditionals, no dispatch abstraction | HIGH: adding one new differentiated service behavior requires editing this one function and manually reasoning about execution order relative to 8 other unrelated behaviors |
| Failure | `FAILURE_GAPS.md` | Real per-node health mutation is solid; "cascading failure" is a fixed slideshow disconnected from canvas state | CRITICAL: the app's headline "Cascading Failure" feature does not simulate anything — it narrates a fixed, canvas-independent story |
| Tests | `TEST_GAPS.md` | 43 tests, all internal-consistency tests; zero tests assert against an AWS-documented fact as the source of truth | HIGH: none of the 5 confirmed AWS-behavior discrepancies (502 vs 503, WAF/Shield conflation, etc.) have a test that would catch a regression or confirm a fix |

## 2. Cross-cutting pattern: three recurring defect classes

Nearly every finding across all 7 files falls into one of these three patterns — worth naming once here since they recur:

1. **"Giant conditional, not a model."** Both `requestSimulator.ts` and `costCalculator.ts` implement service-specific behavior as a flat chain of `if (serviceId === '...')` branches rather than a per-service behavior abstraction. This is why adding IAM, adding Route Tables, or fixing the ALB status code all require touching the same monolithic function rather than one isolated module. See `SIMULATION_GAPS.md`.
2. **"Modeled as a label, not derived from a mechanism."** `public_subnet`/`private_subnet` is a user-chosen boundary type, not something derived from an actual route table's contents (because no Route Table entity exists at all). This is structurally different from real AWS, where "public" is *only* a consequence of route-table configuration. See `NETWORKING_GAPS.md` §Route Table.
3. **"Present in name, absent in behavior."** IAM fields, roles, and policies are referenced nowhere in the codebase at all (not even as inert metadata) — this is a full category absence, not a partial one. Contrast with, e.g., the catalog's `defaultConfig` field (present as data, inert in behavior) — IAM isn't even present as data. See `IAM_GAPS.md`.

## 3. What must change vs. what is an acceptable approximation — top-line calls

**Must change (CRITICAL, independent of effort/cost):**
- NACL matcher's missing implicit final deny (`NETWORKING_GAPS.md` §NACL) — this is a correctness bug, not a scope gap: it makes the simulator MORE permissive than real AWS for any custom-NACL scenario the matcher doesn't have an explicit rule for.
- ALB "no healthy targets" returns 502 instead of AWS's documented 503 (`SIMULATION_GAPS.md`, `SERVICE_GAPS.md`) — a specific, memorizable wrong fact a student could carry into an actual AWS certification exam.
- WAF/Shield conflation (`SERVICE_GAPS.md`) — teaches that Shield does L7 signature inspection, which it does not.

**Acceptable approximation (LOW, do not prioritize):**
- RDS Multi-AZ failover timing (~35s narrated vs. AWS's "typically 60-120s") — the *mechanism* (DNS CNAME repoint to a synchronous standby) is correctly modeled; only a flavor-text number is off.
- No IPv6, Transit Gateway, VPC Peering, EIP idle billing — real AWS features this simulator has never claimed to model, not regressions.
- Cost calculator's flat $5/mo fallback for 299 metadata-only services — reasonable given the simulator's own stated scope (327 catalog entries were never meant to all be behaviorally simulated, only browsable/informative).

**Structural, worth doing regardless of any single bug (HIGH, enables everything else):**
- Extracting `requestSimulator.ts`'s conditional chain into per-service behavior modules (mirrors the `costCalculator.ts` pricing-module registry refactor already completed — see `docs/codebase/ANALYSIS_ENGINE.md` §4) is not itself a behavior fix, but every other fix in this audit becomes safer and more isolated once it exists. See `PRIORITIZED_REFACTOR_PLAN.md` item 1.

## 4. Reading order

1. This file (overview + severity rubric).
2. `NETWORKING_GAPS.md`, `IAM_GAPS.md`, `SERVICE_GAPS.md`, `SIMULATION_GAPS.md`, `FAILURE_GAPS.md` — deep dives, any order.
3. `TEST_GAPS.md` — what would need testing once the above are fixed.
4. `PRIORITIZED_REFACTOR_PLAN.md` — the actionable synthesis of all of the above, ranked.
