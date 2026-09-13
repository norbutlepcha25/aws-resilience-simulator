# Explanation / Trace Engine

Status: design only. Formalizes what `SimulationTrace`/`SimulationStep` already do, and proposes one
additive schema field so every future engine (Network, IAM, Service, Failure) can attach a structured
reason to a step instead of only a free-text `explanation` string.

## 1. Required shape (from the design brief)

Every simulation must be able to produce, per step:

```
step · component · decision · reason · AWS rule · evidence
```

Example (the CloudFront/ALB perimeter walk):
```
1. DNS resolved
2. Route selected
3. NACL allowed
4. Security Group allowed
5. IAM allowed
6. Service accepted request
```

## 2. Mapping onto the existing `SimulationStep`

```ts
// Existing, unchanged
interface SimulationStep {
  id: string;
  stepNumber: number;
  timestampMs: number;
  sourceNodeId: string;
  targetNodeId: string;
  sourceNodeName: string;
  targetNodeName: string;
  protocol: ProtocolType;
  action: string;                 // → "component" + part of "decision"
  status: 'processing' | 'success' | 'failed' | 'bypassed';   // → "decision"
  explanation: string;            // → "reason" (free text, already exists)
  targetHealth: NodeHealth;
  latencyMs: number;
  details?: {
    targetsEvaluated?: {...}[];
    cacheHit?: boolean;
    statusCode?: number;
    failureReason?: string;
    recoveryApplied?: string;
    decision?: DecisionDetail;    // ADDITIVE — new, optional
  };
}
```

`action`, `status`, and `explanation` already cover "component / decision / reason" — that's exactly
what today's steps read like (`"Network ACL Blocked Traffic"` / `'failed'` /
`"PACKET BLOCKED: ..."`). The one gap is **"AWS rule" and "evidence"** as structured, machine-
readable fields rather than being folded into the `explanation` prose string.

**Additive field:**

```ts
interface DecisionDetail {
  /** Points at a row in docs/aws-behavior/AWS_BEHAVIOR_MATRIX.md, e.g. "NACL-3", "IAM-9". */
  ruleRef?: string;
  /** Which engine produced this step's decision. */
  evaluatedBy: 'network' | 'iam' | 'service' | 'failure';
  /** The specific data that justified the decision — e.g. the matched NaclRule, the denying
   *  PolicyStatement, the health-check result that triggered failover. Kept as a loose record
   *  rather than a closed union, since each engine's evidence shape differs. */
  evidence?: Record<string, unknown>;
}
```

Optional and additive: every existing reference architecture, every existing test asserting on
`SimulationStep` shape, and every existing UI component reading `steps` (`EventTimeline`,
`NodeStatusModal`) keeps working unmodified. `decision` is populated only by engines that have been
migrated to reference `AWS_BEHAVIOR_MATRIX.md` rule ids — during the transition, some steps have it,
some don't, and nothing downstream requires it to be present.

## 3. Worked example: NACL implicit-deny step, annotated

Today (`networkFirewalls.ts`, refactor item 1 fix):

```ts
note: `${naclLabel} evaluated ${protocol} traffic against custom rules: no explicit rule matched, so the implicit final DENY (Rule 32767, matches all traffic) applies. NACLs deny by default.`
```

Target, same runtime behavior, with structured decision data attached:

```ts
trace.pushStep({
  action: 'Network ACL Blocked Traffic',
  status: 'failed',
  explanation: note,   // unchanged prose, still the human-facing "reason"
  details: {
    statusCode: 403,
    failureReason: note,
    decision: {
      ruleRef: 'NACL-3',                       // AWS_BEHAVIOR_MATRIX.md row: "implicit final deny"
      evaluatedBy: 'network',
      evidence: { matchedRule: 32767, naclLabel, protocol }
    }
  }
});
```

Nothing about `pushStep`'s call sites needs to change shape — `decision` is one more optional key in
an already-optional `details` object.

## 4. `SimulationTrace` — no change required

```ts
class SimulationTrace {
  readonly steps: SimulationStep[];
  pushStep(fields): void;
  advanceTime(ms): void;
  fail(statusCode, summary): void;
  succeed(statusCode, summary): void;
  markSuccess(summary): void;
  addBottleneck(message): void;
}
```

This class already does exactly what a Trace Engine needs: single accumulation point, auto-filled
`id`/`stepNumber`/`timestampMs`, and a small enough surface that every adapter mutates the same shared
state predictably (see the class's own doc comment in `adapters/types.ts`). The target architecture
keeps it as-is; `AdapterContext.trace` remains the one handle every engine stage writes through.

## 5. Consumers

| Consumer | Reads | Changes needed |
|---|---|---|
| `EventTimeline.tsx` | `steps[].action/status/explanation/latencyMs` | None — additive field ignored if absent |
| `NodeStatusModal.tsx` | `steps` filtered to one node | None |
| Test suite (`test/engine.test.ts`) | Asserts on `statusCode`, `explanation` substrings, step counts | None for existing tests; new tests for new engines can additionally assert `details.decision.ruleRef` once populated (closes the `TEST_GAPS.md` finding that "zero existing tests assert against an AWS-documented fact as ground truth" — a `ruleRef` string is a direct, greppable link from a test assertion to a specific `AWS_BEHAVIOR_MATRIX.md` row) |

## 6. What this does NOT do

- Does not replace `explanation`'s free-text prose — that's still the primary human-facing
  narration and stays untouched.
- Does not require every step to carry `decision` — only steps produced by engines that have
  actually been migrated to cite a rule reference.
- Does not introduce a separate trace data structure alongside `SimulationStep[]` — one array, one
  shape, additively extended, matching the "no second model" principle in
  `SIMULATION_ENGINE_ARCHITECTURE.md` §3.
