import React from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import {
  Shield,
  Lightbulb,
  CheckCircle2,
  XCircle,
  ArrowDown,
  ArrowUp,
  Play,
  Sliders,
  Info
} from 'lucide-react';
import { SubnetNaclConfig, NaclRule } from '../../types/index.ts';

interface NaclSideColumnProps {
  onClose?: () => void;
}

export const NaclSideColumn: React.FC<NaclSideColumnProps> = ({ onClose }) => {
  const {
    nodes,
    edges,
    updateNodeData,
    updateEdgeData,
    runScenario,
    selectedNode,
    selectedEdge
  } = useArchitecture();

  // Locate the public subnet and private subnet
  const publicSubnetNode = nodes.find(
    n => n.type === 'boundaryNode' && ((n.data as any)?.boundaryType === 'public_subnet' || n.id === 'box-public-subnet')
  );

  const publicNacl: SubnetNaclConfig | undefined = (publicSubnetNode?.data as any)?.customNacl;

  // Find the ephemeral return rule in the public subnet NACL
  const ephemeralRule = publicNacl?.inboundRules?.find(
    r => r.portRange.includes('1024-65535') || r.type.toLowerCase().includes('ephemeral')
  );
  const isMissingReturn = ephemeralRule ? Boolean(ephemeralRule.isMissingReturn) : true;

  // Find the outgoing response edge
  const outboundEdge = edges.find(
    e => (e.data as any)?.signalType === 'outbound_response' || e.id === 'e-db-web-outbound'
  );

  // Toggle between Timeout Bug (missing ephemeral return rule) and Fixed state
  const handleToggleFix = (missing: boolean) => {
    if (!publicSubnetNode || !publicNacl) return;

    const updatedInboundRules: NaclRule[] = publicNacl.inboundRules.map(r => {
      if (r.portRange.includes('1024-65535') || r.type.toLowerCase().includes('ephemeral')) {
        return {
          ...r,
          isMissingReturn: missing,
          action: 'ALLOW'
        };
      }
      return r;
    });

    updateNodeData(publicSubnetNode.id, {
      customNacl: {
        ...publicNacl,
        inboundRules: updatedInboundRules
      }
    } as any);

    if (outboundEdge) {
      updateEdgeData(outboundEdge.id, {
        hasMissingReturnBlock: missing,
        signalLabel: missing
          ? 'Connection Flow (Outbound Response - Blocked/Timed Out)'
          : 'Connection Flow (Outbound Response - Allowed/Delivered)'
      } as any);
    }
  };

  return (
    <aside className="w-96 bg-white border-l border-slate-200 flex flex-col h-full flex-shrink-0 z-20 shadow-lg select-none">
      {/* 1. Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-circuit-600 text-white flex items-center justify-center shadow-xs">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              NACL Rule Details &amp; Signals
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">
              Problem 3.1: Stateless Timeout
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(selectedNode || selectedEdge) && onClose && (
            <button
              onClick={onClose}
              className="text-[10px] font-semibold px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs transition-colors cursor-pointer"
              title="Inspect currently selected resource"
            >
              Inspect {selectedNode ? (selectedNode.data as any)?.label || 'Node' : 'Edge'}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded hover:bg-slate-200 text-slate-500 font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-slate-800">
        {/* 2. Key Insight Callout (From Problem 3.1 Diagram) */}
        <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl shadow-2xs">
          <div className="flex items-start gap-2.5">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Lightbulb className="w-3.5 h-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-950">Key Insight</h4>
              <p className="text-[11px] text-amber-900 leading-relaxed mt-0.5">
                Connections time out because <span className="font-bold underline">NACLs are stateless</span>. A custom NACL must explicitly allow inbound ephemeral ports (<span className="font-mono font-semibold">1024-65535</span>) for the return traffic from the database. Even with &quot;Allow All&quot; outbound, the traffic is blocked upon return to the public subnet.
              </p>
            </div>
          </div>
        </div>

        {/* 3. Interactive Stateless Rule Controller */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-circuit-600" />
              <span className="text-xs font-bold text-slate-800">Simulation State</span>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isMissingReturn
                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              {isMissingReturn ? '🔴 Bug: Timeout' : '🟢 Fixed: Success'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleToggleFix(true)}
              className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-all text-left flex flex-col cursor-pointer ${
                isMissingReturn
                  ? 'bg-white border-rose-400 text-rose-700 ring-2 ring-rose-300/40 shadow-xs'
                  : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
              }`}
            >
              <span className="font-bold flex items-center gap-1">
                <XCircle className="w-3 h-3 text-rose-500" />
                Missing Return Rule
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5">Stateless Drop (Timeout)</span>
            </button>

            <button
              onClick={() => handleToggleFix(false)}
              className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-all text-left flex flex-col cursor-pointer ${
                !isMissingReturn
                  ? 'bg-white border-emerald-500 text-emerald-800 ring-2 ring-emerald-300/40 shadow-xs'
                  : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
              }`}
            >
              <span className="font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Allow Ephemeral Ports
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5">Ports 1024-65535 (200 OK)</span>
            </button>
          </div>

          <button
            onClick={() => runScenario()}
            className="w-full mt-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-circuit-600 hover:bg-circuit-700 active:bg-circuit-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Simulate Request &amp; Response Flow</span>
          </button>
        </div>

        {/* 4. Live Signals Diagnostics Monitor */}
        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-circuit-600 animate-pulse" />
            Signal Flow Diagnostics
          </h4>

          {/* Incoming Signal */}
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/70 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-circuit-700 flex items-center gap-1">
                <ArrowDown className="w-3 h-3" />
                Incoming Signal (Inbound Request)
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-1.5 py-0.2 rounded">
                ALLOWED
              </span>
            </div>
            <div className="text-[10px] text-slate-600 font-mono">
              Web Server (10.0.1.x) ➔ Database (10.0.2.x:3306)
            </div>
            <div className="text-[9px] text-slate-500">
              SYN packet permitted by Public NACL Outbound &amp; Private NACL Inbound.
            </div>
          </div>

          {/* Outgoing Signal */}
          <div className={`p-2 rounded-lg border space-y-1 ${
            isMissingReturn
              ? 'bg-rose-50/70 border-rose-200'
              : 'bg-emerald-50/70 border-emerald-200'
          }`}>
            <div className="flex items-center justify-between text-[11px]">
              <span className={`font-semibold flex items-center gap-1 ${
                isMissingReturn ? 'text-rose-700' : 'text-emerald-700'
              }`}>
                <ArrowUp className="w-3 h-3" />
                Outgoing Signal (Outbound Response)
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                isMissingReturn
                  ? 'text-rose-800 bg-rose-200/80 animate-pulse'
                  : 'text-emerald-800 bg-emerald-200/80'
              }`}>
                {isMissingReturn ? 'BLOCKED (TIMEOUT)' : 'DELIVERED (200 OK)'}
              </span>
            </div>
            <div className="text-[10px] text-slate-600 font-mono">
              Database (:3306) ➔ Web Server (Ephemeral :49152)
            </div>
            <div className="text-[9px] text-slate-500">
              {isMissingReturn
                ? 'Stateless Block: Public Subnet NACL drops return packet. Connection hangs & times out.'
                : 'Rule 110 matches ephemeral ports 1024-65535. Full TCP roundtrip completed successfully.'}
            </div>
          </div>
        </div>

        {/* 5. Public Subnet NACL (Custom) Rules Table */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              Public Subnet NACL: Custom
            </h4>
            <span className="text-[10px] font-mono font-semibold text-slate-400">10.0.1.0/24</span>
          </div>

          {/* Inbound Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden text-[10px]">
            <div className="bg-slate-100 px-2.5 py-1 font-bold text-slate-700 border-b border-slate-200 flex justify-between">
              <span>INBOUND RULES</span>
              <span className="text-[9px] text-slate-400">Evaluated in order</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[9px] text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1 font-semibold">Rule #</th>
                  <th className="px-2 py-1 font-semibold">Source</th>
                  <th className="px-2 py-1 font-semibold">Port Range</th>
                  <th className="px-2 py-1 font-semibold">Allow/Deny</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">90</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">TCP 80 (HTTP)</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">100</td>
                  <td className="px-2 py-1 font-mono">10.0.2.0/24</td>
                  <td className="px-2 py-1">TCP 3306</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                {/* Ephemeral Rule with Highlight if Missing */}
                <tr className={isMissingReturn ? 'bg-rose-50/90' : 'bg-emerald-50/50'}>
                  <td className="px-2 py-1 font-mono text-slate-500">110</td>
                  <td className="px-2 py-1 font-mono">10.0.2.0/24</td>
                  <td className="px-2 py-1 font-medium">
                    <span>Ephemeral (1024-65535)</span>
                    {isMissingReturn && (
                      <div className="text-[8px] font-bold text-rose-700 uppercase flex items-center gap-0.5 mt-0.5">
                        <span className="font-mono bg-rose-600 text-white px-1 rounded-2xs">XX</span>
                        <span>Missing Return Rule</span>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 font-bold">
                    {isMissingReturn ? (
                      <span className="text-rose-600">DROPPED</span>
                    ) : (
                      <span className="text-emerald-600">ALLOW</span>
                    )}
                  </td>
                </tr>
                <tr className="bg-slate-50/50 text-slate-400">
                  <td className="px-2 py-1 font-mono">*</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-rose-500">DENY</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Outbound Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden text-[10px]">
            <div className="bg-slate-100 px-2.5 py-1 font-bold text-slate-700 border-b border-slate-200 flex justify-between">
              <span>OUTBOUND RULES</span>
              <span className="text-[9px] text-slate-400">Evaluated in order</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[9px] text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1 font-semibold">Rule #</th>
                  <th className="px-2 py-1 font-semibold">Dest</th>
                  <th className="px-2 py-1 font-semibold">Port Range</th>
                  <th className="px-2 py-1 font-semibold">Allow/Deny</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">100</td>
                  <td className="px-2 py-1 font-mono">10.0.2.0/24</td>
                  <td className="px-2 py-1">TCP 3306</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">110</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="bg-slate-50/50 text-slate-400">
                  <td className="px-2 py-1 font-mono">*</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-rose-500">DENY</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 6. Private Subnet NACL (Custom) Rules Table */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-circuit-600" />
              Private Subnet NACL: Custom
            </h4>
            <span className="text-[10px] font-mono font-semibold text-slate-400">10.0.2.0/24</span>
          </div>

          {/* Inbound Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden text-[10px]">
            <div className="bg-slate-100 px-2.5 py-1 font-bold text-slate-700 border-b border-slate-200 flex justify-between">
              <span>INBOUND RULES</span>
              <span className="text-[9px] text-slate-400">Evaluated in order</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[9px] text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1 font-semibold">Rule #</th>
                  <th className="px-2 py-1 font-semibold">Source</th>
                  <th className="px-2 py-1 font-semibold">Port Range</th>
                  <th className="px-2 py-1 font-semibold">Allow/Deny</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">100</td>
                  <td className="px-2 py-1 font-mono">10.0.1.0/24</td>
                  <td className="px-2 py-1">TCP 3306</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">110</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">Ephemeral Ports</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="bg-slate-50/50 text-slate-400">
                  <td className="px-2 py-1 font-mono">*</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-rose-500">DENY</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Outbound Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden text-[10px]">
            <div className="bg-slate-100 px-2.5 py-1 font-bold text-slate-700 border-b border-slate-200 flex justify-between">
              <span>OUTBOUND RULES</span>
              <span className="text-[9px] text-slate-400">Evaluated in order</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[9px] text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1 font-semibold">Rule #</th>
                  <th className="px-2 py-1 font-semibold">Dest</th>
                  <th className="px-2 py-1 font-semibold">Port Range</th>
                  <th className="px-2 py-1 font-semibold">Allow/Deny</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">100</td>
                  <td className="px-2 py-1 font-mono">10.0.1.0/24</td>
                  <td className="px-2 py-1">TCP 3306</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-500">110</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-emerald-600">ALLOW</td>
                </tr>
                <tr className="bg-slate-50/50 text-slate-400">
                  <td className="px-2 py-1 font-mono">*</td>
                  <td className="px-2 py-1 font-mono">0.0.0.0/0</td>
                  <td className="px-2 py-1">All</td>
                  <td className="px-2 py-1 font-bold text-rose-500">DENY</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 7. Security Groups vs NACL Comparison */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-[11px]">
          <div className="flex items-center gap-1 font-bold text-slate-900">
            <Info className="w-3.5 h-3.5 text-circuit-600" />
            <span>Why Security Groups Never Have This Issue</span>
          </div>
          <p className="text-slate-600 text-[10px] leading-relaxed">
            <span className="font-semibold text-slate-800">Security Groups are stateful</span>: once an inbound request is permitted by a Security Group, return traffic is automatically tracked and allowed back out, regardless of outbound rules.
          </p>
          <p className="text-slate-600 text-[10px] leading-relaxed">
            <span className="font-semibold text-slate-800">Network ACLs are stateless</span>: they do not track connection state. Each inbound and outbound packet is evaluated individually against numbered rules. Therefore, return traffic on high-numbered ephemeral ports (<span className="font-mono">1024-65535</span>) must have an explicit ALLOW rule.
          </p>
        </div>
      </div>
    </aside>
  );
};
