// Data tier models: S3 (bucket/object/ARN), RDS + Aurora (endpoint, Multi-AZ failover), DynamoDB.
// The Multi-AZ failover rule mirrors `adapters/dataTierInteraction.ts` exactly: `isMultiAzDb` is
// true only when the node's own `multiAz` flag or `az === 'Multi-AZ'` is set, or the serviceId is
// `aurora` (Aurora's storage layer is always multi-AZ under the hood). DynamoDB is NOT
// automatically treated as multi-AZ here, even though real DynamoDB always replicates across AZs
// - this preserves a pre-existing simplification in the adapter this model is documented against
// rather than silently changing it; see SERVICE_ENGINE_DEVIATIONS.md §3.
//
// Cache-fallback (a failed DB + a healthy ElastiCache sibling) is deliberately NOT modeled here -
// it is the CALLING compute node's circuit-breaker behavior, not something the database itself
// does, so it belongs in `interaction.ts`'s composition, not in this model.
import type { ConfigIssue, EndpointCapabilities, ServiceModel, ServiceNodeSnapshot, ServiceRequestInput, ServiceRequestOutcome } from '../types.ts';

function isMultiAzDb(node: ServiceNodeSnapshot): boolean {
  return !!node.multiAz || node.az === 'Multi-AZ' || node.serviceId === 'aurora';
}

function dbProcessRequest(input: ServiceRequestInput): ServiceRequestOutcome {
  if (input.target.health !== 'failed') {
    return { status: 'success', detail: `${input.target.label} accepted the query.` };
  }

  if (isMultiAzDb(input.target)) {
    return {
      status: 'success',
      detail: `${input.target.label}'s primary failed; Multi-AZ automated failover promoted the standby replica to primary.`,
      recoveryApplied: 'Multi-AZ automated failover restored database connectivity without data loss.'
    };
  }

  return { status: 'failure', statusCode: 504, reason: `${input.target.label} is offline and has no Multi-AZ standby replica.` };
}

function buildDataModel(id: string, description: string, dependencies: string[]): ServiceModel {
  return {
    id,
    tier: 1,
    description,
    validateConfiguration(node: ServiceNodeSnapshot): ConfigIssue[] {
      if (id !== 's3' && id !== 'dynamodb' && node.subnet === 'unassigned') {
        return [{ field: 'subnet', message: `${id} must be placed inside a VPC subnet.` }];
      }
      return [];
    },
    resolveEndpoints(): EndpointCapabilities {
      // S3 and DynamoDB are fully-managed regional endpoints with no ENI; RDS/Aurora run inside
      // a customer VPC subnet with a real ENI, exactly like an EC2 instance.
      const requiresEni = id === 'rds' || id === 'aurora';
      return { requiresEni, isIngressProxy: false, isManagedEventTarget: id === 's3', isVpcEndpoint: null };
    },
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    // S3 was never part of the original adapter's DB_SERVICE_IDS grouping - a failed S3 node
    // falls through to the generic top-level health check (503), never the DB-specific 504
    // "no Multi-AZ replica" message. DynamoDB WAS grouped with RDS/Aurora in the original adapter,
    // so it keeps following the same (approximated) DB rule - see the module comment above.
    processRequest: id === 's3'
      ? (input: ServiceRequestInput): ServiceRequestOutcome =>
          input.target.health === 'failed'
            ? { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` }
            : { status: 'success', detail: `${input.target.label} served the request.` }
      : dbProcessRequest,
    getDependencies: () => dependencies,
    getFailureModes: () => [
      { id: `${id}-availability`, description: `${description} availability degradation.`, detectionSystem: 'manual' }
    ]
  };
}

export const s3Model = buildDataModel('s3', 'Scalable object storage for any amount of data.', []);
export const rdsModel = buildDataModel('rds', 'Managed relational database service.', []);
export const auroraModel = buildDataModel('aurora', 'MySQL/PostgreSQL-compatible managed relational database with distributed storage.', []);
export const dynamodbModel = buildDataModel('dynamodb', 'Fully managed key-value and document NoSQL database.', []);
