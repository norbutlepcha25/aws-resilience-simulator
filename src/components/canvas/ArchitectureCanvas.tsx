import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
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
import { Route } from 'lucide-react';

const nodeTypes = {
  serviceNode: ServiceNode,
  boundaryNode: BoundaryNode
};

const edgeTypes = {
  custom: CustomConnectionEdge
};

export const ArchitectureCanvas: React.FC = () => {
  const {
    nodes,
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
    simulationResult
  } = useArchitecture();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
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
    <div className="relative w-full h-full bg-white flex-1 overflow-hidden select-none" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2.0}
        proOptions={{ hideAttribution: true }}
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
          color="#E2E8F0"
        />

        {/* Clean Controls */}
        <Controls
          className="!bg-white !border !border-slate-200 !rounded-lg !shadow-md !overflow-hidden [&>button]:!bg-white [&>button]:!border-b [&>button]:!border-slate-100 [&>button]:!text-slate-600 [&>button:hover]:!bg-slate-50"
          showInteractive={false}
        />


        {/* Official AWS Cloud Top-Left Header Watermark & Task Flow Toggle */}
        <Panel position="top-left" className="m-3 flex items-center gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-white/90 border border-slate-300 shadow-sm backdrop-blur-sm pointer-events-none">
            <svg width="22" height="14" viewBox="0 0 40 24" fill="none">
              <path d="M12 20C6 20 1 15 1 9C1 4.5 5 1 10 1C11.5 1 13 1.5 14 2C16 0.5 18.5 0 21 0C27 0 32 4.5 32 10.5C35 11 38 13.5 38 17C38 21 34.5 24 30 24H12C8 24 4 21 4 17" stroke="#232F3E" strokeWidth="2.5" />
            </svg>
            <span className="text-xs font-bold text-slate-800 tracking-tight">
              AWS Cloud
            </span>
          </div>

          {/* Quick Flow of Task Toggle */}
          <button
            onClick={toggleTaskFlow}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium shadow-xs transition-all cursor-pointer backdrop-blur-sm ${
              highlightTaskFlow
                ? 'bg-white/95 border-blue-400 text-blue-700 ring-2 ring-blue-500/10'
                : 'bg-white/80 border-slate-200 text-slate-600 hover:bg-white'
            }`}
            title={highlightTaskFlow ? 'Task flow line highlights enabled (click to disable)' : 'Click to highlight task flow lines'}
          >
            <Route className="w-3.5 h-3.5 text-blue-600" />
            <span>Task Flow</span>
            <span className={`w-1.5 h-1.5 rounded-full ${highlightTaskFlow ? 'bg-blue-600 animate-pulse' : 'bg-slate-300'}`} />
          </button>
        </Panel>

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
