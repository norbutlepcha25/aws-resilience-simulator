# ARCHITECTURE.md — Current System Architecture (Reverse-Engineered)

> Scope note: this document describes the codebase **as it exists today**, not as it was designed to be. Where the code deviates from what a clean version of this idea would look like, that deviation is called out explicitly. This is a read-only analysis; no production code was changed to produce it.

## 1. What this application actually is

A client-only React SPA (Vite + TypeScript, no backend, no persistence layer) that lets a user drag AWS service nodes and VPC/subnet "boundary" nodes onto a React Flow canvas, wire them together with edges, and then:

1. Run a **deterministic single-request trace** through the graph (`requestSimulator.ts`) and render it as a step list / animated path.
2. Run a **static architecture analysis** over the same graph (`rulesEngine.ts`, `spofDetector.ts`, `bottleneckDetector.ts`) that produces scores and a punch-list of issues, independent of whether a simulation was ever run.
5. Run a **failure-injection pass** (`cascadingFailure.ts`) that marks nodes unhealthy and propagates dependency failure, again independent of the request simulator.
4. Estimate a **monthly AWS bill** (`costCalculator.ts`) from static node configuration.
5. Grade the graph against a fixed **student challenge** rubric (`studentChallenges.ts`), each challenge running its own bespoke `evaluationCheck` function against `nodes/edges/analysis`.

All five of these consume the same `nodes`/`edges` React Flow arrays held in `ArchitectureContext`, but they are **four/five independent read models over one piece of state**, not stages of one pipeline. A change made in the canvas is picked up by all of them the next time each one is invoked (on-demand for simulation/analysis/cost, live via `useEffect` for the geometry-derived fields), but none of them calls into another. The "UI → State → Architecture Model → Simulation → Validation → Failure → Analysis" flow implied by a clean layered design does not exist as a literal call chain; it exists only in the sense that they share the same underlying node/edge model. See section 3 for the actual dependency graph.

## 2. Actual layers, in dependency order (confirmed by imports, not by intent)

| Layer | Files | Depends on | Produces |
|---|---|---|---|
| **Types** | `src/types/index.ts` | nothing | Shared TS interfaces (`ServiceNodeData`, `SimulationResult`, `ArchitectureAnalysis`, `NaclRule`, etc.) |
| **Static data** | `src/data/serviceCatalog.ts`, `src/data/referenceArchitectures.ts`, `src/data/studentChallenges.ts`, `src/data/serviceKnowledgeBase.ts` | Types | 327 service definitions, 12 reference templates, challenge rubrics, per-service knowledge text |
| **Layout/geometry engine** | `src/engine/layout/containment.ts`, `src/engine/layout/cidrAllocator.ts` | Types | Rect math, subnet containment, CIDR splitting, boundary z-index |
| **Simulation engine** | `src/engine/simulation/requestSimulator.ts`, `src/engine/simulation/networkFirewalls.ts` | Types, containment.ts | `SimulationResult` (step-by-step trace) |
| **Failure engine** | `src/engine/failure/cascadingFailure.ts` | Types | Health-state propagation |
| **Analysis engine** | `src/engine/analysis/rulesEngine.ts`, `spofDetector.ts`, `bottleneckDetector.ts` | Types, spofDetector, bottleneckDetector | `ArchitectureAnalysis` (scores + findings) |
| **Cost engine** | `src/engine/cost/costCalculator.ts` | Types | `ArchitectureCostReport` |
| **State/orchestration** | `src/context/ArchitectureContext.tsx` | ALL of the above | React Context: `nodes`, `edges`, `simulationResult`, `analysis`, `costReport`, template/challenge loaders, geometry-sync `useEffect` |
| **UI** | `src/components/**`, `src/App.tsx` | ArchitectureContext only (components never import engine files directly) | Rendered canvas, modals, side panels |

**Confirmed rule**: every component file reads/writes exclusively through `useArchitecture()` (the Context hook). No component imports `requestSimulator.ts`, `rulesEngine.ts`, etc. directly — `ArchitectureContext.tsx` is the sole integration point. This is a genuinely clean boundary and is the one place in the app that matches the "layered" mental model the reverse-engineering brief assumes.

