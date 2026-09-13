import type { Packet } from './packet.ts';
import type { RouteResolution } from './routeTable.ts';
import type { NaclEvaluation } from './nacl.ts';
import type { SecurityGroupDecision } from './securityGroup.ts';

/** The full, structured record of one hop's network decision - everything needed to answer "what
 *  was decided, and why" for a single packet: which route was selected (if route resolution was
 *  performed), what the NACL decided, what the Security Group decided, and the final verdict.
 *  Any of `route`/`nacl`/`securityGroup` may be absent - a hop only carries the layers that were
 *  actually evaluated for it (e.g. a fully-managed serverless target has no route or NACL layer
 *  at all), exactly like the existing `FirewallLayerResult.evaluated` flag already models. */
export interface NetworkDecisionTrace {
  packet: Packet;
  route?: RouteResolution;
  nacl?: NaclEvaluation;
  securityGroup?: SecurityGroupDecision;
  allowed: boolean;
  /** Which layer produced the final denial, if any - lets a caller point at the exact reason
   *  without re-deriving it from the three optional fields above. */
  deniedBy?: 'route' | 'nacl' | 'securityGroup';
}
