import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { SERVICE_MAP } from '../../data/serviceCatalog.ts';
import { AvailabilityZone, SubnetType, ProtocolType } from '../../types/index.ts';
import { AwsServiceIcon } from '../icons/AwsServiceIcons.tsx';
import { findContainingSubnetBoundary } from '../../engine/layout/containment.ts';
import {
  X,
  Trash2,
  CheckCircle2,
  XCircle,
  Activity,
  ArrowRight,
  BookOpen,
  Flag,
  Cloud,
  Lock,
  Shield,
  Server,
  Copy,
  Layers,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Maximize2,
  Minimize2,
  Route,
  AlertTriangle,
  Plus,
  DollarSign,
  HardDrive,
  Cpu,
  Database,
  Info
} from 'lucide-react';
import {
  calculateNodeCost,
  EC2_INSTANCE_TYPES,
  EC2_OS_IMAGES,
  EBS_VOLUME_TYPES,
  S3_STORAGE_CLASSES,
  RDS_INSTANCE_TYPES
} from '../../engine/cost/costCalculator.ts';

export const ServiceInspector: React.FC = () => {
  const {
    selectedNode,
    setSelectedNodeId,
    selectedEdge,
    setSelectedEdgeId,
    updateNodeData,
    updateEdgeData,
    updateNodeDimensions,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    setNodeZIndex,
    deleteSelected,
    duplicateNode,
    toggleNodeFailure,
    addBoundaryNode,
    nodes,
    edges,
    simulationResult,
    activeStepIndex,
    setActiveStepIndex
  } = useArchitecture();

  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'learn'>('overview');
  const [showAttachSgMenu, setShowAttachSgMenu] = useState(false);

  if (!selectedNode && !selectedEdge) {
    return null;
  }

  // Handle Edge Inspection
  if (selectedEdge && !selectedNode) {
    const sourceNode = nodes.find(n => n.id === selectedEdge.source);
    const targetNode = nodes.find(n => n.id === selectedEdge.target);
    const edgeData = selectedEdge.data || { protocol: 'HTTP', interactionType: 'synchronous', timeoutMs: 2500 };

    return (
      <aside className="w-80 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 z-20 shadow-md">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Connection Inspector
            </h3>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 mt-0.5">
              <span>{sourceNode?.data.label || 'Source'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span>{targetNode?.data.label || 'Target'}</span>
            </div>
          </div>
          <button
            onClick={() => setSelectedEdgeId(null)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Edge Body */}
        <div className="p-4 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
          {/* Flow of Task Live Status */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <Route className="w-3.5 h-3.5 text-blue-600" />
                <span>Flow of Task</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                (selectedEdge.data as any)?.flowStatus === 'active'
                  ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-300'
                  : (selectedEdge.data as any)?.flowStatus === 'failed'
                  ? 'bg-rose-100 text-rose-800 ring-2 ring-rose-300'
                  : (selectedEdge.data as any)?.flowStatus === 'completed'
                  ? 'bg-emerald-100 text-emerald-800'
                  : (selectedEdge.data as any)?.flowStatus === 'pending'
                  ? 'bg-sky-100 text-sky-800'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {((selectedEdge.data as any)?.flowStatus || 'idle').toUpperCase()}
              </span>
            </div>

            {(selectedEdge.data as any)?.flowStepNumber && (
              <div className="text-xs text-slate-700 flex items-center justify-between border-t border-slate-200/60 pt-2">
                <span className="text-slate-500">Flow Position:</span>
                <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  Step #{(selectedEdge.data as any).flowStepNumber}
                </span>
              </div>
            )}

            {(selectedEdge.data as any)?.flowAction && (
              <div className="text-xs text-slate-700 space-y-1">
                <span className="text-slate-500 text-[11px] block">Task Action:</span>
                <div className="font-medium text-slate-900 bg-white p-2 rounded-lg border border-slate-200 text-xs">
                  {(selectedEdge.data as any).flowAction}
                </div>
              </div>
            )}

            {(selectedEdge.data as any)?.flowLatency !== undefined && (
              <div className="text-xs text-slate-700 flex items-center justify-between">
                <span className="text-slate-500">Traversed Latency:</span>
                <span className="font-mono font-bold text-slate-900">
                  +{(selectedEdge.data as any).flowLatency}ms
                </span>
              </div>
            )}

            {(selectedEdge.data as any)?.flowExplanation && (
              <p className="text-[11px] text-slate-600 leading-relaxed bg-white p-2 rounded-lg border border-slate-200">
                {(selectedEdge.data as any).flowExplanation}
              </p>
            )}

            {(selectedEdge.data as any)?.flowStepIndex !== undefined && (
              <button
                onClick={() => setActiveStepIndex((selectedEdge.data as any).flowStepIndex)}
                className="w-full mt-1.5 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Jump to This Step on Timeline</span>
              </button>
            )}
          </div>

          {/* Step Sequence Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Sequence Step Number (Diagram Badge)
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={(selectedEdge.data as any)?.stepNumber || ''}
              onChange={(e) => updateEdgeData(selectedEdge.id, { stepNumber: e.target.value ? Number(e.target.value) : undefined } as any)}
              placeholder="e.g. 1, 2, 3..."
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
            />
          </div>

          {/* Protocol Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Protocol / Interaction
            </label>
            <select
              value={edgeData.protocol}
              onChange={(e) => updateEdgeData(selectedEdge.id, { protocol: e.target.value as ProtocolType })}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
            >
              <option value="HTTPS">HTTPS (Encrypted Web Traffic)</option>
              <option value="HTTP">HTTP (Unencrypted Web Traffic)</option>
              <option value="DNS">DNS (Domain Resolution)</option>
              <option value="SQL">SQL (Database Queries)</option>
              <option value="Message">Message (SQS Queue Hand-off)</option>
              <option value="Event">Event (EventBridge / Lambda trigger)</option>
              <option value="Object access">Object Access (S3 Bucket I/O)</option>
              <option value="TCP">TCP / Raw Socket</option>
            </select>
          </div>

          {/* Coupling Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Coupling Mode
            </label>
            <select
              value={edgeData.interactionType}
              onChange={(e) => updateEdgeData(selectedEdge.id, { interactionType: e.target.value as any })}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            >
              <option value="synchronous">Synchronous (Blocking - Caller waits)</option>
              <option value="asynchronous">Asynchronous (Decoupled buffer)</option>
              <option value="cached">Cached (Fast local edge lookup)</option>
            </select>
          </div>

          {/* Educational Callout */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              Architectural Concept
            </div>
            <p className="leading-relaxed text-[11px]">
              {edgeData.interactionType === 'synchronous'
                ? 'Synchronous connections mean failures or high latency in downstream services immediately block the upstream caller.'
                : 'Asynchronous decoupling with message queues acts as a shock absorber, protecting downstream databases from thundering herds.'}
            </p>
          </div>
        </div>

        {/* Delete Edge Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={deleteSelected}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 bg-rose-50 border border-rose-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Connection
          </button>
        </div>
      </aside>
    );
  }

  // Handle Node Inspection
  if (!selectedNode) return null;

  // Handle Boundary Node Inspection (VPC, Subnet, AZ, Security Group, Region, etc.)
  if (selectedNode.type === 'boundaryNode' || !selectedNode.data?.serviceId) {
    const bData = (selectedNode.data || {}) as any;
    const boundaryType: string = bData.boundaryType || 'vpc';
    const label: string = bData.label || 'Network Boundary';
    const cidr: string = bData.cidr || '';
    const cidrError: string = bData.cidrError || '';
    const width: number = bData.width || (selectedNode.style as any)?.width || 400;
    const height: number = bData.height || (selectedNode.style as any)?.height || 300;

    const boundaryDefs: Record<string, {
      title: string;
      color: string;
      bgColor: string;
      badgeBg: string;
      icon: React.ReactNode;
      scope: string;
      defaultCidr?: string;
      teachingNotes: string[];
    }> = {
      region: {
        title: 'AWS Region',
        color: '#0073BB',
        bgColor: '#EEF6FC',
        badgeBg: '#0073BB',
        icon: <Flag className="w-3.5 h-3.5 text-white" />,
        scope: 'Geographic Area (Multiple AZs)',
        teachingNotes: [
          'Separate geographic area with isolated power, cooling, and water facilities.',
          'Each Region contains at least 3 distinct Availability Zones connected via ultra-low-latency fiber.',
          'Compliance & Data Residency: Keeps data inside national or regulatory jurisdictions.'
        ]
      },
      vpc: {
        title: 'Virtual Private Cloud (VPC)',
        color: '#16A34A',
        bgColor: '#EEF7E8',
        badgeBg: '#16A34A',
        icon: <Cloud className="w-3.5 h-3.5 text-white" />,
        scope: 'Regional Virtual Network',
        defaultCidr: '10.0.0.0/16',
        teachingNotes: [
          'Logically isolated network dedicated to your AWS account within a single Region.',
          'Spans all Availability Zones in the Region automatically.',
          'Control network topology with custom IP CIDR blocks (RFC 1918), route tables, and network ACLs.'
        ]
      },
      public_subnet: {
        title: 'Public Subnet',
        color: '#16A34A',
        bgColor: '#EEF7E8',
        badgeBg: '#16A34A',
        icon: <Lock className="w-3.5 h-3.5 text-white" />,
        scope: 'Zonal (Bound to 1 AZ)',
        defaultCidr: '10.0.1.0/24',
        teachingNotes: [
          'Route table has a direct default route to an Internet Gateway (0.0.0.0/0 -> igw).',
          'Instances get public IPv4 addresses and can accept inbound traffic from the internet.',
          'Best practice: Host only ingress components (ALB, Bastion, NAT Gateway) here.'
        ]
      },
      private_subnet: {
        title: 'Private Subnet',
        color: '#0073BB',
        bgColor: '#EEF6FC',
        badgeBg: '#0073BB',
        icon: <Lock className="w-3.5 h-3.5 text-white" />,
        scope: 'Zonal (Bound to 1 AZ)',
        defaultCidr: '10.0.2.0/24',
        teachingNotes: [
          'No direct route to the Internet Gateway. Zero direct public inbound connectivity.',
          'Outbound egress requires a NAT Gateway residing in a Public Subnet.',
          'Best practice: Place database backends (RDS, Aurora) and application servers (EC2, ECS) here.'
        ]
      },
      az: {
        title: 'Availability Zone',
        color: '#0073BB',
        bgColor: '#EEF6FC',
        badgeBg: '#0073BB',
        icon: <Server className="w-3.5 h-3.5 text-white" />,
        scope: 'Physical Fault Domain',
        teachingNotes: [
          'One or more discrete physical data centers with independent power and networking.',
          'Fault containment: Physical failure in one AZ does not cascade to other AZs.',
          'Architect for Multi-AZ redundancy to survive whole-datacenter disasters.'
        ]
      },
      availability_zone: {
        title: 'Availability Zone',
        color: '#0073BB',
        bgColor: '#EEF6FC',
        badgeBg: '#0073BB',
        icon: <Server className="w-3.5 h-3.5 text-white" />,
        scope: 'Physical Fault Domain',
        teachingNotes: [
          'One or more discrete physical data centers with independent power and networking.',
          'Fault containment: Physical failure in one AZ does not cascade to other AZs.',
          'Architect for Multi-AZ redundancy to survive whole-datacenter disasters.'
        ]
      },
      security_group: {
        title: 'Security Group',
        color: '#EF4444',
        bgColor: '#FEF2F2',
        badgeBg: '#EF4444',
        icon: <Shield className="w-3.5 h-3.5 text-white" />,
        scope: 'Virtual Firewall (ENI Layer)',
        teachingNotes: [
          'Stateful virtual firewall applied directly to individual instance ENIs.',
          'Evaluates traffic at the hypervisor layer before reaching the operating system.',
          'Return traffic is automatically permitted regardless of inbound rules (stateful tracking).'
        ]
      },
      account: {
        title: "Customer's AWS Account",
        color: '#232F3E',
        bgColor: '#F1F5F9',
        badgeBg: '#232F3E',
        icon: <Cloud className="w-3.5 h-3.5 text-white" />,
        scope: 'Security & Billing Boundary',
        teachingNotes: [
          'Ultimate blast-radius isolation boundary in AWS Organizations.',
          'Provides isolated IAM permissions, consolidated billing, and quota allocations.'
        ]
      }
    };

    const config = boundaryDefs[boundaryType] || boundaryDefs.vpc;

    // Detect services positioned inside this boundary
    const bPos = selectedNode.position;
    const bRight = bPos.x + width;
    const bBottom = bPos.y + height;

    const containedServices = nodes.filter(n => {
      if (n.type === 'boundaryNode' || n.id === selectedNode.id) return false;
      const nPos = n.position;
      return nPos.x >= bPos.x - 20 && nPos.x <= bRight && nPos.y >= bPos.y - 20 && nPos.y <= bBottom;
    });

    return (
      <aside className="w-80 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 z-20 shadow-md overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shadow-xs flex-shrink-0"
                style={{ backgroundColor: config.badgeBg }}
              >
                {config.icon}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Network Boundary
                </div>
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  {label || config.title}
                </h3>
              </div>
            </div>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scope Badge */}
          <div className="mt-3 flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-xs">
            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold">{config.scope}</span>
            </div>
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ backgroundColor: config.bgColor, color: config.color }}
            >
              {boundaryType.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Boundary Inspector Body */}
        <div className="p-4 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
          {/* Label Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Boundary Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value } as any)}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-sans"
            />
          </div>

          {/* CIDR Block: editable on the VPC (the one real input), auto-carved and read-only
              on Public/Private subnets so they can never overlap or violate AWS's /28 floor. */}
          {boundaryType === 'vpc' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                IPv4 CIDR Block
              </label>
              <input
                type="text"
                value={cidr || config.defaultCidr || ''}
                onChange={(e) => updateNodeData(selectedNode.id, { cidr: e.target.value } as any)}
                placeholder={config.defaultCidr || 'e.g. 10.0.0.0/16'}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Allocates private RFC 1918 address space. Public/Private subnet boundaries drawn inside this VPC automatically split this block between them.
              </p>
            </div>
          )}

          {['public_subnet', 'private_subnet'].includes(boundaryType) && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  IPv4 CIDR Block & Host Capacity
                </label>
                {cidrError ? (
                  <div className="w-full px-3 py-1.5 text-xs rounded-lg border bg-rose-50 border-rose-400 text-rose-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{cidrError}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-xs font-bold font-mono text-slate-900">{cidr || '—'}</span>
                    {bData.usableHosts !== undefined && (
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {bData.usableHosts} usable hosts
                      </span>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  Auto-carved from the containing VPC CIDR block. Subnets cannot overlap or drop below AWS's /28 floor.
                </p>
              </div>

              {/* Educational AWS 5 Reserved Addresses Card */}
              {!cidrError && bData.totalAddresses && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between text-xs border-b border-slate-200/80 pb-2">
                    <span className="text-slate-600 font-medium">Total CIDR Block IPs:</span>
                    <span className="font-mono font-bold text-slate-900">{bData.totalAddresses}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs border-b border-slate-200/80 pb-2">
                    <span className="text-slate-600 font-medium">Usable Host IPs:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {bData.usableHosts} (Total − 5)
                    </span>
                  </div>
                  {bData.usableRange && (
                    <div className="flex items-center justify-between text-xs border-b border-slate-200/80 pb-2">
                      <span className="text-slate-600 font-medium">Usable Host Range:</span>
                      <span className="font-mono text-[11px] font-bold text-slate-800">
                        {bData.usableRange.start} – {bData.usableRange.end}
                      </span>
                    </div>
                  )}

                  <div className="pt-1">
                    <div className="text-[11px] font-bold text-slate-800 mb-1.5 flex items-center justify-between">
                      <span>5 AWS Reserved Addresses</span>
                      <span className="text-[9px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">RFC 1918 / VPC</span>
                    </div>
                    <div className="space-y-1">
                      {(bData.reservedAddresses && bData.reservedAddresses.length > 0) ? (
                        bData.reservedAddresses.map((res: any, idx: number) => (
                          <div key={idx} className="p-1.5 rounded-lg bg-white border border-slate-200 text-[10px]">
                            <div className="flex items-center justify-between font-mono">
                              <span className="font-bold text-blue-700">{res.ip}</span>
                              <span className="text-[9px] font-sans font-semibold text-slate-600 uppercase">{res.role}</span>
                            </div>
                            <div className="text-slate-500 text-[9px] mt-0.5 leading-tight">{res.description}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-[10px] text-slate-500 italic">
                          First 4 addresses (.0 Network, .1 Router, .2 DNS, .3 Future use) and last address (.last Broadcast) are reserved by AWS.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Network ACL - one per subnet in real AWS, governing every resource inside it.
              Stateless: only needs an explicit DENY rule to block traffic (everything else is
              allowed), unlike a Security Group's allow-list. */}
          {['public_subnet', 'private_subnet'].includes(boundaryType) && (() => {
            const denyList: string[] = bData.naclDenyInbound || [];
            const isRestricted = bData.naclDenyInbound !== undefined;
            const PROTOCOLS: ProtocolType[] = ['HTTP', 'HTTPS', 'SQL', 'DNS', 'gRPC', 'TCP', 'Event', 'Message', 'Object access'];
            const protectedNodes = nodes.filter(n => {
              if (n.type === 'boundaryNode') return false;
              const containing = findContainingSubnetBoundary(n as any, nodes.filter(x => x.type === 'boundaryNode') as any);
              return containing?.id === selectedNode.id;
            });

            const setRestricted = (restrict: boolean) => {
              updateNodeData(selectedNode.id, { naclDenyInbound: restrict ? denyList : undefined } as any);
            };
            const toggleProtocol = (proto: string) => {
              const next = denyList.includes(proto) ? denyList.filter(p => p !== proto) : [...denyList, proto];
              updateNodeData(selectedNode.id, { naclDenyInbound: next } as any);
            };

            return (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Network ACL
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={isRestricted} onChange={(e) => setRestricted(e.target.checked)} className="w-3 h-3" />
                  Add explicit DENY rules
                </label>

                {!isRestricted ? (
                  <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                    Default rule: allows all traffic (no DENY rules configured).
                  </p>
                ) : (
                  <>
                    <p className="text-[10px] text-slate-400">DENY these inbound protocols (everything else is allowed):</p>
                    <div className="flex flex-wrap gap-1">
                      {PROTOCOLS.map(proto => {
                        const active = denyList.includes(proto);
                        return (
                          <button
                            key={proto}
                            onClick={() => toggleProtocol(proto)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                              active ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-slate-500 hover:border-rose-400'
                            }`}
                          >
                            {proto}
                          </button>
                        );
                      })}
                    </div>
                    {denyList.length === 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">No DENY rules yet - currently equivalent to allowing everything.</p>
                    )}
                  </>
                )}

                <p className="mt-2 text-[10px] text-slate-400">
                  {protectedNodes.length === 0
                    ? 'No resources placed inside this subnet yet.'
                    : `Applies to: ${protectedNodes.map(n => (n.data as any).label).join(', ')}`}
                </p>
              </div>
            );
          })()}

          {/* Security Group inbound rules - editable here too (not just from an attached
              instance's own panel), since in real AWS you can manage a group's rules from the
              Security Groups console page independent of any one resource. */}
          {boundaryType === 'security_group' && (() => {
            const allowed: string[] | undefined = bData.allowedProtocols;
            const isRestricted = allowed !== undefined;
            const PROTOCOLS: ProtocolType[] = ['HTTP', 'HTTPS', 'SQL', 'DNS', 'gRPC', 'TCP', 'Event', 'Message', 'Object access'];
            const attachedTo = nodes.filter(n => ((n.data as any)?.securityGroupIds || []).includes(selectedNode.id));

            const setRestricted = (restrict: boolean) => {
              updateNodeData(selectedNode.id, { allowedProtocols: restrict ? (allowed || []) : undefined } as any);
            };
            const toggleProtocol = (proto: string) => {
              const current = allowed || [];
              const next = current.includes(proto) ? current.filter(p => p !== proto) : [...current, proto];
              updateNodeData(selectedNode.id, { allowedProtocols: next } as any);
            };

            return (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Inbound Rules
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={isRestricted} onChange={(e) => setRestricted(e.target.checked)} className="w-3 h-3" />
                  Restrict inbound traffic (custom rules)
                </label>

                {!isRestricted ? (
                  <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                    Default rule: allows all inbound traffic.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {PROTOCOLS.map(proto => {
                        const active = (allowed || []).includes(proto);
                        return (
                          <button
                            key={proto}
                            onClick={() => toggleProtocol(proto)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                              active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-500 hover:border-blue-400'
                            }`}
                          >
                            {proto}
                          </button>
                        );
                      })}
                    </div>
                    {(allowed || []).length === 0 && (
                      <p className="text-[10px] text-rose-600 mt-1">No protocols allowed yet - this Security Group currently denies all inbound traffic.</p>
                    )}
                  </>
                )}

                <p className="mt-2 text-[10px] text-slate-400">
                  {attachedTo.length === 0
                    ? 'Not attached to any resource yet - attach it from a service node\'s own Security Groups panel.'
                    : `Attached to: ${attachedTo.map(n => (n.data as any).label).join(', ')}`}
                </p>
              </div>
            );
          })()}

          {/* Interactive Dimensions & Resizing */}
          <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
                Dimensions & Sizing
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {Math.round(width)} × {Math.round(height)} px
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Width Adjuster */}
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">
                  Width (px)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateNodeDimensions(selectedNode.id, Math.max(120, width - 50), height)}
                    className="px-1.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600"
                    title="Decrease width by 50px"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={120}
                    max={2500}
                    step={20}
                    value={Math.round(width)}
                    onChange={(e) => updateNodeDimensions(selectedNode.id, Number(e.target.value), height)}
                    className="w-full text-center px-1.5 py-1 text-xs rounded bg-white border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={() => updateNodeDimensions(selectedNode.id, width + 50, height)}
                    className="px-1.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600"
                    title="Increase width by 50px"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Height Adjuster */}
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">
                  Height (px)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateNodeDimensions(selectedNode.id, width, Math.max(60, height - 50))}
                    className="px-1.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600"
                    title="Decrease height by 50px"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={60}
                    max={2500}
                    step={20}
                    value={Math.round(height)}
                    onChange={(e) => updateNodeDimensions(selectedNode.id, width, Number(e.target.value))}
                    className="w-full text-center px-1.5 py-1 text-xs rounded bg-white border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={() => updateNodeDimensions(selectedNode.id, width, height + 50)}
                    className="px-1.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600"
                    title="Increase height by 50px"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Size Preset Buttons */}
            <div className="pt-1">
              <span className="block text-[10px] text-slate-400 font-medium mb-1">Quick Presets</span>
              <div className="grid grid-cols-4 gap-1">
                <button
                  onClick={() => updateNodeDimensions(selectedNode.id, 340, 220)}
                  className="py-1 px-1 text-[10px] font-medium bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded transition-colors"
                >
                  Compact
                </button>
                <button
                  onClick={() => updateNodeDimensions(selectedNode.id, 560, 340)}
                  className="py-1 px-1 text-[10px] font-medium bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded transition-colors"
                >
                  Medium
                </button>
                <button
                  onClick={() => updateNodeDimensions(selectedNode.id, 780, 480)}
                  className="py-1 px-1 text-[10px] font-medium bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded transition-colors"
                >
                  Large
                </button>
                <button
                  onClick={() => updateNodeDimensions(selectedNode.id, 960, 600)}
                  className="py-1 px-1 text-[10px] font-medium bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded transition-colors"
                >
                  Full
                </button>
              </div>
            </div>

            {/* Fit to Enclosed Services Button */}
            {containedServices.length > 0 && (
              <button
                onClick={() => {
                  const bPos = selectedNode.position;
                  const padding = 55;
                  const rightMost = Math.max(...containedServices.map(s => s.position.x + 90));
                  const bottomMost = Math.max(...containedServices.map(s => s.position.y + 90));
                  const newW = Math.max(200, Math.round(rightMost - bPos.x + padding));
                  const newH = Math.max(120, Math.round(bottomMost - bPos.y + padding));
                  updateNodeDimensions(selectedNode.id, newW, newH);
                }}
                className="w-full py-1.5 px-2 text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
              >
                <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
                Fit to Enclosed Services ({containedServices.length})
              </button>
            )}
          </div>

          {/* Stacking Layer (Z-Index) Controls */}
          <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                Stacking Layer (Z-Index)
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={selectedNode.zIndex ?? -1}
                  onChange={(e) => setNodeZIndex(selectedNode.id, Number(e.target.value))}
                  className="w-14 text-center font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                onClick={() => bringToFront(selectedNode.id)}
                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                title="Bring in front of all components"
              >
                <ChevronsUp className="w-3.5 h-3.5 text-slate-600" />
                Bring to Front
              </button>
              <button
                onClick={() => bringForward(selectedNode.id)}
                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                title="Bring 1 step forward (Hotkey: ])"
              >
                <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
                Bring Forward
              </button>
              <button
                onClick={() => sendBackward(selectedNode.id)}
                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                title="Send 1 step backward (Hotkey: [)"
              >
                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                Send Backward
              </button>
              <button
                onClick={() => sendToBack(selectedNode.id)}
                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                title="Send behind all components"
              >
                <ChevronsDown className="w-3.5 h-3.5 text-slate-600" />
                Send to Back
              </button>
            </div>
          </div>

          {/* Contained Services List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Enclosed Services ({containedServices.length})
              </span>
            </div>
            {containedServices.length > 0 ? (
              <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {containedServices.map(cs => (
                  <button
                    key={cs.id}
                    onClick={() => setSelectedNodeId(cs.id)}
                    className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <AwsServiceIcon serviceId={cs.data?.serviceId} size={22} />
                      <span className="text-xs font-semibold text-slate-800 truncate">{cs.data?.label}</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic p-2 bg-slate-50 rounded border border-slate-200 text-center">
                No services positioned inside this boundary
              </p>
            )}
          </div>

          {/* Architectural Notes */}
          <div className="space-y-2">
            <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px] flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              AWS Architecture Guide
            </div>
            <div className="space-y-1.5">
              {config.teachingNotes.map((note, idx) => (
                <div key={idx} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 leading-relaxed">
                  {note}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-white space-y-2">
          <button
            onClick={() => duplicateNode(selectedNode.id)}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 bg-white border border-slate-200 rounded-lg transition-colors shadow-xs"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate Boundary
          </button>
          <button
            onClick={deleteSelected}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 bg-white border border-rose-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Boundary Container
          </button>
        </div>
      </aside>
    );
  }

  const nodeData = selectedNode.data || ({} as any);
  const serviceDef = SERVICE_MAP[nodeData.serviceId] || {
    name: nodeData.label || 'Custom Component',
    category: nodeData.category || 'Compute',
    description: 'Custom AWS component',
    architecturalRole: 'General system processing unit',
    failureModes: ['Process crash', 'Out of memory'],
    resilienceCharacteristics: ['Redundancy across multiple AZs'],
    teachingNotes: ['Keep workloads stateless where possible.']
  };

  const isFailed = nodeData.health === 'failed';

  // Find upstream (dependents) and downstream (dependencies)
  const incomingEdges = edges.filter(e => e.target === selectedNode.id);
  const outgoingEdges = edges.filter(e => e.source === selectedNode.id);
  const upstreamNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
  const downstreamNodes = outgoingEdges.map(e => nodes.find(n => n.id === e.target)).filter(Boolean);

  // Current simulation activity
  const activeStep = (simulationResult && activeStepIndex !== null)
    ? simulationResult.steps[activeStepIndex]
    : null;
  const isNodeActiveInSimulation = activeStep && (activeStep.targetNodeId === selectedNode.id || activeStep.sourceNodeId === selectedNode.id);

  // Failure impact rating
  let failureImpact: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  let failureImpactWhy = 'Disrupts processing for connected services.';
  if (['rds', 'dynamodb'].includes(nodeData.serviceId) && !nodeData.multiAz) {
    failureImpact = 'CRITICAL';
    failureImpactWhy = 'Application cannot retrieve or persist relational data. All transactional queries fail immediately.';
  } else if (['alb', 'route53', 'api_gateway', 'appsync'].includes(nodeData.serviceId)) {
    failureImpact = 'CRITICAL';
    failureImpactWhy = 'Primary ingress endpoint. Dropping this service cuts off client traffic completely.';
  } else if (['ecs', 'ec2'].includes(nodeData.serviceId) && (nodeData.replicas || 1) <= 1 && upstreamNodes.length > 0) {
    failureImpact = 'HIGH';
    failureImpactWhy = 'No redundant compute instances available to pick up traffic, resulting in 502 Bad Gateway.';
  } else if (['ecs', 'ec2', 'lambda', 'fargate'].includes(nodeData.serviceId) && (nodeData.replicas || 1) > 1) {
    failureImpact = 'LOW';
    failureImpactWhy = 'Traffic steers safely to other healthy compute replicas.';
  }

  return (
    <aside className="w-80 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 z-20 shadow-md overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <AwsServiceIcon serviceId={nodeData.serviceId} size={42} />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {serviceDef.category}
              </div>
              <h3 className="text-sm font-bold text-slate-900 leading-tight">
                {nodeData.label || serviceDef.name}
              </h3>
            </div>
          </div>
          <button
            onClick={() => setSelectedNodeId(null)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Bar with Simulate Failure toggle */}
        <div className="mt-3 flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center gap-1.5 text-xs">
            {isFailed ? (
              <XCircle className="w-4 h-4 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
            <span className={`font-semibold ${isFailed ? 'text-rose-700' : 'text-emerald-800'}`}>
              {isFailed ? 'FAILED' : 'Healthy'}
            </span>
          </div>

          <button
            onClick={() => toggleNodeFailure(selectedNode.id)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
              isFailed
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
            }`}
          >
            {isFailed ? 'Restore Node' : 'Simulate Failure'}
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mt-3 border-b border-slate-200 -mb-4 pt-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2 px-2 text-xs transition-colors ${
              activeTab === 'overview'
                ? 'border-b-2 border-slate-900 text-slate-900 font-semibold'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-2 px-2 text-xs transition-colors ${
              activeTab === 'config'
                ? 'border-b-2 border-slate-900 text-slate-900 font-semibold'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Config
          </button>
          <button
            onClick={() => setActiveTab('learn')}
            className={`pb-2 px-2 text-xs transition-colors ${
              activeTab === 'learn'
                ? 'border-b-2 border-slate-900 text-slate-900 font-semibold'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Teaching Notes
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'overview' && (
          <>
            {/* Live Simulation Activity */}
            {isNodeActiveInSimulation ? (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                  CURRENT ACTIVITY
                </div>
                <div className="font-mono font-semibold">{activeStep.action}</div>
                <div className="text-[11px] text-amber-800/90">{activeStep.explanation}</div>
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <span>Idle (Waiting for simulation request)</span>
              </div>
            )}

            {/* Architectural Role */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Architectural Role
              </label>
              <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                {serviceDef.architecturalRole}
              </p>
            </div>

            {/* Failure Impact Box */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Failure Impact
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                    failureImpact === 'CRITICAL'
                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                      : failureImpact === 'HIGH'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}
                >
                  {failureImpact}
                </span>
              </div>
              <div className="text-xs text-slate-700 leading-relaxed">
                <span className="font-semibold text-slate-900">Why? </span>
                {failureImpactWhy}
              </div>
            </div>

            {/* Upstream & Downstream Dependencies */}
            <div className="space-y-2.5 pt-1">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Depends On (Downstream)
                </span>
                {downstreamNodes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {downstreamNodes.map((n: any) => (
                      <span
                        key={n.id}
                        className="px-2 py-0.5 rounded bg-white text-slate-800 text-xs font-medium border border-slate-300 shadow-xs"
                      >
                        {n.data.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 italic">No downstream dependencies</span>
                )}
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Dependents (Upstream Callers)
                </span>
                {upstreamNodes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {upstreamNodes.map((n: any) => (
                      <span
                        key={n.id}
                        className="px-2 py-0.5 rounded bg-white text-slate-800 text-xs font-medium border border-slate-300 shadow-xs"
                      >
                        {n.data.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 italic">No upstream callers (Entry point)</span>
                )}
              </div>
            </div>

            {/* AWS Estimated Monthly Cost Card (Overview) */}
            {(() => {
              const nodeCost = calculateNodeCost(selectedNode);
              return (
                <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/40 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-blue-600" />
                      AWS Estimated Cost
                    </span>
                    {nodeCost.freeTierEligible && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                        Free Tier
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between">
                    <div className="text-lg font-bold font-mono text-slate-900">
                      ${nodeCost.monthlyCost.toFixed(2)}
                      <span className="text-xs font-normal text-slate-500"> / mo</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      ≈ ${nodeCost.hourlyCost.toFixed(4)}/hr
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {nodeCost.configurationSummary}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {activeTab === 'config' && (
          <div className="space-y-3.5">
            {/* Display Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Display Label
              </label>
              <input
                type="text"
                value={nodeData.label}
                onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            {/* Availability Zone Placement */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Availability Zone Placement
              </label>
              <select
                value={nodeData.az}
                onChange={(e) => updateNodeData(selectedNode.id, { az: e.target.value as AvailabilityZone })}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
              >
                <option value="AZ-A">Availability Zone A (us-east-1a)</option>
                <option value="AZ-B">Availability Zone B (us-east-1b)</option>
                <option value="AZ-C">Availability Zone C (us-east-1c)</option>
                <option value="Multi-AZ">Multi-AZ Redundant</option>
                <option value="Edge / Global">Edge / Global Anycast</option>
              </select>
            </div>

            {/* Subnet Type - derived live from where this node actually sits on the canvas,
                relative to Public/Private subnet boundaries, so it can never drift from what
                the diagram visually shows. Drag the node to change it, not this panel. */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Subnet Security Boundary
              </label>
              {(() => {
                const subnetDisplay: Record<SubnetType, { text: string; className: string }> = {
                  public: { text: 'Public Subnet (Internet Gateway)', className: 'bg-emerald-50 border-emerald-300 text-emerald-800' },
                  private: { text: 'Private Subnet (Internal only)', className: 'bg-blue-50 border-blue-300 text-blue-800' },
                  isolated: { text: 'Isolated Data Subnet', className: 'bg-indigo-50 border-indigo-300 text-indigo-800' },
                  global: { text: 'Global Edge / Managed (outside any VPC)', className: 'bg-slate-100 border-slate-300 text-slate-700' },
                  unassigned: { text: 'Not inside any subnet - unreachable', className: 'bg-rose-50 border-rose-400 text-rose-700' }
                };
                const display = subnetDisplay[nodeData.subnet] || subnetDisplay.global;
                return (
                  <div className={`w-full px-3 py-1.5 text-xs rounded-lg border font-medium flex items-center gap-1.5 ${display.className}`}>
                    {nodeData.subnet === 'unassigned' && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                    {display.text}
                  </div>
                );
              })()}
              <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                Derived automatically from where this node sits on the canvas relative to Public/Private subnet boundaries. Drag it into or out of a subnet box to change this.
              </p>
            </div>

            {/* Network ACL - unlike a Security Group, this is genuinely tied to the subnet in
                real AWS: every subnet has exactly one NACL, and it governs every resource inside
                it. So this isn't an attach/detach control - moving this node to a different
                subnet (drag it on the canvas) is what changes which NACL applies; editing the
                rule here edits that subnet's NACL directly, affecting every other resource in it
                too, exactly like the real console. */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Network ACL
              </label>
              {(() => {
                const subnetBoundary = findContainingSubnetBoundary(selectedNode as any, nodes.filter(n => n.type === 'boundaryNode') as any);

                if (!subnetBoundary) {
                  return (
                    <p className="text-[10px] text-slate-400 italic px-0.5">
                      Not inside any subnet, so no Network ACL applies. Place this node inside a Public/Private subnet boundary to give it one.
                    </p>
                  );
                }

                const denyList: string[] = (subnetBoundary.data as any).naclDenyInbound || [];
                const isRestricted = (subnetBoundary.data as any).naclDenyInbound !== undefined;
                const PROTOCOLS: ProtocolType[] = ['HTTP', 'HTTPS', 'SQL', 'DNS', 'gRPC', 'TCP', 'Event', 'Message', 'Object access'];

                const setRestricted = (restrict: boolean) => {
                  updateNodeData(subnetBoundary.id, { naclDenyInbound: restrict ? denyList : undefined } as any);
                };
                const toggleProtocol = (proto: string) => {
                  const next = denyList.includes(proto) ? denyList.filter(p => p !== proto) : [...denyList, proto];
                  updateNodeData(subnetBoundary.id, { naclDenyInbound: next } as any);
                };

                return (
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800 truncate">{(subnetBoundary.data as any).label || 'Subnet'}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">stateless</span>
                    </div>

                    <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={isRestricted} onChange={(e) => setRestricted(e.target.checked)} className="w-3 h-3" />
                      Add explicit DENY rules
                    </label>

                    {!isRestricted ? (
                      <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                        Default rule: allows all traffic (no DENY rules configured).
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] text-slate-400">DENY these inbound protocols (everything else is allowed):</p>
                        <div className="flex flex-wrap gap-1">
                          {PROTOCOLS.map(proto => {
                            const active = denyList.includes(proto);
                            return (
                              <button
                                key={proto}
                                onClick={() => toggleProtocol(proto)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                                  active ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-slate-500 hover:border-rose-400'
                                }`}
                              >
                                {proto}
                              </button>
                            );
                          })}
                        </div>
                        {denyList.length === 0 && (
                          <p className="text-[10px] text-slate-400">No DENY rules yet - currently equivalent to allowing everything.</p>
                        )}
                      </>
                    )}

                    <p className="text-[10px] text-slate-400">
                      Applies to every resource in {(subnetBoundary.data as any).label || 'this subnet'}, not just this one.
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Security Groups - attached by explicit reference, exactly like a real AWS
                instance's Security tab. Unlike the subnet above, this has nothing to do with
                where the node sits on the canvas: attach or detach any Security Group here, and
                edit its rules directly - changes apply everywhere that group is attached. */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-slate-500" />
                Security Groups
              </label>
              {(() => {
                const PROTOCOLS: ProtocolType[] = ['HTTP', 'HTTPS', 'SQL', 'DNS', 'gRPC', 'TCP', 'Event', 'Message', 'Object access'];
                const allSecurityGroups = nodes.filter(n => n.type === 'boundaryNode' && (n.data as any)?.boundaryType === 'security_group');
                const attachedIds: string[] = nodeData.securityGroupIds || [];
                const attachedGroups = attachedIds
                  .map(id => allSecurityGroups.find(n => n.id === id))
                  .filter((n): n is (typeof allSecurityGroups)[number] => Boolean(n));
                const availableToAttach = allSecurityGroups.filter(n => !attachedIds.includes(n.id));

                const detach = (sgId: string) => {
                  updateNodeData(selectedNode.id, { securityGroupIds: attachedIds.filter(id => id !== sgId) } as any);
                };
                const attach = (sgId: string) => {
                  updateNodeData(selectedNode.id, { securityGroupIds: [...attachedIds, sgId] } as any);
                  setShowAttachSgMenu(false);
                };
                const createAndAttach = () => {
                  const newId = addBoundaryNode(
                    'security_group',
                    { x: selectedNode.position.x + 60, y: selectedNode.position.y - 90 },
                    { label: `${nodeData.label} SG`, width: 220, height: 90 }
                  );
                  updateNodeData(selectedNode.id, { securityGroupIds: [...attachedIds, newId] } as any);
                  setShowAttachSgMenu(false);
                };

                return (
                  <div className="space-y-2">
                    {attachedGroups.length === 0 && (
                      <p className="text-[10px] text-slate-400 italic px-0.5">
                        No Security Group attached - all inbound traffic is unrestricted, same as a fresh AWS resource with the default group.
                      </p>
                    )}

                    {attachedGroups.map(sg => {
                      const allowed: string[] | undefined = (sg.data as any).allowedProtocols;
                      const isRestricted = allowed !== undefined;

                      const setRestricted = (restrict: boolean) => {
                        updateNodeData(sg.id, { allowedProtocols: restrict ? (allowed || []) : undefined } as any);
                      };
                      const toggleProtocol = (proto: string) => {
                        const current = allowed || [];
                        const next = current.includes(proto) ? current.filter(p => p !== proto) : [...current, proto];
                        updateNodeData(sg.id, { allowedProtocols: next } as any);
                      };

                      return (
                        <div key={sg.id} className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-800 truncate">{(sg.data as any).label || 'Security Group'}</span>
                            <button
                              onClick={() => detach(sg.id)}
                              title="Detach this Security Group"
                              className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isRestricted}
                              onChange={(e) => setRestricted(e.target.checked)}
                              className="w-3 h-3"
                            />
                            Restrict inbound traffic (custom rules)
                          </label>

                          {!isRestricted && (
                            <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                              Default rule: allows all inbound traffic.
                            </p>
                          )}

                          {isRestricted && (
                            <>
                              <p className="text-[10px] text-slate-400">Allowed inbound protocols (allow-list only - unlisted protocols are denied):</p>
                              <div className="flex flex-wrap gap-1">
                                {PROTOCOLS.map(proto => {
                                  const active = (allowed || []).includes(proto);
                                  return (
                                    <button
                                      key={proto}
                                      onClick={() => toggleProtocol(proto)}
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                                        active
                                          ? 'bg-blue-600 border-blue-600 text-white'
                                          : 'bg-white border-slate-300 text-slate-500 hover:border-blue-400'
                                      }`}
                                    >
                                      {proto}
                                    </button>
                                  );
                                })}
                              </div>
                              {(allowed || []).length === 0 && (
                                <p className="text-[10px] text-rose-600">No protocols allowed yet - this Security Group currently denies all inbound traffic.</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}

                    <div className="relative">
                      <button
                        onClick={() => setShowAttachSgMenu(v => !v)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Attach Security Group
                      </button>

                      {showAttachSgMenu && (
                        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1 max-h-48 overflow-y-auto">
                          {availableToAttach.map(sg => (
                            <button
                              key={sg.id}
                              onClick={() => attach(sg.id)}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 truncate"
                            >
                              {(sg.data as any).label || 'Security Group'}
                            </button>
                          ))}
                          {availableToAttach.length > 0 && <div className="my-1 border-t border-slate-100" />}
                          <button
                            onClick={createAndAttach}
                            className="w-full text-left px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                          >
                            + Create new Security Group
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Replicas Slider */}
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Task / Instance Replicas</span>
                <span className="font-mono text-blue-600 font-bold">{nodeData.replicas || 1}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={nodeData.replicas || 1}
                onChange={(e) => updateNodeData(selectedNode.id, { replicas: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Multi-AZ Toggle */}
            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!nodeData.multiAz}
                  onChange={(e) => updateNodeData(selectedNode.id, { multiAz: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Multi-AZ Synchronous Hot Standby
                </span>
              </label>
            </div>

            {/* ---------------------------------------------------- */}
            {/* SERVICE-SPECIFIC AWS CONFIGURATION (EC2, S3, RDS, etc.) */}
            {/* ---------------------------------------------------- */}
            {nodeData.serviceId === 'ec2' && (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
                  <Server className="w-3.5 h-3.5 text-orange-600" />
                  <span>Amazon EC2 Instance Configuration</span>
                </div>

                {/* OS Image / AMI */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amazon Machine Image (AMI / OS)
                  </label>
                  <select
                    value={nodeData.customConfig?.osImage || 'al2023'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, osImage: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-sans"
                  >
                    {EC2_OS_IMAGES.map(img => (
                      <option key={img.id} value={img.id}>{img.label}</option>
                    ))}
                  </select>
                </div>

                {/* Instance Type / Size */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Instance Type / Size
                  </label>
                  <select
                    value={nodeData.customConfig?.instanceType || 't3.micro'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, instanceType: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
                  >
                    {['General Purpose', 'Compute Optimized', 'Memory Optimized', 'Accelerated / GPU'].map(family => (
                      <optgroup key={family} label={family}>
                        {Object.entries(EC2_INSTANCE_TYPES)
                          .filter(([_, def]) => def.family === family)
                          .map(([key, def]) => (
                            <option key={key} value={key}>
                              {key} • {def.vCpu} vCPU, {def.ramGb}GB (${(def.hourly * 730).toFixed(2)}/mo)
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Purchasing Option */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Purchasing Option
                  </label>
                  <select
                    value={nodeData.customConfig?.purchasingOption || 'on_demand'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, purchasingOption: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 text-xs"
                  >
                    <option value="on_demand">On-Demand (Standard hourly)</option>
                    <option value="savings_plan_1yr">Compute Savings Plan 1-Yr (~35% discount)</option>
                    <option value="savings_plan_3yr">Compute Savings Plan 3-Yr (~55% discount)</option>
                    <option value="spot">Spot Instances (Up to 70% discount, interruptible)</option>
                  </select>
                </div>

                {/* EBS Root Storage Volume */}
                <div className="space-y-2 pt-1 border-t border-slate-200">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      EBS Volume Storage
                    </span>
                    <span className="font-mono text-blue-600 font-bold">
                      {nodeData.customConfig?.ebsVolumeSizeGb || 30} GB
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Volume Type</label>
                      <select
                        value={nodeData.customConfig?.ebsVolumeType || 'gp3'}
                        onChange={(e) => updateNodeData(selectedNode.id, {
                          customConfig: { ...nodeData.customConfig, ebsVolumeType: e.target.value }
                        } as any)}
                        className="w-full px-2 py-1 text-xs rounded bg-white border border-slate-300 font-mono"
                      >
                        {Object.entries(EBS_VOLUME_TYPES).map(([k, def]) => (
                          <option key={k} value={k}>{k.toUpperCase()} (${def.costPerGb}/GB)</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Size (GB)</label>
                      <input
                        type="number"
                        min="8"
                        max="2000"
                        value={nodeData.customConfig?.ebsVolumeSizeGb || 30}
                        onChange={(e) => updateNodeData(selectedNode.id, {
                          customConfig: { ...nodeData.customConfig, ebsVolumeSizeGb: Number(e.target.value) }
                        } as any)}
                        className="w-full px-2 py-1 text-xs rounded bg-white border border-slate-300 font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* S3 Storage Configuration */}
            {(nodeData.serviceId === 's3' || nodeData.serviceId === 's3_client' || nodeData.serviceId === 's3_managed') && (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
                  <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Amazon S3 Bucket Configuration</span>
                </div>

                {/* Storage Class Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    S3 Storage Class / Tier
                  </label>
                  <select
                    value={nodeData.customConfig?.storageClass || 'STANDARD'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, storageClass: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 font-sans"
                  >
                    {Object.entries(S3_STORAGE_CLASSES).map(([k, def]) => (
                      <option key={k} value={k}>{def.label} — {def.desc}</option>
                    ))}
                  </select>
                </div>

                {/* Data Volume Capacity */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Stored Data Capacity</span>
                    <span className="font-mono text-blue-600 font-bold">
                      {(nodeData.customConfig?.storageGb || 50) >= 1000
                        ? `${((nodeData.customConfig?.storageGb || 50) / 1000).toFixed(1)} TB`
                        : `${nodeData.customConfig?.storageGb || 50} GB`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="10000"
                    step="5"
                    value={nodeData.customConfig?.storageGb || 50}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, storageGb: Number(e.target.value) }
                    } as any)}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                    <span>5 GB</span>
                    <span>1 TB</span>
                    <span>10 TB</span>
                  </div>
                </div>

                {/* S3 Security & Versioning Features */}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={nodeData.customConfig?.versioning !== false}
                      onChange={(e) => updateNodeData(selectedNode.id, {
                        customConfig: { ...nodeData.customConfig, versioning: e.target.checked }
                      } as any)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Bucket Versioning Enabled</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={nodeData.customConfig?.blockPublicAccess !== false}
                      onChange={(e) => updateNodeData(selectedNode.id, {
                        customConfig: { ...nodeData.customConfig, blockPublicAccess: e.target.checked }
                      } as any)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Block All Public Access (AWS Default)</span>
                  </label>
                </div>
              </div>
            )}

            {/* RDS Database Configuration */}
            {(nodeData.serviceId === 'rds' || nodeData.serviceId === 'aurora') && (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
                  <Database className="w-3.5 h-3.5 text-purple-600" />
                  <span>Amazon RDS Database Configuration</span>
                </div>

                {/* Database Engine */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Database Engine
                  </label>
                  <select
                    value={nodeData.customConfig?.dbEngine || 'PostgreSQL'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, dbEngine: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 font-sans"
                  >
                    <option value="PostgreSQL">PostgreSQL (Community Edition)</option>
                    <option value="MySQL">MySQL Community</option>
                    <option value="Aurora PostgreSQL">Amazon Aurora (PostgreSQL Compatible)</option>
                    <option value="Aurora MySQL">Amazon Aurora (MySQL Compatible)</option>
                    <option value="MariaDB">MariaDB</option>
                  </select>
                </div>

                {/* DB Instance Class */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    DB Instance Class
                  </label>
                  <select
                    value={nodeData.customConfig?.dbInstanceClass || 'db.t4g.micro'}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, dbInstanceClass: e.target.value }
                    } as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-300 text-slate-900 font-mono"
                  >
                    {Object.entries(RDS_INSTANCE_TYPES).map(([k, def]) => (
                      <option key={k} value={k}>
                        {def.label} (${(def.hourly * 730).toFixed(2)}/mo)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Allocated Storage */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Allocated Storage (gp3)</span>
                    <span className="font-mono text-blue-600 font-bold">
                      {nodeData.customConfig?.storageGb || 50} GB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="1000"
                    step="10"
                    value={nodeData.customConfig?.storageGb || 50}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, storageGb: Number(e.target.value) }
                    } as any)}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}

            {/* AWS Lambda Configuration */}
            {(nodeData.serviceId === 'lambda' || nodeData.serviceId === 'step_lambda') && (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
                  <Cpu className="w-3.5 h-3.5 text-amber-600" />
                  <span>AWS Lambda Function Configuration</span>
                </div>

                {/* CPU Architecture */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Instruction Set Architecture
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateNodeData(selectedNode.id, {
                        customConfig: { ...nodeData.customConfig, architecture: 'arm64' }
                      } as any)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all ${
                        (nodeData.customConfig?.architecture || 'arm64') === 'arm64'
                          ? 'bg-blue-50 border-blue-500 text-blue-800'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      arm64 (Graviton2, -20% cost)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateNodeData(selectedNode.id, {
                        customConfig: { ...nodeData.customConfig, architecture: 'x86_64' }
                      } as any)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all ${
                        nodeData.customConfig?.architecture === 'x86_64'
                          ? 'bg-blue-50 border-blue-500 text-blue-800'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      x86_64
                    </button>
                  </div>
                </div>

                {/* Memory Allocation */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Allocated Memory: {nodeData.customConfig?.memoryMb || 256} MB
                  </label>
                  <input
                    type="range"
                    min="128"
                    max="3008"
                    step="128"
                    value={nodeData.customConfig?.memoryMb || 256}
                    onChange={(e) => updateNodeData(selectedNode.id, {
                      customConfig: { ...nodeData.customConfig, memoryMb: Number(e.target.value) }
                    } as any)}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* LIVE PER-RESOURCE AWS PRICING PREVIEW CARD */}
            {/* ---------------------------------------------------- */}
            {(() => {
              const nodeCost = calculateNodeCost(selectedNode);
              return (
                <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <DollarSign className="w-4 h-4 text-blue-600" />
                      <span>AWS Estimated Resource Cost</span>
                    </div>
                    {nodeCost.freeTierEligible && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        Free Tier
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-b border-blue-100 pb-2">
                    <div>
                      <div className="text-xl font-bold font-mono text-slate-900">
                        ${nodeCost.monthlyCost.toFixed(2)}
                        <span className="text-xs font-normal text-slate-500"> / month</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        ≈ ${nodeCost.hourlyCost.toFixed(4)} / hour
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 font-semibold truncate max-w-[140px]">
                      {nodeCost.configurationSummary}
                    </span>
                  </div>

                  {/* Line Items */}
                  <div className="space-y-1 pt-1">
                    {nodeCost.lineItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[11px]">
                        <div className="truncate pr-2">
                          <span className="text-slate-700 font-medium">{item.name}</span>
                          <span className="text-slate-400 text-[10px] block">{item.detail}</span>
                        </div>
                        <span className="font-mono font-bold text-slate-900 flex-shrink-0">
                          ${item.cost.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Stacking Layer (Z-Index) */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Stacking Layer (Z-Index)
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={selectedNode.zIndex ?? 10}
                    onChange={(e) => setNodeZIndex(selectedNode.id, Number(e.target.value))}
                    className="w-14 text-center font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  onClick={() => bringToFront(selectedNode.id)}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  title="Bring in front of all components"
                >
                  <ChevronsUp className="w-3.5 h-3.5 text-blue-600" />
                  Bring to Front
                </button>
                <button
                  onClick={() => bringForward(selectedNode.id)}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  title="Bring 1 step forward (Hotkey: ])"
                >
                  <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
                  Bring Forward
                </button>
                <button
                  onClick={() => sendBackward(selectedNode.id)}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  title="Send 1 step backward (Hotkey: [)"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                  Send Backward
                </button>
                <button
                  onClick={() => sendToBack(selectedNode.id)}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  title="Send behind all components"
                >
                  <ChevronsDown className="w-3.5 h-3.5 text-blue-600" />
                  Send to Back
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'learn' && (
          <div className="space-y-4 text-xs text-slate-700">
            {/* Failure Modes */}
            <div>
              <div className="font-bold text-rose-700 uppercase tracking-wider text-[10px] mb-1.5">
                Common Failure Modes
              </div>
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                {serviceDef.failureModes.map((fm, idx) => (
                  <li key={idx}>{fm}</li>
                ))}
              </ul>
            </div>

            {/* Teaching Notes */}
            <div>
              <div className="font-bold text-blue-800 uppercase tracking-wider text-[10px] mb-1.5">
                AWS Architecture Notes
              </div>
              <div className="space-y-2">
                {serviceDef.teachingNotes.map((note, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 leading-relaxed text-slate-700">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Node Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50">
        <button
          onClick={deleteSelected}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 bg-rose-50 border border-rose-200 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove Service from Diagram
        </button>
      </div>
    </aside>
  );
};
