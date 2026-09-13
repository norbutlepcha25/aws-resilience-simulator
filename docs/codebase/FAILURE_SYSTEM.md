# FAILURE_SYSTEM.md — Failure Lab, health state, and `cascadingFailure.ts`

**Headline finding, confirmed by direct re-read of every file in this subsystem**: there is no dependency-graph failure-propagation algorithm anywhere in this codebase. "Cascading failure" is the name of a UI feature, not an executable mechanism. The actual failure model is three unconnected things: (1) flat, direct health mutation on individual nodes or a whole AZ, (2) `requestSimulator.ts` reading that health state reactively during its own traversal (documented in `REQUEST_SIMULATOR.md`), and (3) two purely illustrative, hardcoded teaching widgets that do not read the user's canvas at all. This corrects an earlier, less-precise characterization of this subsystem from an earlier pass of this project's audit history, which assumed `cascadingFailure.ts` contained real dependency-failure-propagation logic — it does not.

## 1. `src/engine/failure/cascadingFailure.ts` — what it actually is

The entire file is one exported constant, `CASCADING_FAILURE_STAGES: CascadeStage[]`, containing exactly **4 hardcoded narrative stages** of one specific, fixed fictional incident:

1. **Initial Trigger** — "Amazon RDS Database" hits storage saturation / query deadlock, latency 15ms → 12,000ms.
2. **Upstream Coupling** — "ECS Application Tasks" thread pool exhausts (200/200) waiting on the DB.
3. **Health Check Collapse** — "Application Load Balancer" health probes time out, marks healthy tasks UNHEALTHY, target group capacity → 0.
4. **Thundering Herd / Retry Storm** — client retries amplify traffic 5x, crash any restart attempt.

Each stage carries fixed `component`/`event`/`systemImpact`/`teachingTakeaway`/`metricChange` text — literal strings, not computed from any node's actual state. **None of these 4 stages reference `nodes`, `edges`, or any live canvas data.** The function signature of the file is not even a function — there is no `propagateCascadingFailure(nodes, edges)` or equivalent exported anywhere in this file or in `ArchitectureContext.tsx`. This is a fixed slideshow script, always identical regardless of what architecture the student has actually drawn.

## 2. Where `CASCADING_FAILURE_STAGES` is consumed

Only one place: `src/components/failure/FailureControls.tsx`, via a "Step Through Cascading Outage" button that opens a modal (`showCascadingModal`). The modal renders a 4-step stepper (`currentCascadeStage`, plain local `useState`) with Previous/Next Phase navigation, showing each stage's fixed text and 3 fixed "telemetry" numbers (Observed Latency / 5xx Error Rate / Thread Saturation) per stage. This is a **guided reading experience** — clicking through it changes only which of the 4 hardcoded stage objects is displayed. It does not call `setNodeHealth`, does not touch `nodes`/`edges`, and has no effect on the canvas, the simulator, or the analysis engine. A student can open this walkthrough on a completely empty canvas and it behaves identically to opening it on a fully-built architecture.

## 3. What real, canvas-connected failure control actually exists

All genuine health-mutation logic lives in `ArchitectureContext.tsx` as flat `setNodes` mappers — confirmed by direct re-read (lines ~755-850):

| Function | Behavior |
|---|---|
| `setNodeHealth(id, health, reason?)` | Sets exactly one node's `data.health` and `data.failureReason` directly. No propagation to any other node. |
| `toggleNodeFailure(id)` | Flips one node between `'healthy'` and `'failed'`, setting `failureReason: 'Deliberate Failure Injected'` when failing. No propagation. |
| `failAvailabilityZone(az)` | Sets `health: 'failed'` on **every** node whose `data.az === az`, with `failureReason: 'Zone Outage (<AZ> Hardware Failure)'`. This is the closest thing to a "blast radius" concept in the app — but it is a flat filter-and-set-all over nodes sharing an AZ tag, not a graph traversal from a root cause outward through dependency edges. |
| `restoreAllNodes()` | Sets every node back to `health: 'healthy'`, clears `failureReason` and `isSimulating`, and also resets every edge (not fully re-read this pass, but confirmed present as a parallel `setEdges` mapper immediately following). |

