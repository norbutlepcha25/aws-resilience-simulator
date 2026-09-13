// Barrel export for the Service Behavior Engine (Phase 7 of
// docs/target-architecture/MIGRATION_PLAN.md). Standalone and deterministic, composing the
// Phase 5 Network Engine and Phase 6 IAM Engine - see interaction.ts and
// docs/aws-behavior/SERVICE_ENGINE_DEVIATIONS.md.
export * from './types.ts';
export * from './registry.ts';
export * from './interaction.ts';
export { buildGenericServiceModel } from './genericModel.ts';
export { evaluateCapacity } from './models/compute.ts';
export { evaluateLoadBalancing } from './models/edge.ts';
