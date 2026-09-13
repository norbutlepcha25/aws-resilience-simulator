// Barrel export for the Unified Request/Flow Simulation Engine (Phase 8 of
// docs/target-architecture/MIGRATION_PLAN.md). Standalone - see
// docs/aws-behavior/UNIFIED_PIPELINE_DEVIATIONS.md §0 for why `runSimulation` itself was not
// swapped to call this engine in this pass, and toSimulationResult() for the proven-compatible
// bridge that would let it do so without any UI component changes.
export * from './types.ts';
export * from './engine.ts';
export * from './trace.ts';
export * from './adapter.ts';
