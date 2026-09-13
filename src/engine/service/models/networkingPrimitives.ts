// Networking primitive services that DO have a catalog serviceId (unlike Subnet/Security
// Group/NACL, which are boundary/config constructs modeled entirely by
// src/engine/network/ (Phase 5) and src/engine/layout/containment.ts, with no ServiceModel of
// their own - see SERVICE_ENGINE_DEVIATIONS.md §1): VPC, Internet Gateway, NAT Gateway, the
// decorative Route Table node, and the two VPC Endpoint types.
import { validateNatGatewayPlacement } from '../../network/nat.ts';
import type { ServiceModel, ServiceRequestOutcome } from '../types.ts';

export const vpcModel: ServiceModel = {
  id: 'vpc',
  tier: 1,
  description: 'Isolated virtual network - the address-space container every subnet is carved from.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: false, reason: 'A VPC is an address-space container, not a traffic endpoint - traffic never terminates AT the VPC node itself.' }),
  canSend: () => ({ ok: false, reason: 'A VPC does not originate traffic.' }),
  processRequest: (input): ServiceRequestOutcome => ({ status: 'success', detail: `${input.target.label} is a structural container, not a traffic participant.` }),
  getDependencies: () => [],
  getFailureModes: () => []
};

export const internetGatewayModel: ServiceModel = {
  id: 'internet_gateway',
  tier: 1,
  description: 'Horizontally scaled, redundant VPC component enabling internet connectivity for public subnets.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome =>
    input.target.health === 'failed'
      ? { status: 'failure', statusCode: 504, reason: `${input.target.label} is offline - the VPC has lost its only path to and from the internet.` }
      : { status: 'success', detail: `${input.target.label} routed traffic between the VPC and the internet.` },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'igw-outage', description: 'Internet Gateway becomes unreachable (AWS-managed, redundant by design - modeled here purely as an educational failure toggle).', detectionSystem: 'manual' }]
};

export const natGatewayModel: ServiceModel = {
  id: 'nat_gateway',
  tier: 1,
  description: 'Managed NAT service allowing private-subnet resources outbound-only internet access.',
  validateConfiguration(node) {
    const decision = validateNatGatewayPlacement(node.label, node.subnet);
    return decision.outcome === 'misplaced' ? [{ field: 'subnet', message: decision.explanation }] : [];
  },
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome => {
    const decision = validateNatGatewayPlacement(input.target.label, input.target.subnet);
    if (decision.outcome === 'misplaced') return { status: 'failure', statusCode: decision.statusCode, reason: decision.explanation };
    if (input.target.health === 'failed') return { status: 'failure', statusCode: 504, reason: `${input.target.label} is offline - private subnet egress dropped.` };
    return { status: 'success', detail: decision.explanation };
  },
  getDependencies: () => ['internet_gateway'],
  getFailureModes: () => [{ id: 'nat-outage', description: 'NAT Gateway becomes unreachable.', detectionSystem: 'manual' }]
};

/** Decorative in this simulator - no real Route Table entity exists yet (Phase 4 of
 *  docs/target-architecture/MIGRATION_PLAN.md, reserved but unimplemented). Mirrors the
 *  precedent already set for the Thumbnail Generator's decorative `iam` node (test 46): present
 *  for architectural completeness, never load-bearing. */
export const routeTablesModel: ServiceModel = {
  id: 'route_tables',
  tier: 1,
  description: 'Route Table (illustrative in this simulator - see NETWORKING_GAPS.md; real route resolution is not yet wired to the canvas).',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest: (input): ServiceRequestOutcome => ({ status: 'success', detail: `${input.target.label} is illustrative only in this simulator - it does not gate routing decisions.` }),
  getDependencies: () => [],
  getFailureModes: () => []
};

function buildVpcEndpointModel(id: string, kind: 'gateway' | 'interface', description: string): ServiceModel {
  return {
    id,
    tier: 2,
    description,
    validateConfiguration: () => [],
    resolveEndpoints: () => ({ requiresEni: kind === 'interface', isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: kind }),
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    processRequest: (input): ServiceRequestOutcome =>
      input.target.health === 'failed'
        ? { status: 'failure', statusCode: 504, reason: `${input.target.label} is offline.` }
        : { status: 'success', detail: `${input.target.label} routed the request over the AWS private backbone - zero internet exposure.` },
    getDependencies: () => [],
    getFailureModes: () => []
  };
}

export const s3GatewayEndpointModel = buildVpcEndpointModel('s3_gateway_endpoint', 'gateway', 'Gateway VPC Endpoint for S3/DynamoDB - route-table-based, no ENI, no charge.');
export const privateLinkModel = buildVpcEndpointModel('privatelink', 'interface', 'Interface VPC Endpoint (AWS PrivateLink) - ENI-based, billed, subject to Security Groups.');
