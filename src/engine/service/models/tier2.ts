// Tier 2: "meaningful adapters" - each captures the one or two behavioral facts that actually
// distinguish the service (per docs/aws-behavior/SERVICE_BEHAVIOR.md where it exists), without
// claiming a full deep simulation the way Tier 1 services get. None of these have any existing
// adapter logic in src/engine/simulation/adapters/ to preserve - each rule below is a new,
// narrow, honestly-scoped behavioral fact, not an invented one; see
// SERVICE_ENGINE_DEVIATIONS.md §5 for exactly what's NOT covered for each.
import type { ServiceModel, ServiceRequestOutcome } from '../types.ts';

function buildPassthroughTier2Model(id: string, description: string, requiresEni: boolean, dependencies: string[] = []): ServiceModel {
  return {
    id,
    tier: 2,
    description,
    validateConfiguration: () => [],
    resolveEndpoints: () => ({ requiresEni, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    processRequest: (input): ServiceRequestOutcome =>
      input.target.health === 'failed'
        ? { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` }
        : { status: 'success', detail: `${input.target.label} handled the request.` },
    getDependencies: () => dependencies,
    getFailureModes: () => [{ id: `${id}-unavailable`, description: `${description} - service unavailable.`, detectionSystem: 'manual' }]
  };
}

export const ecrModel = buildPassthroughTier2Model('ecr_registry', 'Managed Docker/OCI container image registry.', false);
export const efsModel = buildPassthroughTier2Model('efs', 'Managed, elastic NFS file system - can be mounted by multiple compute nodes concurrently.', true);
export const kmsModel = buildPassthroughTier2Model('kms', 'Managed encryption key creation and control.', false);
export const secretsManagerModel = buildPassthroughTier2Model('secrets_manager', 'Managed storage and rotation of secrets (credentials, API keys).', false);
export const cognitoModel = buildPassthroughTier2Model('cognito', 'Managed user directory and authentication/authorization (JWT issuance).', false);
export const cloudwatchModel = buildPassthroughTier2Model('cloudwatch', 'Metrics, logs, and alarms - the data source behind the ELB/ASG health-check systems Tier 1 compute/edge models reference.', false);

export const eventbridgeModel: ServiceModel = {
  id: 'eventbridge',
  tier: 2,
  description: 'Serverless event bus with content-based pattern matching and routing rules.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: true, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome => ({ status: 'success', detail: `${input.target.label} matched the event against a rule and routed it to its target(s).` }),
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'eventbridge-rule-mismatch', description: 'An event does not match any configured rule pattern and is silently dropped (not retried).', detectionSystem: 'manual' }]
};

export const stepFunctionsModel: ServiceModel = {
  id: 'step_functions',
  tier: 2,
  description: 'Managed state-machine orchestration for multi-step, long-running workflows.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: true, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome =>
    input.target.health === 'failed'
      ? { status: 'failure', statusCode: 500, reason: `${input.target.label}: a state machine execution failed and was not caught by a Catch block.` }
      : { status: 'success', detail: `${input.target.label} advanced the state machine to its next state.` },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'step-functions-execution-failure', description: 'An uncaught error in a state transition fails the whole execution.', detectionSystem: 'manual' }]
};

export const elastiCacheModel: ServiceModel = {
  id: 'elasticache',
  tier: 2,
  description: 'Managed in-memory cache (Redis/Memcached) - commonly used as a circuit-breaker fallback in front of a relational database.',
  validateConfiguration(node) {
    return node.subnet === 'unassigned' ? [{ field: 'subnet', message: 'elasticache must be placed inside a VPC subnet.' }] : [];
  },
  resolveEndpoints: () => ({ requiresEni: true, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome =>
    input.target.health === 'failed'
      ? { status: 'failure', statusCode: 504, reason: `${input.target.label} is offline - cache-fallback unavailable.` }
      : { status: 'success', detail: `${input.target.label} served the request from cache.` },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'elasticache-node-failure', description: 'A cache node fails; requests fall through to the primary data store.', detectionSystem: 'manual' }]
};

export const wafModel: ServiceModel = {
  id: 'waf',
  tier: 2,
  description: 'Layer 7 web application firewall - inspects HTTP request content against managed/custom rule sets. Distinct from Shield, which performs L3/L4 volumetric DDoS mitigation and does NOT do this inspection (test 45).',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest(input): ServiceRequestOutcome {
    const path = input.path || '';
    if (/sql|select|insert|delete|drop|admin|eval|script/i.test(path)) {
      return { status: 'failure', statusCode: 403, reason: `${input.target.label} blocked a malicious pattern in '${path}' (SQLi/XSS Core Rule Set).` };
    }
    return { status: 'success', detail: `${input.target.label} passed the request to the origin.` };
  },
  getDependencies: () => [],
  getFailureModes: () => []
};
