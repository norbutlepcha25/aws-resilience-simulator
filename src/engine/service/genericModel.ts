// Tier 3 fallback: every service NOT given a dedicated model in models/ gets exactly this -
// metadata, configuration validation (structural only), a dependency model, basic connectivity,
// and an educational description, all read straight from the existing AWSService catalog entry.
// Per this phase's explicit instruction ("do not falsely claim full simulation"), this model's
// `processRequest` performs only the one behavior every service in this simulator has always had
// - a health check - and nothing more. It never invents service-specific success/failure logic.
import type { AWSService } from '../../types/index.ts';
import type { ConfigIssue, EndpointCapabilities, ServiceModel, ServiceNodeSnapshot, ServiceRequestInput, ServiceRequestOutcome } from './types.ts';

export function buildGenericServiceModel(service: AWSService): ServiceModel {
  return {
    id: service.id,
    tier: 3,
    description: service.description,

    validateConfiguration(node: ServiceNodeSnapshot): ConfigIssue[] {
      // Basic connectivity only: a node with no serviceId at all is not a valid configuration.
      // No service-specific structural rules are asserted for a Tier 3 service - that would be
      // exactly the "falsely claim full simulation" this phase was told not to do.
      if (!node.serviceId) {
        return [{ field: 'serviceId', message: 'Node has no serviceId - cannot resolve a service model.' }];
      }
      return [];
    },

    resolveEndpoints(): EndpointCapabilities {
      // Conservative defaults matching how an un-special-cased service already behaves in the
      // live simulator today: no ENI requirement, not an ingress proxy, not an event target, not
      // a VPC endpoint. Any Tier 1/2 service that is one of these overrides it explicitly.
      return { requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null };
    },

    canReceive(): { ok: boolean; reason?: string } {
      return { ok: true };
    },

    canSend(): { ok: boolean; reason?: string } {
      return { ok: true };
    },

    processRequest(input: ServiceRequestInput): ServiceRequestOutcome {
      if (input.target.health === 'failed') {
        return { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` };
      }
      return { status: 'success', detail: `${input.target.label} accepted the request (basic connectivity only - no deep behavioral model for this service).` };
    },

    getDependencies(): string[] {
      return service.dependencies || [];
    },

    getFailureModes() {
      return (service.failureModes || []).map((description, i) => ({
        id: `${service.id}-failure-${i}`,
        description,
        detectionSystem: 'manual' as const
      }));
    }
  };
}
