// Deterministic route resolution: given a Route Table and a destination, picks exactly the route
// real AWS would pick (longest-prefix-match), and explains why every other candidate route was
// not selected. This is new, additive infrastructure (docs/target-architecture/NETWORK_ENGINE.md
// §4/§Phase-4) - nothing in the existing simulator constructs a RouteTable today, so this module
// has zero effect on any existing reference architecture until a caller opts in by attaching
// `data.routeTable` to a VPC or subnet boundary node.
import { cidrContains, parseCidr, pickMostSpecific } from './cidr.ts';

export type RouteTargetType = 'local' | 'igw' | 'nat' | 'vpce' | 'peering' | 'tgw';

export interface RouteTarget {
  type: RouteTargetType;
  /** id of the node this route points at (an Internet Gateway node, a NAT Gateway node, ...). */
  targetId?: string;
  label?: string;
}

export interface Route {
  destinationCidr: string;
  target: RouteTarget;
}

export interface RouteTable {
  id: string;
  label?: string;
  routes: Route[];
}

export interface RouteAlternative {
  route: Route;
  whyNotSelected: string;
}

export interface RouteResolution {
  destination: string;
  /** The route actually selected, or null if no route in the table covers the destination. */
  selectedRoute: Route | null;
  /** Human-readable reason the selected route matched (or why nothing matched). */
  reason: string;
  /** Every other route in the table, each with why it lost out to the selected route (or, when
   *  nothing matched, why it doesn't apply at all). Always present, even when empty. */
  alternatives: RouteAlternative[];
}

/**
 * Resolves a destination (a CIDR or a bare IP, treated as /32) against a route table using
 * longest-prefix-match - the same algorithm real AWS VPC route tables use. Deterministic: given
 * the same table and destination, always returns the same route, regardless of the routes'
 * array order.
 */
export function resolveRoute(routeTable: RouteTable, destination: string): RouteResolution {
  if (!parseCidr(destination.includes('/') ? destination : `${destination}/32`)) {
    return {
      destination,
      selectedRoute: null,
      reason: `"${destination}" is not a valid IP or CIDR - cannot resolve a route for it.`,
      alternatives: routeTable.routes.map(route => ({
        route,
        whyNotSelected: 'Destination itself is invalid; no route can be evaluated against it.'
      }))
    };
  }

  const candidates = routeTable.routes.filter(r => cidrContains(r.destinationCidr, destination));

  if (candidates.length === 0) {
    return {
      destination,
      selectedRoute: null,
      reason: `No route in ${routeTable.label || routeTable.id} covers ${destination} - not even a default route (0.0.0.0/0) is configured. Traffic to this destination has no path and is dropped.`,
      alternatives: routeTable.routes.map(route => ({
        route,
        whyNotSelected: `${route.destinationCidr} does not contain ${destination}.`
      }))
    };
  }

  const selected = pickMostSpecific(candidates.map(r => ({ cidr: r.destinationCidr, route: r })))!.route;
  const selectedPrefix = parseCidr(selected.destinationCidr)!.prefix;

  const alternatives: RouteAlternative[] = routeTable.routes
    .filter(r => r !== selected)
    .map(route => {
      if (!cidrContains(route.destinationCidr, destination)) {
        return { route, whyNotSelected: `${route.destinationCidr} does not contain ${destination}.` };
      }
      const prefix = parseCidr(route.destinationCidr)!.prefix;
      return {
        route,
        whyNotSelected: `${route.destinationCidr} (/${prefix}) also matches, but ${selected.destinationCidr} (/${selectedPrefix}) is more specific (longer prefix) - AWS always prefers the most specific matching route.`
      };
    });

  const targetDescription = selected.target.label || selected.target.targetId || selected.target.type;
  return {
    destination,
    selectedRoute: selected,
    reason: `${selected.destinationCidr} -> ${selected.target.type} (${targetDescription}) is the most specific route covering ${destination}.`,
    alternatives
  };
}

/** Builds the conventional two-route table a public subnet has in real AWS: a local route for
 *  the VPC's own CIDR, and a default route (0.0.0.0/0) out to the Internet Gateway. Convenience
 *  used by both the engine's own tests and any future UI wiring - not required to construct a
 *  valid RouteTable by hand. */
export function buildPublicRouteTable(id: string, vpcCidr: string, igwNodeId: string, igwLabel?: string): RouteTable {
  return {
    id,
    label: 'Public Route Table',
    routes: [
      { destinationCidr: vpcCidr, target: { type: 'local', label: 'local' } },
      { destinationCidr: '0.0.0.0/0', target: { type: 'igw', targetId: igwNodeId, label: igwLabel || 'Internet Gateway' } }
    ]
  };
}

/** Builds the conventional private-subnet route table: a local route plus a default route out
 *  through a NAT Gateway (egress-only - a NAT Gateway never accepts inbound-initiated traffic). */
export function buildPrivateRouteTable(id: string, vpcCidr: string, natNodeId: string, natLabel?: string): RouteTable {
  return {
    id,
    label: 'Private Route Table',
    routes: [
      { destinationCidr: vpcCidr, target: { type: 'local', label: 'local' } },
      { destinationCidr: '0.0.0.0/0', target: { type: 'nat', targetId: natNodeId, label: natLabel || 'NAT Gateway' } }
    ]
  };
}
