import React, { memo, useState } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from '@xyflow/react';
import { ConnectionData, FlowStatus } from '../../types/index.ts';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';

export const CustomConnectionEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected
}: EdgeProps) => {
  const { setActiveStepIndex, setSelectedEdgeId } = useArchitecture();
  const [isHovered, setIsHovered] = useState(false);

  const edgeData = (data as unknown as ConnectionData) || {
    protocol: 'HTTP',
    interactionType: 'synchronous',
    isCriticalDependency: true,
    timeoutMs: 2500
  };

  const {
    flowStatus,
    flowStepNumber,
    flowStepIndex,
    flowAction,
    flowLatency,
    flowExplanation,
    flowStatusCode,
    isSimulating,
    isFailing
  } = edgeData;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  // Determine effective flow status
  let effectiveStatus: FlowStatus = flowStatus || 'idle';
  if (!flowStatus) {
    if (isFailing) effectiveStatus = 'failed';
    else if (isSimulating) effectiveStatus = 'active';
    else if (flowStepNumber || (edgeData as any)?.stepNumber) effectiveStatus = 'completed';
    else effectiveStatus = 'idle';
  }

  const displayStep = flowStepNumber || (edgeData as any)?.stepNumber;

  // Determine Stroke Colors & Widths based on task flow
  let coreStroke = '#475569'; // Default Slate-600
  let strokeWidth = selected ? 2.5 : 1.5;
  let strokeDasharray: string | undefined = undefined;
  let animation: string | undefined = undefined;
  let opacity = 1;

  if (effectiveStatus === 'active') {
    coreStroke = '#2563EB'; // Vibrant AWS Blue
    strokeWidth = 3.5;
    strokeDasharray = '8,4';
    animation = 'flow-active 1.2s linear infinite';
  } else if (effectiveStatus === 'failed') {
    coreStroke = '#DC2626'; // Crimson Red
    strokeWidth = 3;
    strokeDasharray = '5,4';
  } else if (effectiveStatus === 'completed') {
    coreStroke = '#2563EB'; // High-visibility Flow Blue
    strokeWidth = 2.5;
  } else if (effectiveStatus === 'pending') {
    coreStroke = '#93C5FD'; // Soft Sky Blue
    strokeWidth = 2;
    strokeDasharray = '4,4';
  } else if (effectiveStatus === 'dimmed') {
    coreStroke = '#CBD5E1'; // Dimmed Slate
    strokeWidth = 1.2;
    opacity = 0.28;
  } else if (selected) {
    coreStroke = '#2563EB';
    strokeWidth = 2.5;
  }

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (flowStepIndex !== undefined) {
      setActiveStepIndex(flowStepIndex);
    }
    setSelectedEdgeId(id);
  };

  return (
    <g
      className="transition-opacity duration-300"
      style={{ opacity }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. Glowing Halo Stroke for Highlighted Flow Lines */}
      {effectiveStatus === 'active' && (
        <path
          d={edgePath}
          fill="none"
          stroke="#60A5FA"
          strokeWidth={10}
          strokeOpacity={0.3}
          strokeLinecap="round"
          className="transition-all pointer-events-none"
        />
      )}

      {effectiveStatus === 'failed' && (
        <path
          d={edgePath}
          fill="none"
          stroke="#F87171"
          strokeWidth={10}
          strokeOpacity={0.35}
          strokeLinecap="round"
          className="transition-all pointer-events-none"
        />
      )}

      {effectiveStatus === 'completed' && (
        <path
          d={edgePath}
          fill="none"
          stroke="#93C5FD"
          strokeWidth={6}
          strokeOpacity={0.2}
          strokeLinecap="round"
          className="transition-all pointer-events-none"
        />
      )}

      {/* 2. Interactive invisible wide stroke to make hovering and clicking easier */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="cursor-pointer"
        onClick={() => setSelectedEdgeId(id)}
      />

      {/* 3. Core Task Flow Line */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: coreStroke,
          strokeWidth: isHovered && effectiveStatus !== 'dimmed' ? strokeWidth + 0.8 : strokeWidth,
          strokeDasharray,
          animation,
          transition: 'stroke 0.25s ease, stroke-width 0.2s ease, opacity 0.3s ease'
        }}
      />

      {/* 4. Animated Traveling Energy Packets (Representing the Live Flow of Task) */}
      {effectiveStatus === 'active' && (
        <>
          {/* Outer glow circle */}
          <circle r="6" fill="#3B82F6" opacity="0.6">
            <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
          </circle>
          {/* Inner bright packet core */}
          <circle r="3.5" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5">
            <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
          </circle>
        </>
      )}

      {/* Subtle traveling particle on completed flow lines */}
      {effectiveStatus === 'completed' && !isFailing && (
        <circle r="3" fill="#2563EB" opacity="0.7">
          <animateMotion dur="2.4s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* 5. Flow Step Badge & Protocol Tag */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all'
          }}
          className="nodrag nopan select-none group"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {displayStep ? (
            <div
              onClick={handleBadgeClick}
              className="relative flex items-center justify-center cursor-pointer transition-transform hover:scale-115 active:scale-95"
              title={`Task Flow Step ${displayStep}: Click to trace`}
            >
              {effectiveStatus === 'active' && (
                <span className="absolute -inset-1.5 rounded-full bg-blue-400 animate-ping opacity-60" />
              )}
              <div
                className={`flex items-center justify-center font-bold font-mono shadow-md transition-all ${
                  effectiveStatus === 'active'
                    ? 'w-7 h-7 rounded-full bg-blue-600 text-white text-xs ring-4 ring-blue-200 ring-offset-1 z-10'
                    : effectiveStatus === 'failed'
                    ? 'w-6 h-6 rounded-full bg-rose-600 text-white text-xs ring-2 ring-rose-300'
                    : effectiveStatus === 'pending'
                    ? 'w-5 h-5 rounded-full bg-white border-2 border-blue-400 text-blue-600 text-[10px]'
                    : effectiveStatus === 'dimmed'
                    ? 'w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px]'
                    : 'w-6 h-6 rounded-full bg-slate-900 text-white text-xs hover:bg-blue-600'
                }`}
              >
                {effectiveStatus === 'failed' ? '!' : displayStep}
              </div>
            </div>
          ) : (
            <div
              onClick={() => setSelectedEdgeId(id)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border transition-all cursor-pointer ${
                effectiveStatus === 'active'
                  ? 'bg-blue-50 text-blue-700 border-blue-400 ring-2 ring-blue-300 shadow-sm'
                  : effectiveStatus === 'failed'
                  ? 'bg-rose-50 text-rose-700 border-rose-300'
                  : effectiveStatus === 'dimmed'
                  ? 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  : 'bg-white text-slate-700 border-slate-300 shadow-xs hover:border-slate-400'
              }`}
            >
              {edgeData.protocol || 'HTTP'}
            </div>
          )}

          {/* 6. Rich Interactive Tooltip on Line Hover */}
          {isHovered && effectiveStatus !== 'dimmed' && (flowAction || flowStepNumber || edgeData.protocol) && (
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-3 rounded-xl bg-white border border-slate-200 shadow-2xl pointer-events-none text-left z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between gap-1 mb-1 pb-1 border-b border-slate-100">
                <span className="text-[10px] font-mono font-bold text-blue-600 uppercase tracking-wider">
                  {displayStep ? `Task Flow • Step ${displayStep}` : 'Connection Line'}
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                    effectiveStatus === 'active'
                      ? 'bg-blue-100 text-blue-800'
                      : effectiveStatus === 'failed'
                      ? 'bg-rose-100 text-rose-800'
                      : effectiveStatus === 'completed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {effectiveStatus.toUpperCase()}
                </span>
              </div>

              {flowAction && (
                <div className="text-xs font-bold text-slate-900 leading-snug mb-1">
                  {flowAction}
                </div>
              )}

              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 mb-1">
                <span className="font-semibold text-slate-700">{edgeData.protocol}</span>
                {flowLatency !== undefined && (
                  <>
                    <span>•</span>
                    <span>+{flowLatency}ms</span>
                  </>
                )}
                {flowStatusCode !== undefined && (
                  <>
                    <span>•</span>
                    <span className={flowStatusCode < 400 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                      HTTP {flowStatusCode}
                    </span>
                  </>
                )}
              </div>

              {flowExplanation && (
                <p className="text-[10px] text-slate-600 leading-relaxed border-t border-slate-100 pt-1 line-clamp-2">
                  {flowExplanation}
                </p>
              )}

              {flowStepIndex !== undefined && (
                <div className="mt-1.5 pt-1 border-t border-slate-100 text-[9px] text-blue-600 font-semibold flex items-center gap-1">
                  <span>Click badge to trace step</span>
                </div>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </g>
  );
});

CustomConnectionEdge.displayName = 'CustomConnectionEdge';
