// IAM and STS: thin wrappers over the Phase 6 IAM engine (src/engine/iam/). The `iam` service
// node is decorative in this simulator's live traversal (test 46 in test/engine.test.ts - present
// for architectural completeness, never load-bearing), so this model's `processRequest` reflects
// exactly that: it never fails a request. Real authorization decisions belong to
// `evaluateAuthorization()` (src/engine/iam/evaluate.ts), consulted directly by
// `interaction.ts`'s IAM-failure scenarios, not by this node's own processRequest.
//
// STS has no serviceId in src/data/serviceCatalog.ts at all - like real AWS, it is a control-plane
// API a student never drags onto the canvas, not a drawable resource. This model exists only so
// `registry.ts`/`interaction.ts` have a uniform way to describe it; `resolveServiceModel('sts')`
// works even though no canvas node can ever carry that serviceId.
import type { ServiceModel, ServiceRequestOutcome } from '../types.ts';

export const iamModel: ServiceModel = {
  id: 'iam',
  tier: 1,
  description: 'Identity and Access Management - illustrative in this simulator\'s live traversal (see IAM_GAPS.md); real authorization is evaluated by src/engine/iam/evaluate.ts, not by this node.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome => ({ status: 'success', detail: `${input.target.label} is illustrative only - it does not gate authorization in this simulator's traversal.` }),
  getDependencies: () => [],
  getFailureModes: () => []
};

export const stsModel: ServiceModel = {
  id: 'sts',
  tier: 1,
  description: 'Security Token Service - issues temporary credentials for role assumption (src/engine/iam/roleAssumption.ts). Not a drawable canvas resource, like real AWS.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome => ({ status: 'success', detail: `${input.target.label}: use assumeRole() from src/engine/iam/roleAssumption.ts directly - this model is a registry placeholder only.` }),
  getDependencies: () => [],
  getFailureModes: () => []
};
