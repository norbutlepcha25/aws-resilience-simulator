import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SPOFItem } from '../../types/index.ts';

export function detectSPOFs(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): SPOFItem[] {
  const spofs: SPOFItem[] = [];

  // 1. Check Compute Redundancy
  const computeNodes = nodes.filter(n => ['ecs', 'ec2'].includes(n.data.serviceId));
  const totalComputeInstances = computeNodes.reduce((sum, n) => sum + (n.data.replicas || 1), 0);

  if (computeNodes.length === 1 && totalComputeInstances === 1) {
    const singleNode = computeNodes[0];
    spofs.push({
      nodeId: singleNode.id,
      nodeName: singleNode.data.label,
      serviceId: singleNode.data.serviceId,
      category: singleNode.data.category,
      impactLevel: 'CRITICAL',
      impactPath: ['Client', singleNode.data.label, 'Database'],
      explanation: `Your architecture relies on a single ${singleNode.data.label} instance with zero redundancy. If this host encounters a crash, out-of-memory error, or AWS hardware retirement, all incoming user traffic fails completely.`,
      mitigation: 'Place an Application Load Balancer in front of your compute and configure at least 2 replicas distributed across AZ-A and AZ-B.'
    });
  }

  // 2. Check Database Multi-AZ Redundancy
  const rdsNodes = nodes.filter(n => n.data.serviceId === 'rds');
  for (const rds of rdsNodes) {
    if (!rds.data.multiAz && (rds.data.replicas || 1) <= 1) {
      spofs.push({
        nodeId: rds.id,
        nodeName: rds.data.label,
        serviceId: 'rds',
        category: 'Databases',
        impactLevel: 'CRITICAL',
        impactPath: ['Client', 'Compute', `❌ ${rds.data.label}`],
        explanation: 'Your application depends on a Single-AZ database instance. A storage degradation, patching reboot, or Availability Zone failure will render the entire application unable to read or write data.',
        mitigation: 'Enable Amazon RDS Multi-AZ deployment. This provisions a synchronous standby replica in a second Availability Zone with automatic 60-second DNS failover.'
      });
    }
  }

  // 3. Check Direct Compute without Load Balancer
  const clientNode = nodes.find(n => n.data.serviceId === 'user');
  if (clientNode) {
    const clientOutgoing = edges.filter(e => e.source === clientNode.id);
    for (const edge of clientOutgoing) {
      const targetNode = nodes.find(n => n.id === edge.target);
      if (targetNode && ['ec2', 'ecs'].includes(targetNode.data.serviceId)) {
        spofs.push({
          nodeId: targetNode.id,
          nodeName: targetNode.data.label,
          serviceId: targetNode.data.serviceId,
          category: targetNode.data.category,
          impactLevel: 'HIGH',
          impactPath: ['Client', `Direct -> ${targetNode.data.label}`],
          explanation: `Traffic flows directly from client to ${targetNode.data.label} without an Application Load Balancer or API Gateway. Traffic cannot be dynamically balanced across healthy instances during a failure.`,
          mitigation: 'Route traffic through an Application Load Balancer (ALB) to enable health-checked routing, SSL termination, and horizontal scale-out.'
        });
      }
    }
  }

  // 4. Check Single NAT Gateway for multi-AZ private subnets
  const natGateways = nodes.filter(n => n.data.serviceId === 'nat_gateway');
  const privateSubnetNodes = nodes.filter(n => n.data.subnet === 'private');
  if (natGateways.length === 1 && privateSubnetNodes.length > 2) {
    const nat = natGateways[0];
    spofs.push({
      nodeId: nat.id,
      nodeName: nat.data.label,
      serviceId: 'nat_gateway',
      category: 'Networking',
      impactLevel: 'MEDIUM',
      impactPath: ['Private Subnet Instances', `❌ ${nat.data.label}`, 'Internet'],
      explanation: 'All private subnet instances route outbound traffic through a single NAT Gateway. If that gateway or its availability zone fails, outbound API calls and security updates from private instances are halted.',
      mitigation: 'Deploy one NAT Gateway per Availability Zone and configure subnet route tables accordingly.'
    });
  }

  return spofs;
}
