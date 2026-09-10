import React, { memo } from 'react';
import { NodeResizer } from '@xyflow/react';
import {
  Flag,
  Cloud,
  Lock,
  Zap,
  Server,
  AlertTriangle
} from 'lucide-react';

export interface BoundaryNodeData {
  label?: string;
  boundaryType:
    | 'region'
    | 'vpc'
    | 'az'
    | 'availability_zone'
    | 'public_subnet'
    | 'private_subnet'
    | 'security_group'
    | 'account'
    | 'auth'
    | 'workflow';
  width?: number;
  height?: number;
  cidr?: string;
  cidrError?: string;
  totalAddresses?: number;
  usableHosts?: number;
  reservedAddresses?: Array<{ ip: string; offset: number; role: string; description: string }>;
  usableRange?: { start: string; end: string } | null;
  /** Network ACL explicit DENY list (`private_subnet`/`public_subnet` boundaries only). */
  naclDenyInbound?: string[];
  /** Security Group explicit ALLOW list (`security_group` boundaries only). `undefined` means
   *  the default wide-open AWS-created Security Group; an empty array means an explicitly
   *  configured group that denies all inbound traffic. */
  allowedProtocols?: string[];
}

export const BoundaryNode = memo((props: any) => {
  const data = props?.data || {};
  const selected = Boolean(props?.selected);
  const boundaryType = data.boundaryType || 'vpc';
  const label = data.label || '';
  const width = props?.measured?.width || props?.width || props?.style?.width || data.width || 400;
  const height = props?.measured?.height || props?.height || props?.style?.height || data.height || 300;

  // Selected ring indicator
  const selectedRing = selected ? 'ring-2 ring-slate-800 ring-offset-2' : '';

  // Render specific visual frame based on AWS boundary type
  const renderBoundaryFrame = () => {
    // 1. REGION BOUNDARY (Blue solid border with Top-Left Flag badge)
    if (boundaryType === 'region') {
      return (
        <div className={`w-full h-full border-2 border-[#0073BB] bg-transparent relative select-none pointer-events-none ${selectedRing}`}>
          <div className="absolute -top-3.5 left-3 flex items-center gap-1.5 bg-white px-2 pointer-events-auto cursor-move shadow-2xs rounded-xs border border-[#0073BB]/30">
            <div className="w-5 h-5 bg-[#0073BB] text-white flex items-center justify-center rounded-xs shadow-xs">
              <Flag className="w-3 h-3 fill-white" />
            </div>
            <span className="text-xs font-bold text-[#0073BB] font-sans tracking-tight">
              {label || 'Region'}
            </span>
          </div>
        </div>
      );
    }

    // 2. VPC BOUNDARY (Green solid border with Top-Left Green Cloud badge)
    if (boundaryType === 'vpc') {
      return (
        <div className={`w-full h-full border-2 border-[#16A34A] bg-transparent relative select-none pointer-events-none ${selectedRing}`}>
          <div className="absolute -top-3.5 left-3 flex items-center gap-1.5 bg-white px-2 pointer-events-auto cursor-move shadow-2xs rounded-xs border border-[#16A34A]/30">
            <div className="w-5 h-5 bg-[#16A34A] text-white flex items-center justify-center rounded-xs shadow-xs">
              <Cloud className="w-3 h-3 fill-white" />
            </div>
            <span className="text-xs font-bold text-[#545B64] font-sans tracking-tight">
              {label || 'VPC'}
            </span>
            {data.cidr && (
              <span className="text-[10px] font-mono text-slate-400">({data.cidr})</span>
            )}
          </div>
        </div>
      );
    }

    // 3. AVAILABILITY ZONE BOUNDARY (Blue dashed border with centered AZ title)
    if (boundaryType === 'az' || boundaryType === 'availability_zone') {
      return (
        <div className={`w-full h-full border-2 border-dashed border-[#0073BB] bg-transparent relative select-none pointer-events-none ${selectedRing}`}>
          <div className="text-center -mt-2.5 pointer-events-auto cursor-move">
            <span className="text-xs font-bold text-[#0073BB] font-sans tracking-wide bg-white px-3 py-0.5 border border-[#0073BB]/30 rounded-xs shadow-2xs">
              {label || 'Availability Zone'}
            </span>
          </div>
        </div>
      );
    }

    // 4. PUBLIC SUBNET BOUNDARY (Clean white background with Green Lock badge)
    if (boundaryType === 'public_subnet') {
      return (
        <div className={`w-full h-full border border-[#16A34A] bg-white relative select-none pointer-events-none shadow-xs ${selectedRing}`}>
          <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-auto cursor-move bg-white px-2 py-0.5 rounded shadow-2xs border border-[#16A34A]/30">
            <div className="w-5 h-5 bg-[#16A34A] text-white flex items-center justify-center rounded-xs shadow-xs">
              <Lock className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-bold text-[#166534] font-sans">
              {label || 'Public subnet'}
            </span>
            {data.cidrError ? (
              <span title={data.cidrError} className="flex items-center gap-1 text-[10px] font-mono text-rose-600">
                <AlertTriangle className="w-3 h-3" />
                invalid CIDR
              </span>
            ) : data.cidr ? (
              <span
                title={data.usableHosts !== undefined
                  ? `${data.cidr}: ${data.usableHosts} usable IPs (${data.totalAddresses ?? ''} total addresses, 5 reserved by AWS: .0 network, .1 router, .2 DNS, .3 future use, .last broadcast)`
                  : data.cidr}
                className="text-[10px] font-mono text-slate-500 flex items-center gap-1"
              >
                <span>({data.cidr}</span>
                {data.usableHosts !== undefined && (
                  <span className="text-emerald-700 font-semibold">• {data.usableHosts} usable</span>
                )}
                <span>)</span>
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    // 5. PRIVATE SUBNET BOUNDARY (Clean white background with Blue Lock badge)
    if (boundaryType === 'private_subnet') {
      return (
        <div className={`w-full h-full border border-[#0073BB] bg-white relative select-none pointer-events-none shadow-xs ${selectedRing}`}>
          <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-auto cursor-move bg-white px-2 py-0.5 rounded shadow-2xs border border-[#0073BB]/30">
            <div className="w-5 h-5 bg-[#0073BB] text-white flex items-center justify-center rounded-xs shadow-xs">
              <Lock className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-bold text-[#0073BB] font-sans">
              {label || 'Private subnet'}
            </span>
            {data.cidrError ? (
              <span title={data.cidrError} className="flex items-center gap-1 text-[10px] font-mono text-rose-600">
                <AlertTriangle className="w-3 h-3" />
                invalid CIDR
              </span>
            ) : data.cidr ? (
              <span
                title={data.usableHosts !== undefined
                  ? `${data.cidr}: ${data.usableHosts} usable IPs (${data.totalAddresses ?? ''} total addresses, 5 reserved by AWS: .0 network, .1 router, .2 DNS, .3 future use, .last broadcast)`
                  : data.cidr}
                className="text-[10px] font-mono text-slate-500 flex items-center gap-1"
              >
                <span>({data.cidr}</span>
                {data.usableHosts !== undefined && (
                  <span className="text-blue-700 font-semibold">• {data.usableHosts} usable</span>
                )}
                <span>)</span>
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    // 6. SECURITY GROUP BOUNDARY (Red solid outline with centered red label)
    if (boundaryType === 'security_group') {
      return (
        <div className={`w-full h-full border-2 border-[#EF4444] bg-transparent relative select-none pointer-events-none ${selectedRing}`}>
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white px-2.5 pointer-events-auto cursor-move border border-[#EF4444]/40 rounded-xs shadow-2xs">
            <span className="text-xs font-semibold text-[#EF4444] font-sans">
              {label || 'Security group'}
            </span>
          </div>
        </div>
      );
    }

    // 7. WORKFLOW BOUNDARY (Pink border with lightning badge)
    if (boundaryType === 'workflow') {
      return (
        <div className={`w-full h-full rounded-lg border-2 border-pink-500 bg-white/40 p-2 shadow-xs pointer-events-none ${selectedRing}`}>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-pink-600 text-white rounded text-[11px] font-bold w-fit mb-2 pointer-events-auto cursor-move shadow-xs">
            <Zap className="w-3.5 h-3.5" />
            <span>{label}</span>
          </div>
        </div>
      );
    }

    // 8. AUTHENTICATION BOUNDARY (Dashed slate)
    if (boundaryType === 'auth') {
      return (
        <div className={`w-full h-full rounded-lg border-2 border-dashed border-slate-400 bg-slate-50/40 p-2 pointer-events-none ${selectedRing}`}>
          <div className="text-[11px] font-semibold text-slate-700 text-center mb-1 pointer-events-auto cursor-move">
            {label}
          </div>
        </div>
      );
    }

    // 9. AWS ACCOUNT / DEFAULT CLOUD BOUNDARY (Charcoal border with cloud badge)
    return (
      <div className={`w-full h-full rounded-xl border-2 border-[#232F3E] bg-white/40 p-3 shadow-xs pointer-events-none select-none relative ${selectedRing}`}>
        <div className="flex items-center gap-2 mb-2 pointer-events-auto cursor-move">
          <div className="p-1 rounded bg-[#232F3E] text-white flex items-center justify-center">
            <Cloud className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-[#232F3E] tracking-tight">
            {label || "Customer's AWS Account"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="relative group w-full h-full"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        minWidth: 100,
        minHeight: 40
      }}
    >
      <NodeResizer
        nodeId={props?.id}
        isVisible={selected}
        minWidth={100}
        minHeight={40}
        lineClassName="!border-blue-500 !border-dashed !z-50 pointer-events-auto"
        handleClassName="!h-3.5 !w-3.5 !bg-white !border-2 !border-blue-600 !rounded-xs !shadow-lg hover:scale-125 transition-transform !z-50 pointer-events-auto cursor-pointer"
      />
      {renderBoundaryFrame()}
    </div>
  );
});

BoundaryNode.displayName = 'BoundaryNode';
