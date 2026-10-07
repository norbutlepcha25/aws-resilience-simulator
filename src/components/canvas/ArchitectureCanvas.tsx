import { ReferenceLibrary } from '../references/ReferenceLibrary.tsx';
import { CanvasLayers, canvasLayerKey } from './CanvasLayers.tsx';
import { asgMembershipFrames } from '../../engine/layout/asgMembershipFrames.ts';
import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  ConnectionLineType,
  Panel,
  Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { ServiceNode } from './ServiceNode.tsx';
import { BoundaryNode } from './BoundaryNode.tsx';
import { CustomConnectionEdge } from './CustomConnectionEdge.tsx';
import { NodeContextMenu } from './NodeContextMenu.tsx';
import { NodeStatusModal } from './NodeStatusModal.tsx';
import { SERVICE_MAP } from '../../data/serviceCatalog.ts';
import { ServiceNodeData, NodeHealth } from '../../types/index.ts';
import { Route, Shield } from 'lucide-react';
import { useTheme } from '../../utils/theme.ts';

const nodeTypes = {
  asgMembershipFrame: ({ data }: any) => <div className="w-full h-full border-2 border-dashed border-orange-500 rounded-xl pointer-events-none bg-transparent"><span className="absolute left-3 top-1 px-1 bg-white text-xs font-semibold text-orange-700 dark:bg-[#0f1720] dark:text-orange-300">{data.label} · membership</span></div>,
  serviceNode: ServiceNode,
  boundaryNode: BoundaryNode
};

const edgeTypes = {
  custom: CustomConnectionEdge
};