## 3. The real flow, as call edges (not aspiration)

```
User drags/drops/clicks in a component
        │
        ▼
ArchitectureContext state setters (setNodes/setEdges/updateNodeData/...)
        │
        ├─▶ geometry useEffect (runs on every nodes/edges change):
        │     deriveSubnetForNode() ─▶ allocateSubnetCidrs() ─▶ getReservedAddresses()
        │     calculateBoundaryZIndex()
        │     → writes DERIVED fields back onto node.data (subnet, cidrBlock, zIndex, etc.)
        │     → this is the ONLY thing that runs automatically/reactively
        │
        ├─▶ costReport = calculateArchitectureCost(nodes, trafficLevel)   [recomputed via useMemo on nodes change]
        │
        ├─▶ analysis = analyzeArchitecture(nodes, edges)                  [recomputed via useMemo on nodes/edges change]
        │       ├─▶ detectSPOFs(nodes, edges)
        │       └─▶ detectBottlenecks(nodes, edges)
        │
        ├─▶ runScenario() [user clicks "Send Request", NOT automatic]
        │       └─▶ runSimulation(nodes, edges, scenario)
        │              └─▶ checkNetworkFirewalls() / checkCustomNaclReturn()   [from networkFirewalls.ts]
        │              → simulationResult (consumed only by SimulationControls/EventTimeline/canvas highlighting)
        │
        └─▶ triggerFailure()/toggleNodeHealth() [user action in Failure Lab, NOT automatic]
                └─▶ propagateCascadingFailure(nodes, edges) [cascadingFailure.ts]
                → sets node.data.health, read by analysis + simulation on their NEXT run, not pushed to them
```

Key finding: **analysis, cost, and the geometry sync are reactive** (recomputed automatically whenever `nodes`/`edges` change). **Simulation and failure-injection are not** — they are explicit user-triggered actions whose results (`simulationResult`, node `health` flags) sit in state until the next explicit trigger. There is no dependency arrow from "Simulation" back into "Analysis" or vice versa: running a simulation does not feed the analysis score, and the analysis score does not gate whether a simulation can run. A node marked `health: 'failed'` by the Failure Lab **is** read by `requestSimulator.ts` (it hard-fails a step immediately), so Failure → Simulation is a real, confirmed edge — but Simulation → Failure and Analysis → anything are not.

## 4. What "Validation" means in this codebase (there isn't a distinct validation layer)

The brief's model assumes a "Validation" stage sitting between Simulation and Failure. No such module exists. What plays that role is scattered:
- Structural checks that gate simulation (unattached IGW, `unassigned` subnet, direct public→private access) live **inside** `requestSimulator.ts` as inline `if` blocks that produce a failed step — this is simulation-time validation, not a separate pass.
- Architecture-quality checks (SPOF count, security score, HTTP-not-HTTPS, DB-in-public-subnet) live in `rulesEngine.ts` and are analysis, not validation — they never block anything, they just contribute to a score and a findings list.
- There is no schema validation, no "can this graph even run" pre-flight step, no separate `validation/` directory.

**Conclusion**: the honest five-box diagram is *State → (Geometry sync, Cost, Analysis) [reactive]* and *State → Simulation [on demand]*, *State → Failure [on demand] → read back into Simulation*. See `CURRENT_ARCHITECTURE_DIAGRAM.md` for the Mermaid rendering of this.

## 5. Cross-references
- Full per-file breakdown: `COMPONENT_INVENTORY.md`
- Service catalog and simulation-coverage classification: `SERVICE_SYSTEM.md`
- Networking/subnetting/firewall algorithms: `NETWORKING_CURRENT_STATE.md`
- `requestSimulator.ts` line-by-line behavior: `REQUEST_SIMULATOR.md`
- `cascadingFailure.ts` and health propagation: `FAILURE_SYSTEM.md`
- `rulesEngine.ts` and the VALIDATION/SIMULATION/ANALYSIS split: `ANALYSIS_ENGINE.md`
- Test suite coverage and gaps: `TEST_SYSTEM.md`
