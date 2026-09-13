export type {
  FailureType,
  FailureSeverity,
  FailureTrigger,
  FailureLifecycleState,
  Failure,
  FailureInput,
  DependentImpact,
  FailureImpactAnalysis
} from './types.ts';
export { EDGE_BLOCKING_FAILURE_TYPES, isEdgeBlockingFailureType } from './types.ts';
export { createFailure, analyzeFailureImpact } from './propagation.ts';
export { computeEffectiveArchitectureState } from './effectiveState.ts';
export type { EffectiveArchitectureState } from './effectiveState.ts';
export { checkRedundancy } from './redundancy.ts';
export type { RedundancyCheck } from './redundancy.ts';
export {
  requestEdges,
  getUpstreamCallers,
  getDownstreamTargets,
  isNetworkInfraNode,
  NETWORK_INFRA_SERVICE_IDS
} from './dependencyGraph.ts';
export { CASCADING_FAILURE_STAGES } from './cascadingFailure.ts';
export type { CascadeStage } from './cascadingFailure.ts';
