/**
 * The shared finding vocabulary for Phase 10. Three genuinely different questions get asked about
 * an architecture, and this engine keeps them in three separate outputs rather than blending them:
 *
 *   1. VALID CONFIGURATION  - `engine/validation`. Is this legal, well-formed AWS config? (a CIDR
 *      that parses, a subnet a resource can actually live in, a route that exists, a security rule
 *      with valid syntax, an IAM trust policy that actually names its caller.) A configuration can
 *      be perfectly valid and still be a terrible architecture - see `nacl_denial` etc.
 *   2. SUCCESSFUL REQUEST   - `engine/simulation`/`runSimulation` (already exists, unchanged).
 *      Did *this* traced request reach its destination? Independent of both the above.
 *   3. GOOD ARCHITECTURE    - `engine/analysis` (`architecturalFindings.ts`, plus the pre-existing
 *      `rulesEngine.ts` scores). Is this a well-designed system? SPOFs, bottlenecks, public
 *      exposure, missing redundancy, dependency concentration, blast radius - all of these can (and
 *      often do) show up on top of perfectly *valid* configuration.
 *
 * Every finding from either engine is reported in the same shape so a single UI can list them
 * side by side, tagged with which question it answers (`category`).
 */

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type FindingCategory = 'validation' | 'architecture';

export interface Finding {
  id: string;
  /** Which of the three questions above this finding answers - never "good architecture" from the
   *  validation engine, and never "is this legal config" from the analysis engine. */
  category: FindingCategory;
  /** e.g. 'cidr', 'placement', 'routing', 'nacl', 'security_group', 'iam', 'dependency',
   *  'service_config', 'spof', 'bottleneck', 'public_exposure', 'redundancy',
   *  'dependency_concentration', 'blast_radius'. */
  subcategory: string;
  severity: FindingSeverity;
  /** Human-readable resource name (node/boundary label), as the spec's own example shows. */
  resource: string;
  resourceId?: string;
  problem: string;
  whyItMatters: string;
  /** The concrete AWS rule/mechanism this finding is grounded in - never a vague "this is bad". */
  awsRule: string;
  recommendation: string;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeFinding(
  category: FindingCategory,
  subcategory: string,
  fields: Omit<Finding, 'id' | 'category' | 'subcategory'>
): Finding {
  return { id: nextId(`${category}-${subcategory}`), category, subcategory, ...fields };
}
