export type { TraceEntry, TraceDecision, RequestTrace } from './types.ts';
export { explainHop, finalizeTrace } from './explainHop.ts';
export { explainRequest, explainRequestAlongEdges } from './explainRequest.ts';
export { renderTrace, toSimpleSummary, toDetailedSummary } from './render.ts';
export type { ExplanationMode } from './render.ts';
