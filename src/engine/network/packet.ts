// Packet/connection representation for one hop's network evaluation. Real AWS packets carry real
// IP addresses; this simulator has no per-node IP addressing model (nodes are drawn on an
// infinite canvas, not assigned real interfaces), so `sourceIp`/`destinationIp` here are
// deterministically derived placeholders, not real address data - see
// NETWORK_ENGINE_DEVIATIONS.md. Everything else on this type is real data already present on the
// canvas (serviceId, protocol, node ids/labels, scenario context).
import type { Node } from '@xyflow/react';
import type { ServiceNodeData, SimulationScenario } from '../../types/index.ts';
import type { ConnectionState } from './securityGroup.ts';

export interface PacketEndpoint {
  nodeId: string;
  label: string;
  ip: string;
}

export interface Packet {
  source: PacketEndpoint;
  destination: PacketEndpoint;
  protocol: string;
  sourcePort?: number;
  destinationPort?: number;
  direction: 'inbound' | 'outbound';
  connectionState: ConnectionState;
  /** The destination's serviceId - "which AWS service is this packet ultimately addressed to." */
  service: string;
  requestContext: {
    method?: string;
    path?: string;
    trafficLevel?: string;
  };
}

const DEFAULT_PORTS: Record<string, number> = {
  HTTPS: 443,
  HTTP: 80,
  SQL: 3306,
  DNS: 53,
  gRPC: 443
};

export function defaultPortForProtocol(protocol: string): number | undefined {
  return DEFAULT_PORTS[protocol];
}

/** Deterministic placeholder IP: same node id always yields the same address within one run, so
 *  traces are reproducible, without implying any real IP addressing was modeled. Formatted as a
 *  10.x.x.x address purely so it reads like an RFC1918 private address in trace output. */
export function derivePlaceholderIp(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  }
  const b = (hash >>> 16) & 255;
  const c = (hash >>> 8) & 255;
  const d = hash & 255;
  return `10.${b}.${c}.${d}`;
}

export function buildPacket(
  source: Node<ServiceNodeData>,
  destination: Node<ServiceNodeData>,
  protocol: string,
  scenario: SimulationScenario,
  connectionState: ConnectionState = 'new'
): Packet {
  return {
    source: { nodeId: source.id, label: source.data.label, ip: derivePlaceholderIp(source.id) },
    destination: { nodeId: destination.id, label: destination.data.label, ip: derivePlaceholderIp(destination.id) },
    protocol,
    sourcePort: undefined, // ephemeral client port - real value not modeled, see deviations doc
    destinationPort: defaultPortForProtocol(protocol),
    direction: 'inbound',
    connectionState,
    service: destination.data.serviceId,
    requestContext: {
      method: scenario.method,
      path: scenario.path,
      trafficLevel: scenario.trafficLevel
    }
  };
}
