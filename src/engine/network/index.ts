// Barrel export for the networking behavioral engine (Phase 5 of
// docs/target-architecture/MIGRATION_PLAN.md). Each concern lives in its own small, independently
// tested module; nothing here changes existing simulator behavior on its own - see
// src/engine/simulation/networkFirewalls.ts and the adapters/ directory for where these are
// actually wired into the live per-hop trace, and NETWORK_ENGINE_DEVIATIONS.md for every place
// this engine's model deliberately simplifies real AWS.
export * from './cidr.ts';
export * from './routeTable.ts';
export * from './nacl.ts';
export * from './securityGroup.ts';
export * from './nat.ts';
export * from './packet.ts';
export * from './explain.ts';
export * from './types.ts';
