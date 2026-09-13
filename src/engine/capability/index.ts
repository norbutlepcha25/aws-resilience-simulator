export type { CapabilityFlag, CapabilityStatus, ServiceClassification, ServiceCapabilityProfile } from './types.ts';
export { CAPABILITY_FLAGS, classify } from './types.ts';
export { buildServiceCapabilityRegistry, getServiceCapabilityRegistry, getServiceCapabilityProfile } from './registry.ts';
export { IAM_AUTHENTICATED_ACTIONS, IAM_CALLER_SERVICE_IDS } from './iamCoverage.ts';
export { LIVE_ADAPTER_SERVICE_IDS, REQUEST_SIMULATION_EVIDENCE, FAILURE_SIMULATION_EVIDENCE } from './liveCoverage.ts';
