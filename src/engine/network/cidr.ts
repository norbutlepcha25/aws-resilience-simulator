// CIDR math shared by the whole networking engine (route resolution, NACL/SG source matching).
// Deliberately reuses cidrAllocator.ts's parsing/formatting instead of re-implementing it, so
// there is exactly one CIDR parser in the codebase.
import { parseCidr, formatCidr, type ParsedCidr } from '../layout/cidrAllocator.ts';

export { parseCidr, formatCidr, type ParsedCidr };

/** The all-traffic / all-addresses CIDR - used as the synthetic source when a request's true
 *  client IP is not modeled (see NETWORK_ENGINE_DEVIATIONS.md). */
export const ANY_CIDR = '0.0.0.0/0';

function networkRange(parsed: ParsedCidr): { start: number; end: number } {
  const blockSize = parsed.prefix >= 32 ? 1 : 2 ** (32 - parsed.prefix);
  const start = parsed.base >>> 0;
  return { start, end: (start + blockSize - 1) >>> 0 };
}

/** True if `outer` (a CIDR block) fully contains `inner` (a CIDR block or a bare IP). A bare IP
 *  is treated as a /32. Returns false for any unparsable input rather than throwing. */
export function cidrContains(outer: string, innerCidrOrIp: string): boolean {
  const outerParsed = parseCidr(outer);
  const innerParsed = parseCidr(innerCidrOrIp.includes('/') ? innerCidrOrIp : `${innerCidrOrIp}/32`);
  if (!outerParsed || !innerParsed) return false;
  if (innerParsed.prefix < outerParsed.prefix) return false; // inner is broader than outer - can't be contained

  const outerRange = networkRange(outerParsed);
  const innerRange = networkRange(innerParsed);
  return innerRange.start >= outerRange.start && innerRange.end <= outerRange.end;
}

/** True if two CIDR blocks share any address at all (in either direction of containment). */
export function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb) return false;
  const ra = networkRange(pa);
  const rb = networkRange(pb);
  return ra.start <= rb.end && rb.start <= ra.end;
}

/**
 * Longest-prefix-match: given a set of candidate CIDRs that are known to contain `destination`,
 * returns the most specific (highest prefix length) one. Real AWS route tables resolve exactly
 * this way - a more specific route always wins over a broader one, regardless of table order.
 */
export function pickMostSpecific<T extends { cidr: string }>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    const bestPrefix = parseCidr(best.cidr)?.prefix ?? -1;
    const candidatePrefix = parseCidr(candidate.cidr)?.prefix ?? -1;
    return candidatePrefix > bestPrefix ? candidate : best;
  });
}

export interface PortRange {
  min: number;
  max: number;
}

/** Parses a port-range string as used throughout this app's NACL/SG rule data: a single port
 *  ('443'), a range ('1024-65535'), or the literal 'All'/'ALL' meaning every port. Unparsable
 *  input is treated as 'All' so a malformed rule fails open to "matches everything" rather than
 *  silently never matching (a rule that can never match is a worse simulator bug than one that
 *  over-matches, since it would look configured but do nothing). */
export function parsePortRange(portRange: string | undefined): PortRange {
  if (!portRange || /^all$/i.test(portRange.trim())) return { min: 0, max: 65535 };
  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(portRange.trim());
  if (rangeMatch) return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  const single = Number(portRange.trim());
  if (Number.isInteger(single)) return { min: single, max: single };
  return { min: 0, max: 65535 };
}

export function portInRange(port: number | undefined, range: PortRange): boolean {
  if (port === undefined) return true; // no specific port requested - treat as "any port in range"
  return port >= range.min && port <= range.max;
}
