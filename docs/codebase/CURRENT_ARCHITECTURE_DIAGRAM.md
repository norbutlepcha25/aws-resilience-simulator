# CURRENT_ARCHITECTURE_DIAGRAM.md

Rendered from actual imports/call sites confirmed by reading source, not from intended design. See `ARCHITECTURE.md` §3 for the prose walkthrough this diagram encodes.

## 5.1 Module dependency graph

```mermaid
graph TD
    subgraph Types["Types (no deps)"]
        T["src/types/index.ts"]
    end

    subgraph Data["Static Data"]
        SC["serviceCatalog.ts (327 services)"]
        RA["referenceArchitectures.ts (12 templates)"]
        SCH["studentChallenges.ts"]
        SKB["serviceKnowledgeBase.ts"]
    end

    subgraph Engine["Engine (pure functions, no React)"]
        CT["layout/containment.ts"]
        CIDR["layout/cidrAllocator.ts"]
        RS["simulation/requestSimulator.ts"]
        NF["simulation/networkFirewalls.ts"]
        CF["failure/cascadingFailure.ts"]
        RE["analysis/rulesEngine.ts"]
        SPOF["analysis/spofDetector.ts"]
        BN["analysis/bottleneckDetector.ts"]
        CC["cost/costCalculator.ts"]
    end

    subgraph State["State / Orchestration"]
        AC["context/ArchitectureContext.tsx"]
    end

    subgraph UI["UI (React components)"]
        APP["App.tsx"]
        CANVAS["components/canvas/*"]
        PALETTE["components/palette/*"]
        INSPECTOR["components/inspector/*"]
        ANALYSIS_UI["components/analysis/AnalysisModal.tsx"]
        SIM_UI["components/simulation/*"]
        FAIL_UI["components/failure/*"]
        COST_UI["components/cost/CostEstimatorModal.tsx"]
        HEADER["components/layout/AppHeader.tsx"]
    end

    SC --> T
    RA --> T
    SCH --> T
    SKB --> SC

    CT --> T
    CIDR --> T
    RS --> T
    RS --> CT
    RS --> NF
    NF --> CT
    CF --> T
    RE --> T
    RE --> SPOF
    RE --> BN
    SPOF --> T
    BN --> T
    CC --> T

    AC --> T
    AC --> SC
    AC --> RA
    AC --> CT
    AC --> CIDR
    AC --> RS
    AC --> CF
    AC --> RE
    AC --> CC

    APP --> AC
    CANVAS --> AC
    PALETTE --> AC
    INSPECTOR --> AC
    ANALYSIS_UI --> AC
    SIM_UI --> AC
    FAIL_UI --> AC
    COST_UI --> AC
    HEADER --> AC
    HEADER --> RA

    style AC fill:#f9d,stroke:#333,stroke-width:2px
```

**Confirmed**: `ArchitectureContext.tsx` is the single choke point. No UI component imports an engine file directly (verified by grep across `src/components/**` for `from '../../engine` / `from '../../data`; the only exception is `AppHeader.tsx` importing `REFERENCE_ARCHITECTURES` directly to render the template dropdown — a read of static data, not engine logic).

## 5.2 Runtime data flow (what actually triggers what)

```mermaid
flowchart TD
    User["User action in canvas/palette/inspector"]
    User -->|drag/drop/connect/edit| Setters["ArchitectureContext setters\n(setNodes, setEdges, updateNodeData)"]

    Setters --> GeomEffect["Geometry useEffect\n(reactive, runs on every nodes/edges change)"]
    GeomEffect --> Derive["deriveSubnetForNode()\nfor every service node"]
    Derive --> CidrCalc["allocateSubnetCidrs()\nper VPC, ordered public-then-private"]
    CidrCalc --> Reserved["getReservedAddresses()\nper subnet"]
    GeomEffect --> ZIndex["calculateBoundaryZIndex()\nfor boundary nodes"]
    ZIndex --> WriteBack["setNodes() ONLY IF changed\n(prevents infinite loop)"]
    Reserved --> WriteBack

    Setters --> CostMemo["costReport = useMemo(calculateArchitectureCost)\n(reactive)"]
    Setters --> AnalysisMemo["analysis = useMemo(analyzeArchitecture)\n(reactive)"]
    AnalysisMemo --> SPOFCall["detectSPOFs()"]
    AnalysisMemo --> BNCall["detectBottlenecks()"]

    UserRun["User clicks 'Send Request'"] --> RunScenario["runScenario()"]
    RunScenario --> RunSim["runSimulation(nodes, edges, scenario)\n(NOT reactive — explicit trigger only)"]
    RunSim --> FirewallCheck["checkNetworkFirewalls() /\ncheckCustomNaclReturn()"]
    RunSim --> SimResult["simulationResult\nconsumed by SimulationControls,\nEventTimeline, canvas edge highlighting"]

    UserFail["User toggles node health\nin Failure Lab"] --> TriggerFail["triggerFailure() / toggleNodeHealth()"]
    TriggerFail --> Cascade["propagateCascadingFailure(nodes, edges)\n(NOT reactive — explicit trigger only)"]
    Cascade --> HealthWrite["node.data.health written into state"]
    HealthWrite -.->|"read on NEXT runScenario() call\nnot pushed automatically"| RunSim

    AnalysisMemo -.->|"no edge — analysis never gates or\nfeeds simulation"| RunSim
    RunSim -.->|"no edge — simulation result\nnever feeds analysis score"| AnalysisMemo
```

**Two confirmed facts that contradict a "pipeline" mental model:**
1. Analysis/Cost/Geometry are reactive (`useMemo`/`useEffect`); Simulation and Failure-injection are imperative (fire only on explicit user action). Nothing in this app runs "UI → State → Simulation → Analysis" as one automatic chain.
2. The only cross-engine data edge that exists is **Failure → Simulation** (a node's `health` field, once set by the Failure Lab, is read and hard-fails a step inside `requestSimulator.ts` on the next simulation run). Simulation results are never read by the analysis engine, and analysis results never gate or alter a simulation. Cost is fully independent of both.

## 5.3 Per-node lifecycle (single service node, from drop to render)

```mermaid
sequenceDiagram
    participant P as ServicePalette
    participant AC as ArchitectureContext
    participant CT as containment.ts
    participant CIDR as cidrAllocator.ts
    participant RF as React Flow canvas

    P->>AC: addServiceNode(serviceDef, position)
    AC->>AC: create node with serviceDef defaults (defaultConfig - never actually set by any catalog entry, see SERVICE_SYSTEM.md)
    AC->>RF: setNodes([...nodes, newNode])
    RF-->>AC: nodes/edges changed
    AC->>CT: deriveSubnetForNode(node, boundaryNodes)
    CT-->>AC: containing subnet (or 'unassigned')
    AC->>CIDR: allocateSubnetCidrs(vpcCidr, subnetIdsInVpc)
    CIDR-->>AC: per-subnet CIDR blocks + reserved addresses
    AC->>RF: setNodes(updated) [only if derived values changed]
    RF-->>P: re-render with computed subnet/CIDR badge
```