`FailureControls.tsx`'s real, functional (non-modal) UI surface is exactly 3 buttons: **Simulate AZ-A Outage**, **Simulate AZ-B Outage**, **Restore All** — each wired directly to the functions above. The AZ outage buttons are disabled when there are zero nodes tagged with that AZ; Restore All is disabled when there are zero failed nodes.

Elsewhere (`NodeContextMenu.tsx`, `NodeStatusModal.tsx`, per `COMPONENT_INVENTORY.md`) a per-node health toggle is also exposed directly on the canvas, presumably calling `toggleNodeFailure`/`setNodeHealth` — consistent with the same flat-mutation model, no propagation logic to document beyond what's above.

## 4. `RedundancyExperimentModal.tsx` — second disconnected teaching widget

204 lines, imports `useArchitecture` from Context but **never actually calls it** (confirmed via grep: the import exists, but no `nodes`/`edges`/`analysis` reference appears anywhere in the file) — this is a dead import. All real state is a single local `useState(false)` boolean, `ecs1Failed`, toggled by one button ("Simulate: Crash Compute #1" / "Restore Compute #1"). The modal's stated purpose ("Compare a Single-Instance architecture against a Multi-Instance redundant architecture under failure") is presented entirely through fixed before/after copy and layout keyed off that one boolean — it does not read the user's actual canvas, does not check whether the user's architecture has 1 or 5 compute instances, and produces the identical comparison regardless of what is actually built. Like the cascading-failure walkthrough, this is a scripted teaching aid, not an experiment run against the user's own diagram.

## 5. How failure state actually reaches simulation behavior (the one real cross-engine link)

This is the only place failure state has any executable consequence beyond a visual "failed" badge on the node — fully documented in `REQUEST_SIMULATOR.md`, summarized here for completeness:
- Top-of-loop check: any `currentNode.data.health === 'failed'` immediately halts the trace with `503` (requestSimulator.ts line 146).
- ALB/API-Gateway target-health evaluation filters to `healthyTargets`; if all registered targets are failed, `502` (line 465-491).
- Compute→DB hop: a failed DB triggers either Multi-AZ failover (success), ElastiCache circuit-breaker fallback (success), or a hard `504` if neither applies (lines 557-636).
- Internet Gateway / NAT Gateway health checks gate egress/ingress specifically (lines 773-797, 913-936).

None of this is "cascading" in the sense of one failure programmatically causing another node's health to change — every one of these is the simulator **reading** a health value the user (or `failAvailabilityZone`) already set directly, and reacting to it within a single request trace. No node's `health` field is ever written by the simulator itself, and no failure of one node ever flips another node's stored `health` value. The appearance of a "cascade" in the product is produced entirely by how a single request trace narrates its way through several already-failed nodes in one run, or by the hardcoded 4-stage slideshow in §1 — not by any stateful propagation across simulation runs.

## 6. SPOF detection is a separate system, not part of this one

`spofDetector.ts` (part of the analysis engine, see `ANALYSIS_ENGINE.md`) independently identifies single points of failure by static graph inspection (fan-in counting, replica counts, Multi-AZ flags) — it does not use, call, or get called by anything in this document. A user can trigger an AZ outage via `FailureControls` without ever having looked at the SPOF list, and the SPOF list is computed identically whether or not any node is currently marked failed (it's about structural redundancy, not current health — confirmed in `ANALYSIS_ENGINE.md`).

## 7. Summary classification

| Component | Real mechanism? | Reads/writes canvas state? |
|---|---|---|
| `setNodeHealth` / `toggleNodeFailure` / `failAvailabilityZone` / `restoreAllNodes` | Yes — real, flat mutation | Yes |
| `requestSimulator.ts` health checks | Yes — real, reads health during traversal | Reads only |
| `CASCADING_FAILURE_STAGES` walkthrough | No — fixed narrative slideshow | Neither |
| `RedundancyExperimentModal` | No — fixed before/after comparison, local boolean only | Neither (dead `useArchitecture` import) |
