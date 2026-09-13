# COMPONENT_INVENTORY.md

Every file classified by primary role: **UI** (renders/handles input, no business logic of its own), **State** (owns/derives application state), **Model** (pure data: types or static catalogs), **Simulation** (executes the request trace), **Validation** (structural gating, inline — see note in `ARCHITECTURE.md` §4), **Failure** (health/cascading logic), **Analysis** (scoring/findings), **Infrastructure** (build/tooling, not app logic).

## Root / entry

| File | Role | Notes |
|---|---|---|
| `src/main.tsx` | Infrastructure | Vite/React entry point, mounts `<App/>`. |
| `src/App.tsx` | UI (composition root) | Owns which modal is open (local `useState` booleans), renders `AppHeader`, `ServicePalette`, `ArchitectureCanvas`, `SimulationControls`/`FailureControls` depending on `appMode`, and all modals. No business logic; pure composition + local UI-only state. |
| `src/index.css` | Infrastructure | Tailwind entry + a handful of custom utility classes (design-token layer from the UI redesign pass). |
| `src/vite-env.d.ts` | Infrastructure | Vite/TS ambient types. |

## Types & static data (`src/types`, `src/data`)

| File | Role | Notes |
|---|---|---|
| `src/types/index.ts` | Model | All shared interfaces. Zero logic. Consumed by every other layer. |
| `src/data/serviceCatalog.ts` | Model | 327 `AWSService` entries across 21 categories. See `SERVICE_SYSTEM.md` for full breakdown — most entries are metadata-only. |
| `src/data/referenceArchitectures.ts` | Model | 12 hand-authored reference templates (full node/edge graphs + narrative description), loaded verbatim by `loadTemplate()` in `ArchitectureContext`. Not generated, not parameterized — each is a literal object. |
| `src/data/studentChallenges.ts` | Model + Validation (challenge-local) | Each challenge object bundles an `initialTemplateId` and an `evaluationCheck(nodes, edges, analysis)` closure containing its own bespoke pass/fail rules (e.g. counting ALB presence, compute replica counts, Multi-AZ DB, cross-referencing `analysis.spofs`). This is genuinely a fourth, separate rule-evaluation surface beyond `rulesEngine.ts` — every challenge re-implements its own mini rules-engine inline rather than reusing `analyzeArchitecture`'s output structurally (it does read `analysis.spofs` but computes everything else itself). |
| `src/data/serviceKnowledgeBase.ts` | Model | Only 3 services (`SERVICE_KNOWLEDGE_BASE`) have hand-curated knowledge text; `getServiceKnowledge()` synthesizes a fallback for the other 324 from `serviceCatalog.ts` fields, and a final generic fallback for unknown ids. Honestly designed — does not claim curated depth it doesn't have. |

## Engine (`src/engine/**`) — pure functions, no React imports, fully covered in dedicated docs

| File | Role | Detailed in |
|---|---|---|
| `src/engine/layout/containment.ts` | Simulation support (geometry) | `NETWORKING_CURRENT_STATE.md` |
| `src/engine/layout/cidrAllocator.ts` | Simulation support (geometry) | `NETWORKING_CURRENT_STATE.md` |
| `src/engine/simulation/requestSimulator.ts` | Simulation | `REQUEST_SIMULATOR.md` |
| `src/engine/simulation/networkFirewalls.ts` | Simulation (firewall sub-engine) | `NETWORKING_CURRENT_STATE.md`, `REQUEST_SIMULATOR.md` |
| `src/engine/failure/cascadingFailure.ts` | Failure | `FAILURE_SYSTEM.md` |
| `src/engine/analysis/rulesEngine.ts` | Analysis | `ANALYSIS_ENGINE.md` |
| `src/engine/analysis/spofDetector.ts` | Analysis | `ANALYSIS_ENGINE.md` |
| `src/engine/analysis/bottleneckDetector.ts` | Analysis | `ANALYSIS_ENGINE.md` |
| `src/engine/cost/costCalculator.ts` | Analysis (cost estimation) | `ANALYSIS_ENGINE.md` |

## State (`src/context`)

