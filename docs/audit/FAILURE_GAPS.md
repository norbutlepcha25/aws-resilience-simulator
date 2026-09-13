# FAILURE_GAPS.md

Compares the app's Failure Lab (`docs/codebase/FAILURE_SYSTEM.md`) against real AWS failure/recovery mechanics (`docs/aws-behavior/FAILURE_BEHAVIOR.md`).

## 1. "Cascading Failure Walkthrough" is not a simulation

1. **What simulator does**: `CASCADING_FAILURE_STAGES` (`src/engine/failure/cascadingFailure.ts`) is a fixed 4-stage narrative (RDS slow query → ECS thread-pool exhaustion → ALB health-check collapse → client retry storm), rendered by `FailureControls.tsx` as a click-through slideshow. It reads no canvas state (`nodes`/`edges` are never referenced by this feature) and writes none.
2. **What AWS does**: no single AWS API produces this narrative — this is a general distributed-systems failure pattern, not an AWS product feature; the correct comparison is "does this simulator compute a plausible cascading-failure narrative *for the user's own architecture*," which is presumably the feature's intent given its name and its placement inside a "Failure Lab" that is otherwise about the user's own canvas.
3. **Match?**: no — the feature's name and surrounding UI context ("Fault Simulation," alongside real, canvas-connected AZ-outage buttons) strongly implies it reflects the user's own architecture; it does not, for any architecture.
4. **Missing**: any connection between this narrative and the actual nodes/edges on canvas — e.g., citing the user's *actual* database/compute/load-balancer node names, or varying its stages based on what redundancy the user's architecture actually has (an architecture with Multi-AZ RDS and 2 ALB targets should not produce the same cascading-failure story as a single-instance, single-AZ one).
5. **Incorrect**: not incorrect in content (per `docs/aws-behavior/FAILURE_BEHAVIOR.md` §3, each stage is individually a plausible, reasonably-documented failure pattern) — the defect is that it is presented as if computed, when it is fixed.
6. **Acceptable approximation**: no — this is the single feature in the entire app most directly named after the thing it fails to do. A generic "here's an educational story about how outages cascade in poorly-architected systems" framing would be an acceptable teaching aid; framed as part of "Fault Simulation" for the user's own diagram, it is not.
7. **Must change**: either (a) compute the narrative from the actual canvas (identify the user's actual DB/compute/LB nodes and whether they have the redundancy that would prevent each stage), or (b) reframe the UI copy to make clear this is a fixed illustrative case study unconnected to the canvas, not a simulation of it. (a) is the correct fix if this feature's intent is what its placement implies; (b) is the minimal honest fix if scope/effort don't support (a) soon.

**Severity: CRITICAL | Status: MISSING** (as a simulation; the narrative content itself is a separate, lower-severity APPROXIMATION finding — see `docs/aws-behavior/FAILURE_BEHAVIOR.md` §3 for the per-stage assessment)

## 2. `RedundancyExperimentModal` is fully disconnected from canvas state

1. **What simulator does**: imports `useArchitecture` but never calls it (confirmed dead import); all state is one local `useState(false)` boolean (`ecs1Failed`) toggled by a single button; the modal's "before/after" comparison copy is fixed text, not derived from the user's actual node/replica counts.
2. **What AWS does**: n/a — this is a UI/pedagogy gap, not an AWS-behavior gap.
3. **Match?**: no — same category of problem as finding 1: a feature titled "Redundancy Resilience Experiment" that does not experiment on anything the user built.
4. **Missing**: any read of `nodes`/`edges`, any real replica-count check, any connection to `runSimulation`.
5. **Incorrect**: the modal's copy claims to compare "a Single-Instance architecture against a Multi-Instance redundant architecture" — for a fixed, hypothetical architecture, not the user's own, despite opening from within the same app where the user has just built one.
6. **Acceptable approximation**: no, for the same reason as finding 1.
7. **Must change**: wire the toggle to actually call `runScenario`/`runSimulation` against a real (or real-derived) node set with the toggled node's health flipped, and show the actual resulting `SimulationResult`, rather than fixed copy.

**Severity: HIGH | Status: MISSING** (slightly below finding 1 because this is a secondary/supplementary modal, not the primary "Fault Simulation" toolbar feature)

## 3. Real, canvas-connected failure mechanics are solid

`setNodeHealth`, `toggleNodeFailure`, `failAvailabilityZone`, `restoreAllNodes` (`ArchitectureContext.tsx`) are real, flat, canvas-connected mutations, and `requestSimulator.ts` genuinely reads the resulting `health` field to gate 6 of the 28 services' distinct failure paths (`SERVICE_GAPS.md` finding). `failAvailabilityZone`'s flat "set every node tagged with this AZ to failed" is an appropriate, correct implementation of the real AWS fact that an AZ outage affects every resource pinned to that AZ's subnets simultaneously (`docs/aws-behavior/NETWORKING_BEHAVIOR.md` §17) — no propagation algorithm is needed for this specific mechanic, a flat filter-and-set is the right shape, not a shortcut.

**Severity: N/A | Status: CORRECT**

## 4. Health-check-system conflation in narration text

Cross-referenced from `SERVICE_GAPS.md`/`SIMULATION_GAPS.md`: the ALB target-health explanation text sometimes attributes replacement of a failed target to "the Auto Scaling Group" regardless of whether the actual compute type is EC2 (real ASG), ECS/Fargate (real ECS service scheduler, a different system), or Lambda (neither applies — Lambda has no persistent instance to replace at all). Per `docs/aws-behavior/FAILURE_BEHAVIOR.md` §1, these are 3 independently-documented AWS systems; blending their narration is a specific, fixable inaccuracy, not a structural gap.

**Severity: MEDIUM | Status: INCORRECT**

## 5. RDS/Aurora failover timing

Already fully covered in `NETWORKING_GAPS.md`/`SERVICE_GAPS.md`/`docs/aws-behavior/SERVICE_BEHAVIOR.md` — restated here only for completeness of this file's scope: simulator narrates ~35s, AWS documents "typically 60-120s" for standard RDS Multi-AZ (Aurora's reader-promotion path is genuinely faster and less precisely documented).

