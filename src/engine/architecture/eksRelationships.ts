import type { Node } from '@xyflow/react';
import { eksComponent } from '../../data/eksComponents.ts';
function role(n: Node<any>): string | undefined {
  const component = eksComponent(n);
  if (component === 'api-endpoint') return 'endpoint';
  if (component && component !== 'control-plane') return component;
  if (n.data.serviceId === 'eks' && n.data.customConfig?.eks?.kind === 'control-plane') return 'endpoint';
  if (n.data.serviceId === 'ec2' && n.data.customConfig?.eksNode) return 'worker';
  if (n.data.serviceId === 'user') return 'admin';
}
function cluster(n: Node<any>): string | undefined {
  return n.data.eksClusterName ?? n.data.customConfig?.eks?.clusterName ?? n.data.customConfig?.eksNode?.clusterName;
}
/** Editable conceptual links, never authorization grants, network verification or API execution. */
export function isEksManagementPair(a?: Node<any>, b?: Node<any>): boolean {
  if (!a || !b || a.id === b.id) return false;
  const from = role(a), to = role(b);
  if (!from || !to) return false;
  const ac = cluster(a), bc = cluster(b);
  if (from !== 'admin' && to !== 'admin' && (!ac || ac !== bc)) return false;
  const pair = [from, to].sort().join(':');
  return ['admin:endpoint', 'api-server:endpoint', 'api-server:etcd', 'api-server:controllers',
    'api-server:cross-account-eni', 'cross-account-eni:worker', 'api-server:scheduler', 'api-server:worker', 'endpoint:worker', 'endpoint:managed-nlb', 'api-server:managed-nlb'].includes(pair);
}
