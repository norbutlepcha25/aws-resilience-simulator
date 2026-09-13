import type { Node } from '@xyflow/react';
import type { ServiceNodeData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { resolveServiceModel } from '../service/registry.ts';
import type { ServiceNodeSnapshot } from '../service/types.ts';

function toSnapshot(node: Node<ServiceNodeData>): ServiceNodeSnapshot {
  return {
    serviceId: node.data.serviceId,
    label: node.data.label,
    health: node.data.health,
    subnet: node.data.subnet,
    az: node.data.az,
    replicas: node.data.replicas,
    multiAz: node.data.multiAz,
    securityGroupIds: node.data.securityGroupIds,
    customConfig: node.data.customConfig
  };
}

/**
 * Delegates to each service's own `ServiceModel.validateConfiguration` (the Phase 7 Service
 * Behavior Engine, `engine/service/models/*.ts`) rather than re-deriving structural rules a third
 * time - it already encodes per-service structural requirements (e.g. RDS/ElastiCache/ALB/EC2
 * needing a real subnet, a NAT Gateway needing a public one) with no fabricated behavior for
 * services that have none.
 */
export function validateServiceConfigurations(nodes: Node<ServiceNodeData>[]): Finding[] {
  const findings: Finding[] = [];
  const serviceNodes = nodes.filter(n => n.type !== 'boundaryNode');

  for (const node of serviceNodes) {
    const model = resolveServiceModel(node.data.serviceId);
    if (!model) continue;

    const issues = model.validateConfiguration(toSnapshot(node));
    for (const issue of issues) {
      findings.push(makeFinding('validation', 'service_config', {
        severity: 'HIGH',
        resource: node.data.label,
        resourceId: node.id,
        problem: issue.message,
        whyItMatters: `${node.data.label}'s "${issue.field}" configuration does not meet this service's structural requirements, so it cannot function as configured.`,
        awsRule: `AWS ${node.data.label} configuration requirement on "${issue.field}".`,
        recommendation: `Fix ${node.data.label}'s ${issue.field} configuration.`
      }));
    }
  }

  return findings;
}