**Severity: LOW | Status: APPROXIMATION**

## 6. SPOF detection is a curated checklist, not a computed dependency-failure model

Cross-referenced from `docs/codebase/ANALYSIS_ENGINE.md` §2 — `spofDetector.ts` implements exactly 4 hand-picked structural patterns (single EC2/ECS instance, non-Multi-AZ RDS, direct client→compute edge, single NAT Gateway with >2 private-subnet nodes), not a general graph-traversal "what happens if this node fails" analysis. This is an ANALYSIS-time (static) feature, not a FAILURE-time (dynamic) one, so it's listed here only as a boundary note: a user cannot ask "if I fail node X, what SPOFs does that reveal that weren't visible before" — SPOF detection and failure injection are two entirely separate, non-interacting systems in this app, consistent with `docs/codebase/ARCHITECTURE.md` §3's finding that Analysis and Failure share no data-flow edge in either direction.

**Severity: LOW | Status: APPROXIMATION** (a legitimate scope boundary between two independently-useful features, not a defect in either one)

## Summary

| Finding | Severity | Status |
|---|---|---|
| Cascading Failure Walkthrough disconnected from canvas | CRITICAL | MISSING |
| RedundancyExperimentModal disconnected from canvas | HIGH | MISSING |
| Real health-mutation mechanics (`failAvailabilityZone` etc.) | N/A | CORRECT |
| ALB/ASG/ECS-scheduler narration conflation | MEDIUM | INCORRECT |
| RDS/Aurora failover timing | LOW | APPROXIMATION |
| SPOF detection vs. dynamic failure injection are non-interacting | LOW | APPROXIMATION (scope boundary) |
