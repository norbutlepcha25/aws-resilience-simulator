// AWS-accurate CIDR math for auto-carving a VPC's address block into the Public/Private
// subnets a student draws inside it. No subnet CIDR is ever typed by hand - it is always
// derived from the VPC's own CIDR and the number/position of subnets currently inside it,
// the same way `subnet` (public/private/global/unassigned) is derived from geometry rather
// than trusted as free-form data (see containment.ts).

export interface ParsedCidr {
  /** Network address as an unsigned 32-bit integer. */
  base: number;
  /** Prefix length, 0-32. */
  prefix: number;
}

const MIN_AWS_SUBNET_PREFIX = 28; // AWS's smallest allowed subnet: /28 (16 addresses, 11 usable)

export function parseCidr(cidr: string | undefined | null): ParsedCidr | null {
  if (!cidr) return null;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*\/\s*(\d{1,2})$/.exec(cidr.trim());
  if (!match) return null;

  const octets = [1, 2, 3, 4].map(i => Number(match[i]));
  if (octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return null;

  const prefix = Number(match[5]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const base = octets[0] * 16777216 + octets[1] * 65536 + octets[2] * 256 + octets[3];
  return { base, prefix };
}

export function formatCidr(base: number, prefix: number): string {
  const clamped = base >>> 0;
  const o1 = Math.floor(clamped / 16777216) % 256;
  const o2 = Math.floor(clamped / 65536) % 256;
  const o3 = Math.floor(clamped / 256) % 256;
  const o4 = clamped % 256;
  return `${o1}.${o2}.${o3}.${o4}/${prefix}`;
}

export function formatIp(base: number): string {
  const clamped = base >>> 0;
  const o1 = Math.floor(clamped / 16777216) % 256;
  const o2 = Math.floor(clamped / 65536) % 256;
  const o3 = Math.floor(clamped / 256) % 256;
  const o4 = clamped % 256;
  return `${o1}.${o2}.${o3}.${o4}`;
}

export interface ReservedAddress {
  ip: string;
  offset: number;
  role: string;
  description: string;
}

export interface SubnetCidrAllocation {
  cidr: string | null;
  totalAddresses: number | null;
  usableHosts: number | null;
  reservedAddresses: ReservedAddress[];
  usableRange: { start: string; end: string } | null;
  error: string | null;
}

/**
 * Returns the exact 5 addresses AWS reserves in every subnet:
 * 1. Base + 0: Network address
 * 2. Base + 1: Reserved by AWS for VPC router
 * 3. Base + 2: Reserved by AWS for Amazon-provided DNS (Route 53 Resolver)
 * 4. Base + 3: Reserved by AWS for future use
 * 5. Base + (blockSize - 1): Network broadcast address (AWS does not support broadcast, but reserves it)
 */
export function getReservedAddresses(subnetBase: number, prefix: number): ReservedAddress[] {
  const blockSize = 2 ** (32 - prefix);
  if (prefix >= 31) return [];

  return [
    {
      ip: formatIp(subnetBase),
      offset: 0,
      role: 'Network Address',
      description: 'First address in the subnet. Identifies the network itself.'
    },
    {
      ip: formatIp(subnetBase + 1),
      offset: 1,
      role: 'VPC Router',
      description: 'Reserved by AWS for the default VPC router / subnet gateway.'
    },
    {
      ip: formatIp(subnetBase + 2),
      offset: 2,
      role: 'Amazon-Provided DNS',
      description: 'Reserved by AWS for the DNS resolver (Route 53 Resolver / AmazonProvidedDNS).'
    },
    {
      ip: formatIp(subnetBase + 3),
      offset: 3,
      role: 'AWS Future Use',
      description: 'Reserved by AWS for potential future internal functionality.'
    },
    {
      ip: formatIp(subnetBase + blockSize - 1),
      offset: blockSize - 1,
      role: 'Network Broadcast Address',
      description: 'Last address in the subnet. AWS does not support broadcast in a VPC, but reserves the address.'
    }
  ];
}

/**
 * Returns the first and last usable host IPs (Base + 4 through Base + blockSize - 2).
 */
export function getUsableIpRange(subnetBase: number, prefix: number): { start: string; end: string } | null {
  const blockSize = 2 ** (32 - prefix);
  if (prefix > 30 || blockSize <= 5) return null;
  return {
    start: formatIp(subnetBase + 4),
    end: formatIp(subnetBase + blockSize - 2)
  };
}

/**
 * Splits a VPC's CIDR block into `subnetIds.length` equal-sized, non-overlapping subnet
 * blocks, in the order the ids are given (callers sort public subnets before private, each
 * left-to-right/top-to-bottom, so allocation is stable as subnets are added or moved).
 *
 * The split size is chosen as the smallest power-of-two count of equal blocks that covers
 * every subnet (e.g. 3 subnets -> 4 equal blocks, 1 used as spare capacity) - the same even
 * split convention AWS's own VPC wizard and most reference architectures use. If that split
 * would require a subnet smaller than AWS's real /28 minimum, every subnet is reported with
 * an error instead of silently producing an invalid block.
 */
export function allocateSubnetCidrs(
  vpcCidr: string | undefined | null,
  subnetIds: string[]
): Map<string, SubnetCidrAllocation> {
  const result = new Map<string, SubnetCidrAllocation>();
  if (subnetIds.length === 0) return result;

  const parsedVpc = parseCidr(vpcCidr);
  if (!parsedVpc) {
    const error = `VPC has no valid CIDR block set (got "${vpcCidr ?? ''}"). Set one like 10.0.0.0/16 on the VPC boundary.`;
    subnetIds.forEach(id => result.set(id, {
      cidr: null,
      totalAddresses: null,
      usableHosts: null,
      reservedAddresses: [],
      usableRange: null,
      error
    }));
    return result;
  }

  const { base: vpcBase, prefix: vpcPrefix } = parsedVpc;

  if (vpcPrefix > MIN_AWS_SUBNET_PREFIX) {
    const error = `VPC CIDR /${vpcPrefix} is smaller than AWS's minimum VPC/subnet size of /${MIN_AWS_SUBNET_PREFIX}.`;
    subnetIds.forEach(id => result.set(id, {
      cidr: null,
      totalAddresses: null,
      usableHosts: null,
      reservedAddresses: [],
      usableRange: null,
      error
    }));
    return result;
  }

  const n = subnetIds.length;
  let splitBits = 0;
  while (2 ** splitBits < n) splitBits++;
  const subnetPrefix = vpcPrefix + splitBits;

  if (subnetPrefix > MIN_AWS_SUBNET_PREFIX) {
    const maxSubnets = 2 ** (MIN_AWS_SUBNET_PREFIX - vpcPrefix);
    const error = `This VPC (/${vpcPrefix}) can hold at most ${maxSubnets} equally-sized AWS-valid subnet(s) - splitting it evenly into ${n} would require /${subnetPrefix} subnets, smaller than AWS's /${MIN_AWS_SUBNET_PREFIX} minimum. Use a larger VPC CIDR or create fewer subnets.`;
    subnetIds.forEach(id => result.set(id, {
      cidr: null,
      totalAddresses: null,
      usableHosts: null,
      reservedAddresses: [],
      usableRange: null,
      error
    }));
    return result;
  }

  const blockSize = 2 ** (32 - subnetPrefix);
  const usableHosts = subnetPrefix === 32 ? 0 : Math.max(0, blockSize - 5); // AWS reserves 5 addresses per subnet

  subnetIds.forEach((id, index) => {
    const subnetBase = vpcBase + index * blockSize;
    result.set(id, {
      cidr: formatCidr(subnetBase, subnetPrefix),
      totalAddresses: blockSize,
      usableHosts,
      reservedAddresses: getReservedAddresses(subnetBase, subnetPrefix),
      usableRange: getUsableIpRange(subnetBase, subnetPrefix),
      error: null
    });
  });

  return result;
}

