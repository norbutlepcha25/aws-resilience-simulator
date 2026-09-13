// SQS / SNS: fire-and-forget messaging. Mirrors `adapters/dataTierInteraction.ts`'s queue branch
// exactly - notably, that branch never checks the queue's own health at all (matching SQS/SNS's
// real extremely-high durability characteristics, and this app's existing behavior), so neither
// does this model - see SERVICE_ENGINE_DEVIATIONS.md §4.
import type { ServiceModel, ServiceRequestOutcome } from '../types.ts';

function buildMessagingModel(id: string, description: string): ServiceModel {
  return {
    id,
    tier: 1,
    description,
    validateConfiguration: () => [],
    resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: true, isVpcEndpoint: null }),
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    processRequest: (input): ServiceRequestOutcome => ({
      status: 'success',
      detail: `Message published to ${input.target.label}. Caller decoupled from downstream processing.`
    }),
    getDependencies: () => [],
    getFailureModes: () => [{ id: `${id}-message-processing-failure`, description: 'A consumer fails to process a delivered message.', detectionSystem: 'manual' }]
  };
}

export const sqsModel = buildMessagingModel('sqs', 'Fully managed message queuing for decoupled architectures.');
export const snsModel = buildMessagingModel('sns', 'Fully managed pub/sub messaging and notifications.');
