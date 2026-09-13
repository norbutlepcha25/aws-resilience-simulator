import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import type { RequestTrace, TraceEntry } from './types.ts';
import { explainHop, finalizeTrace } from './explainHop.ts';

/**
 * Composes `explainHop` across an entire ordered request path (source -> ... -> destination),
 * renumbering `order` into one continuous sequence. Stops at the first hop that would actually
 * block the request - exactly like a real request halts at the first denial - so the trace never
 * shows steps for hops the request would never actually reach.
 */
export function explainRequest(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  path: Node<ServiceNodeData>[],
  protocolForHop: (source: Node<ServiceNodeData>, target: Node<ServiceNodeData>) => string,
  opts?: { port?: number; action?: string }
): RequestTrace {
  const entries: TraceEntry[] = [];
  let orderOffset = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const source = path[i];
    const target = path[i + 1];
    const protocol = protocolForHop(source, target);

    const hopEntries = explainHop(nodes, edges, source, target, protocol, opts).map(e => ({
      ...e,
      order: orderOffset + e.order
    }));
    orderOffset += hopEntries.length;
    entries.push(...hopEntries);

    const hopVerdict = finalizeTrace(hopEntries);
    if (hopVerdict.final === 'DENIED') break; // request halts here - no further hop would be reached
  }

  const { final, why } = finalizeTrace(entries);
  return { entries, final, why };
}

/** Convenience wrapper for the common case of a single edge's own declared protocol driving every
 *  hop in `path` (the typical simulated-request shape) - looks the protocol up per hop from
 *  `edges` instead of requiring the caller to resolve it themselves. */
export function explainRequestAlongEdges(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  path: Node<ServiceNodeData>[],
  opts?: { port?: number; action?: string }
): RequestTrace {
  return explainRequest(nodes, edges, path, (source, target) => {
    const edge = edges.find(e => e.source === source.id && e.target === target.id);
    return (edge?.data as any)?.protocol || 'TCP';
  }, opts);
}
