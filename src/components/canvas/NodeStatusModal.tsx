import React from 'react';
import { Node } from '@xyflow/react';
import { ServiceNodeData, NodeHealth, AvailabilityZone, SubnetType } from '../../types';
import { SERVICE_MAP } from '../../data/serviceCatalog';
import { AwsServiceIcon } from '../icons/AwsServiceIcons';
import { useArchitecture } from '../../context/ArchitectureContext';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Server,
  Network,
  Activity,
  ArrowRight,
  BookOpen
} from 'lucide-react';

interface NodeStatusModalProps {
  node: Node<ServiceNodeData> | null;
  isOpen: boolean;
  onClose: () => void;
}

export const NodeStatusModal: React.FC<NodeStatusModalProps> = ({
  node,
  isOpen,
  onClose
}) => {
  const {
    nodes,
    edges,
    duplicateNode,
    removeNode,
    setNodeHealth,
    analysis
  } = useArchitecture();

  if (!isOpen || !node || node.type === 'boundaryNode' || !(node.data as any)?.serviceId) return null;

  const nodeData = node.data || ({} as any);
  const serviceDef = SERVICE_MAP[nodeData.serviceId] || {
    name: nodeData.label || 'AWS Service',
    category: nodeData.category || 'Compute',
    architecturalRole: 'Cloud service component',
    description: 'Managed AWS component',
    failureModes: ['Instance failure', 'Quota exhaustion'],
    resilienceCharacteristics: ['AWS managed multi-AZ resilience'],
    scalabilityCharacteristics: ['Elastic auto-scaling']
  };

  // Find incoming & outgoing connections
  const incomingEdges = edges.filter(e => e.target === node.id);
  const outgoingEdges = edges.filter(e => e.source === node.id);

  // Check if this node is identified as a Single Point of Failure (SPOF)
  const isSpof = analysis.spofs.some(spof => spof.nodeId === node.id);
  const spofDetail = analysis.spofs.find(spof => spof.nodeId === node.id);

  const isHealthy = nodeData.health === 'healthy';
  const isDegraded = nodeData.health === 'degraded';
  const isFailed = nodeData.health === 'failed';

  const handleDuplicate = () => {
    duplicateNode(node.id);
    onClose();
  };

  const handleRemove = () => {
    removeNode(node.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-start justify-between bg-white">
          <div className="flex items-center gap-3.5">
            <div className="p-1 rounded-xl bg-white border border-slate-200 shadow-xs flex-shrink-0">
              <AwsServiceIcon serviceId={nodeData.serviceId} size={48} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900 leading-tight">
                  {nodeData.label}
                </h2>
                <span className="text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {serviceDef.category}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Service ID: <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">{node.id}</code>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar text-sm bg-white">
          {/* Section 1: Real-time Operational Status */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-slate-500" />
              Live Operational Status
            </h3>

            <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600">Current Health:</span>
                  {isHealthy && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      HEALTHY / ONLINE
                    </span>
                  )}
                  {isDegraded && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      DEGRADED
                    </span>
                  )}
                  {isFailed && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      FAILED / OUTAGE
                    </span>
                  )}
                </div>

                {nodeData.failureReason && (
                  <p className="text-xs text-rose-600 font-medium mt-1.5">
                    ⚠️ Cause: {nodeData.failureReason}
                  </p>
                )}
              </div>

              {/* Status Toggle Controls */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200">
                <button
                  onClick={() => setNodeHealth(node.id, 'healthy')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    isHealthy
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Healthy
                </button>
                <button
                  onClick={() => setNodeHealth(node.id, 'degraded', 'Performance Degraded')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    isDegraded
                      ? 'bg-amber-500 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Degrade
                </button>
                <button
                  onClick={() => setNodeHealth(node.id, 'failed', 'Injected Service Outage')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    isFailed
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Fail
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Deployment & Redundancy Configuration */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-500" />
              Deployment & Topology Configuration
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[11px] text-slate-500 block">Availability Zone</span>
                <span className="text-xs font-semibold text-slate-900 font-mono mt-0.5 block">
                  {nodeData.az || 'AZ-A'}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[11px] text-slate-500 block">Subnet Tier</span>
                <span className="text-xs font-semibold text-slate-900 uppercase mt-0.5 block">
                  {nodeData.subnet || 'Private'}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[11px] text-slate-500 block">Multi-AZ Setup</span>
                <span className="text-xs font-semibold text-slate-900 mt-0.5 block">
                  {nodeData.multiAz || nodeData.az === 'Multi-AZ' ? '✓ Enabled' : 'Single AZ'}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[11px] text-slate-500 block">Replica Count</span>
                <span className="text-xs font-semibold text-slate-900 font-mono mt-0.5 block">
                  {nodeData.replicas || 1} instance(s)
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: SPOF & Resilience Evaluation */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-slate-500" />
              Resilience & Fault Tolerance Analysis
            </h3>

            {isSpof ? (
              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/70 text-rose-900 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-rose-900">
                    Single Point of Failure (SPOF) Detected
                  </h4>
                  <p className="text-xs text-rose-700 mt-0.5 leading-relaxed">
                    {spofDetail?.explanation || 'This service is critical with no redundant parallel path. A failure here cuts traffic to downstream dependencies.'}
                  </p>
                  <p className="text-[11px] font-medium text-rose-800 mt-2">
                    💡 Recommendation: {spofDetail?.mitigation || 'Click Duplicate Node below to introduce a standby replica or enable Multi-AZ failover.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-900 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-emerald-900">
                    No Critical SPOF Detected for this Node
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                    This component has redundant upstream or downstream routes, or is a managed multi-AZ cloud service.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Network Interconnections */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
              <Network className="w-4 h-4 text-slate-500" />
              Connected Traffic Routes ({incomingEdges.length + outgoingEdges.length})
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Inbound */}
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-2">
                  Inbound Connections ({incomingEdges.length})
                </span>
                {incomingEdges.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No inbound connections</span>
                ) : (
                  <div className="space-y-1.5">
                    {incomingEdges.map(edge => {
                      const source = nodes.find(n => n.id === edge.source);
                      return (
                        <div key={edge.id} className="flex items-center justify-between text-xs p-1.5 rounded border border-slate-100 bg-white">
                          <span className="font-medium text-slate-800 truncate">
                            {source?.data.label || edge.source}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {(edge.data as any)?.protocol || 'HTTP'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Outbound */}
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-2">
                  Outbound Connections ({outgoingEdges.length})
                </span>
                {outgoingEdges.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No outbound connections</span>
                ) : (
                  <div className="space-y-1.5">
                    {outgoingEdges.map(edge => {
                      const target = nodes.find(n => n.id === edge.target);
                      return (
                        <div key={edge.id} className="flex items-center justify-between text-xs p-1.5 rounded border border-slate-100 bg-white">
                          <span className="font-medium text-slate-800 truncate">
                            {target?.data.label || edge.target}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {(edge.data as any)?.protocol || 'HTTP'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 5: Architectural Role & Failure Modes */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-slate-500" />
              Architectural Role & Resilience Notes
            </h3>
            <p className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-200">
              {serviceDef.architecturalRole}
            </p>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
          <button
            onClick={handleRemove}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            Remove Node
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDuplicate}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Duplicate Node
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[#232F3E] text-white hover:bg-[#1A232E] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