export const ArchitectureCanvas: React.FC = () => {
  const {
    nodes,
    canvasRevision,
    draftViewport, setDraftViewport,
    onNodesChange,
    edges,
    onEdgesChange,
    onConnect,
    selectedNode,
    setSelectedNodeId,
    setSelectedEdgeId,
    addServiceNode,
    addBoundaryNode,
    removeNode,
    duplicateNode,
    setNodeHealth,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    highlightTaskFlow,
    toggleTaskFlow,
    simulationResult,
    showNaclSideColumn,
    setShowNaclSideColumn,
    hasCustomNacl,
    hasMissingReturnNacl
  } = useArchitecture();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [theme] = useTheme();
  const dark = theme === 'dark';
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  // Project visibility into React Flow without modifying the architecture used by the engine.
  const hiddenNodeIds = new Set(nodes.filter(node => hiddenLayers.has(canvasLayerKey(node))).map(node => node.id));
  const visibleNodes = nodes.map(node => hiddenNodeIds.has(node.id) ? { ...node, hidden: true } : node);
  const membershipFrames = asgMembershipFrames(visibleNodes);
  const displayedFrames = membershipFrames.map(node => hiddenLayers.has(canvasLayerKey(node)) ? { ...node, hidden: true } : node);
  const visibleEdges = edges.map(edge => hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target)
    ? { ...edge, hidden: true } : edge);
  useEffect(() => { setHiddenLayers(new Set()); }, [canvasRevision]);
  const selectedId = selectedNode?.id;

  // Global Keyboard shortcuts for layer order adjustments
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing into an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (!selectedId) return;

      if (e.key === ']') {
        e.preventDefault();
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          bringToFront(selectedId);
        } else {
          bringForward(selectedId);
        }
      } else if (e.key === '[') {
        e.preventDefault();
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          sendToBack(selectedId);
        } else {
          sendBackward(selectedId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, bringToFront, sendToBack, bringForward, sendBackward]);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: Node<any>;
  } | null>(null);

  // Status & Details modal state
  const [statusModalNode, setStatusModalNode] = useState<Node<ServiceNodeData> | null>(null);

  // Handle Drag Over from Service Palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle Drop on Canvas
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();

      // 1. Boundary Drop (VPC, Subnet, AZ, Security Group)
      const boundaryType = event.dataTransfer.getData('application/aws-boundary-type');
      if (boundaryType) {
        const position = {
          x: Math.max(20, event.clientX - bounds.left - 120),
          y: Math.max(20, event.clientY - bounds.top - 60)
        };
        addBoundaryNode(boundaryType, position);
        return;
      }

      // 2. Service Drop (EC2, S3, RDS, ALB, etc.)
      const serviceId = event.dataTransfer.getData('application/aws-service-id');
      if (!serviceId || !SERVICE_MAP[serviceId]) return;

      const position = {
        x: event.clientX - bounds.left - 60,
        y: event.clientY - bounds.top - 40
      };

      addServiceNode(serviceId, position);
    },
    [addServiceNode, addBoundaryNode]
  );

  // Node Click Selection (supports both services and boundary containers)
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setContextMenu(null);
    },
    [setSelectedNodeId, setSelectedEdgeId]
  );

  // Node Right-Click Context Menu (services and boundaries)
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Prevent native browser right-click menu
      event.preventDefault();
      event.stopPropagation();

      // Select right-clicked node
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);

      // Open custom context menu at mouse position
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        node: node
      });
    },
    [setSelectedNodeId, setSelectedEdgeId]
  );

  // Edge Click Selection
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: any) => {
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
      setContextMenu(null);
    },
    [setSelectedEdgeId, setSelectedNodeId]
  );

  // Pane Click Deselection & Close Context Menu
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [setSelectedNodeId, setSelectedEdgeId]);

  return (
    <div className={`lab-canvas relative w-full h-full flex-1 overflow-hidden select-none ${dark ? 'bg-[#0f1720]' : 'bg-white'}`} ref={reactFlowWrapper}>
      <ReactFlow
        key={canvasRevision}
        nodes={[...visibleNodes, ...displayedFrames]}
        edges={visibleEdges}
        onNodesChange={changes => onNodesChange(changes.filter(change => !('id' in change) || !membershipFrames.some(frame => frame.id === change.id)))}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionLineType={ConnectionLineType.Step}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        defaultViewport={draftViewport ?? undefined}
        onMoveEnd={(_, viewport) => setDraftViewport(viewport)}
        fitView={!draftViewport}
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2.0}
        proOptions={{ hideAttribution: true }}
        colorMode={theme}
        // Boundary containers (VPC, subnet, security group) carry their own z-index so they can
        // stack against each other, and public/private subnets render with an opaque background.
        // Under React Flow's default "basic" z mode, connection edges only elevate above a node
        // when that node has a parentId (true nesting), which this canvas never sets - so edges
        // were being painted under any opaque boundary they crossed. "manual" mode makes each
        // edge's z-index absolute instead of derived from the nodes it touches; combined with a
        // z-index far above any boundary (-3 to 1) or manual bring-to-front value a user could
        // reach, this keeps process/connection arrows visible above every container.
        zIndexMode="manual"
        defaultEdgeOptions={{ zIndex: 1000 }}
      >
        {/* Subtle Architectural Grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={dark ? '#2A3646' : '#E2E8F0'}
        />

        {/* Clean Controls */}
        <Controls
          className="!bg-white !border !border-slate-200 !rounded-lg !shadow-md !overflow-hidden [&>button]:!bg-white [&>button]:!border-b [&>button]:!border-slate-100 [&>button]:!text-slate-600 [&>button:hover]:!bg-slate-50 dark:!bg-slate-900 dark:!border-slate-700 dark:[&>button]:!bg-slate-900 dark:[&>button]:!border-slate-800 dark:[&>button]:!text-slate-300 dark:[&>button]:!fill-slate-300 dark:[&>button:hover]:!bg-slate-800"
          showInteractive={false}
        />


        {/* Canvas Task Flow Toggle */}
        <Panel position="top-left" className="m-3 flex items-center gap-2">
          <ReferenceLibrary />
          {/* Quick Flow of Task Toggle */}
          <button
            onClick={toggleTaskFlow}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium shadow-xs transition-all cursor-pointer backdrop-blur-sm ${
              highlightTaskFlow
                ? 'bg-white/95 border-circuit-400 text-circuit-700 ring-2 ring-circuit-500/10 dark:bg-slate-900/95 dark:text-circuit-300'
                : 'bg-white/80 border-slate-200 text-slate-600 hover:bg-white dark:bg-slate-900/80 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
            title={highlightTaskFlow ? 'Task flow line highlights enabled (click to disable)' : 'Click to highlight task flow lines'}
          >
            <Route className="w-3.5 h-3.5 text-circuit-600" />
            <span>Task Flow</span>
            <span className={`w-1.5 h-1.5 rounded-full ${highlightTaskFlow ? 'bg-circuit-600 animate-pulse' : 'bg-slate-300'}`} />
          </button>

          {/* Quick NACL Rules & Signals Side Column Toggle */}
          {hasCustomNacl && (
            <button
              onClick={() => setShowNaclSideColumn(!showNaclSideColumn)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold shadow-xs transition-all cursor-pointer backdrop-blur-sm ${
                showNaclSideColumn
                  ? 'bg-circuit-600 text-white border-circuit-600 ring-2 ring-circuit-400/30'
                  : 'bg-white/95 border-slate-200 text-slate-700 hover:bg-white hover:border-circuit-300 dark:bg-slate-900/95 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900'
              }`}
              title="Open NACL Details & Signal Monitor in Side Column"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>NACL Details</span>
              <span className={`w-1.5 h-1.5 rounded-full ${showNaclSideColumn ? 'bg-white' : 'bg-circuit-500 animate-pulse'}`} />
            </button>
          )}
        </Panel>

        <Panel position="top-right" className="m-3">
          <CanvasLayers nodes={[...nodes, ...membershipFrames]} hidden={hiddenLayers} onChange={setHiddenLayers} />
        </Panel>

        {/* Architectural Title Banner (from Problem 3.1) - only for the actual missing-return-rule
            condition Problem 3.1 diagnoses, not for every custom NACL (e.g. the "Enable NACL rule
            set" preset, which defaults to a complete rule set with no missing return). */}
        {hasMissingReturnNacl && (
          <Panel position="top-center" className="m-3">
            <div className="px-4 py-1.5 rounded-xl bg-white/95 border border-slate-300 shadow-sm backdrop-blur-sm pointer-events-none text-center dark:bg-slate-900/95 dark:border-slate-700">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 tracking-wide font-sans">
                Architectural Diagram addressing problem 3.1: Cause of connection timeout due to custom NACLs
              </span>
            </div>
          </Panel>
        )}

      </ReactFlow>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onOpenDetails={(node) => setStatusModalNode(node)}
          onDuplicate={(nodeId) => duplicateNode(nodeId)}
          onRemove={(nodeId) => removeNode(nodeId)}
          onSetHealth={(nodeId, health, reason) => setNodeHealth(nodeId, health, reason)}
          onBringToFront={(nodeId) => bringToFront(nodeId)}
          onSendToBack={(nodeId) => sendToBack(nodeId)}
          onBringForward={(nodeId) => bringForward(nodeId)}
          onSendBackward={(nodeId) => sendBackward(nodeId)}
        />
      )}

      {/* Node Status & Resilience Details Modal */}
      <NodeStatusModal
        node={statusModalNode}
        isOpen={!!statusModalNode}
        onClose={() => setStatusModalNode(null)}
      />
    </div>
  );
};