| File | Role | Notes |
|---|---|---|
| `src/context/ArchitectureContext.tsx` (1276 lines) | State / Orchestration | The single integration point between engine and UI. Owns: `nodes`/`edges` (React Flow state), `appMode`, `scenario`, `simulationResult`, `activeStepIndex`/playback state, `analysis` (memoized), `costReport` (memoized), `hasCustomNacl`/`showNaclSideColumn`, template/challenge loaders, and the geometry-sync `useEffect` (derives `subnet`, CIDR allocation, reserved addresses, and boundary z-index live from node position on every change, writing back to state only if something actually changed — this guards against the infinite-loop class of bug fixed earlier in this project's history). 34 hooks total. `DEFAULT_STARTER_NODES`/`createStarterNodes()` pre-populates a VPC + public + private subnet on fresh load — **this contradicts an earlier explicit product decision in this project's history to make the canvas load fully blank**; flagged here as a discrepancy for the user to reconcile, not silently fixed (out of scope for this read-only pass). |

## UI components (`src/components/**`)

| File | Role | Notes |
|---|---|---|
| `components/layout/AppHeader.tsx` | UI | Mode switcher (Design/Simulate/Failure Lab tabs), Analyze/Challenges buttons, live cost pill, Reference Diagrams dropdown (reads `REFERENCE_ARCHITECTURES` directly — the one UI file that imports static data outside the Context), New/Download Image/Export actions. No business logic. |
| `components/canvas/ArchitectureCanvas.tsx` | UI | React Flow canvas host: node/edge rendering, drag/drop from palette, connection creation (`onConnect`), context menu wiring. |
| `components/canvas/BoundaryNode.tsx` | UI | Renders VPC/subnet/security-group boundary rectangles; reads derived z-index/CIDR fields written by the Context's geometry effect. |
| `components/canvas/ServiceNode.tsx` | UI | Renders an individual AWS service node (icon, label, health state, replica badge). |
| `components/canvas/CustomConnectionEdge.tsx` | UI | Custom edge renderer — draws request/response arrows, applies "Task Flow" highlight styling, z-orders above boundary boxes (fix from earlier in this project). |
| `components/canvas/NodeContextMenu.tsx` | UI | Right-click menu (delete, duplicate, configure). |
| `components/canvas/NodeStatusModal.tsx` | UI | Per-node health/config detail popup. |
| `components/palette/ServicePalette.tsx` | UI | Left-side draggable service list, grouped by category; flattened from cards to a list layout in the UI-redesign pass. |
| `components/palette/ServiceInfoModal.tsx` | UI | Read-only "about this service" popup, sourced from `serviceKnowledgeBase.ts`. |
| `components/inspector/ServiceInspector.tsx` | UI | Right-side per-node configuration panel (replicas, Multi-AZ, caching, timeout, Security Group attach/detach). Was mid-edit by a parallel process at time of the last UI pass; not touched by this reverse-engineering pass either (read-only constraint). |
| `components/inspector/NaclSideColumn.tsx` | UI (with embedded teaching-scenario logic) | 464-line hardcoded single-scenario ("Problem 3.1: Stateless Timeout") widget. `handleToggleFix()` mutates real `customNacl.inboundRules`/`outboundRules` via `updateNodeData`/`updateEdgeData`, but the rendered rule tables are **static hardcoded JSX**, not driven by the actual rule arrays — a genuine display/data mismatch (flagged in earlier audit, unresolved by design in this phase). |
| `components/simulation/SimulationControls.tsx` | UI | Method/path/traffic-level inputs, Send Request button, playback transport (step/play/pause/speed), Task Flow toggle, HTTP-status-and-latency result pill. |
| `components/simulation/EventTimeline.tsx` | UI | Renders `simulationResult.steps` as a scrollable timeline. |
| `components/failure/FailureControls.tsx` | UI | Failure Lab controls — toggle node health, trigger cascading failure. |
| `components/failure/RedundancyExperimentModal.tsx` | UI | Guided "what if this fails" experiment flow. |
| `components/analysis/AnalysisModal.tsx` | UI | Renders `ArchitectureAnalysis` (5 scores, SPOFs, bottlenecks, security findings); flattened from cards to a list in the UI-redesign pass. |
| `components/cost/CostEstimatorModal.tsx` | UI | Renders `ArchitectureCostReport` (per-node line items, FinOps tips). |
| `components/challenges/ChallengeModal.tsx` | UI | Lists `STUDENT_CHALLENGES`, runs `evaluationCheck`, shows pass/fail feedback. |
| `components/export/ExportModal.tsx` | UI | Serializes canvas to JSON/PNG export. |
| `components/icons/AwsServiceIcons.tsx`, `components/icons/awsIconRegistry.ts` | UI | Maps `serviceId` → one of the ~280 bundled official AWS SVG icons under `components/serviceIcon/`. |
| `components/serviceIcon/*.svg` (280 files) | Model (static assets) | Official AWS Architecture Icons, referenced by `awsIconRegistry.ts`. Most are never used by any catalog entry that has simulation behavior — purely visual/library completeness. |
| `src/utils/exportImage.ts` | UI support | Canvas-to-PNG rendering helper used by `AppHeader`'s "Download Image" action. |

## Tests / tooling

| File | Role |
|---|---|
| `test/engine.test.ts` | Test (all layers) — see `TEST_SYSTEM.md` for full per-test breakdown. |
| `tailwind.config.js` | Infrastructure — design-token overrides (radius/shadow scale, `circuit` accent color, IBM Plex fonts). |
| `Dockerfile`, `nginx.conf`, `.dockerignore`, `docker-compose.yml` | Infrastructure — multi-stage build, static SPA served by nginx. |

## Summary counts

- **327** catalog services, **21** categories, **12** reference templates, **~8** student challenges (count from file: exact number not re-verified this pass — see `SERVICE_SYSTEM.md`/`TEST_SYSTEM.md` for verified counts elsewhere).
- **9** engine files (pure logic), **1** Context file (orchestration), **~25** component files (UI), **280** SVG icon assets.
- Only **28 of 327** catalog service ids have any literal behavioral reference inside `requestSimulator.ts` — see `SERVICE_SYSTEM.md` for the full classification.
