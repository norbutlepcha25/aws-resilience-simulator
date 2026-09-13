// Barrel export for the IAM behavioral engine (Phase 6 of
// docs/target-architecture/MIGRATION_PLAN.md). Standalone and deterministic - not wired into the
// live request simulator; see IAM_ENGINE_DEVIATIONS.md for why and what that would require.
export * from './types.ts';
export * from './actionMatch.ts';
export * from './resourceMatch.ts';
export * from './conditions.ts';
export * from './roleAssumption.ts';
export * from './evaluate.ts';
