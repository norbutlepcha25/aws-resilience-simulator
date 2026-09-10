import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType
} from '@xyflow/react';
import {
  ServiceNodeData,
  ConnectionData,
  AppMode,
  SimulationScenario,
  SimulationResult,
  SimulationStep,
  ArchitectureAnalysis,
  StudentChallenge,
  AvailabilityZone,
  ProtocolType,
  NodeHealth
} from '../types';
import { SERVICE_MAP } from '../data/serviceCatalog';
import { REFERENCE_ARCHITECTURES } from '../data/referenceArchitectures';
import { STUDENT_CHALLENGES } from '../data/studentChallenges';
import { runSimulation } from '../engine/simulation/requestSimulator';
import { analyzeArchitecture } from '../engine/analysis/rulesEngine';
import { deriveSubnetForNode, findContainingVpc, getBoundaryRect } from '../engine/layout/containment';
import { allocateSubnetCidrs } from '../engine/layout/cidrAllocator';
import { calculateArchitectureCost, ArchitectureCostReport } from '../engine/cost/costCalculator';

interface ArchitectureContextType {
  nodes: Node<ServiceNodeData>[];
  setNodes: React.Dispatch<React.SetStateAction<Node<ServiceNodeData>[]>>;
  onNodesChange: any;
  edges: Edge<ConnectionData>[];
  setEdges: React.Dispatch<React.SetStateAction<Edge<ConnectionData>[]>>;
  onEdgesChange: any;
  onConnect: (connection: Connection) => void;

  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  selectedNode: Node<ServiceNodeData> | null;
  setSelectedNodeId: (id: string | null) => void;
  selectedEdge: Edge<ConnectionData> | null;
  setSelectedEdgeId: (id: string | null) => void;

  addServiceNode: (serviceId: string, position?: { x: number; y: number }, options?: Partial<ServiceNodeData>) => void;
  addBoundaryNode: (boundaryType: string, position?: { x: number; y: number }, options?: { label?: string; width?: number; height?: number }) => string;
  updateNodeData: (id: string, data: Partial<ServiceNodeData>) => void;
  updateEdgeData: (id: string, data: Partial<ConnectionData>) => void;
  updateNodeDimensions: (id: string, width: number, height: number) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  setNodeZIndex: (id: string, zIndex: number) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  setNodeHealth: (id: string, health: NodeHealth, reason?: string) => void;
  deleteSelected: () => void;
  clearCanvas: () => void;

  // Failure controls
  toggleNodeFailure: (id: string) => void;
  failAvailabilityZone: (az: AvailabilityZone) => void;
  restoreAllNodes: () => void;

  // Simulation controls
  scenario: SimulationScenario;
  setScenario: React.Dispatch<React.SetStateAction<SimulationScenario>>;
  simulationResult: SimulationResult | null;
  activeStepIndex: number | null;
  setActiveStepIndex: (index: number | null) => void;
  runScenario: () => void;
  resetSimulation: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;

  // Task Flow visualization
  highlightTaskFlow: boolean;
  setHighlightTaskFlow: (val: boolean) => void;
  toggleTaskFlow: () => void;
  hoveredStepIndex: number | null;
  setHoveredStepIndex: (index: number | null) => void;

  // Architecture Analysis
  analysis: ArchitectureAnalysis;
  recalculateAnalysis: () => void;

  // Challenges & Templates
  loadTemplate: (templateId: string) => void;
  activeChallenge: StudentChallenge | null;
  setActiveChallenge: (challenge: StudentChallenge | null) => void;
  challengeResult: { passed: boolean; feedback: string[]; score: number } | null;
  runChallengeTest: () => void;

  // Teaching / Projector Mode
  isTeachingMode: boolean;
  setIsTeachingMode: (val: boolean) => void;

  // AWS Cost & Billing Simulator
  costReport: ArchitectureCostReport;
}

const ArchitectureContext = createContext<ArchitectureContextType | null>(null);

export const ArchitectureProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Start with a clean blank canvas for students to design and construct from scratch
  const [nodes, setNodes, rawOnNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);

  // Synchronize dynamic dimension changes (e.g. from NodeResizer) into node.data and node.style
  const onNodesChange = useCallback((changes: any[]) => {
    rawOnNodesChange(changes);
    const dimChanges = changes.filter(c => c.type === 'dimensions' && c.dimensions);
    if (dimChanges.length > 0) {
      setNodes(nds =>
        nds.map(n => {
          const dc = dimChanges.find(d => d.id === n.id);
          if (dc && dc.dimensions) {
            return {
              ...n,
              data: {
                ...n.data,
                width: Math.round(dc.dimensions.width),
                height: Math.round(dc.dimensions.height)
              },
              style: {
                ...n.style,
                width: Math.round(dc.dimensions.width),
                height: Math.round(dc.dimensions.height)
              }
            };
          }
          return n;
        })
      );
    }
  }, [rawOnNodesChange, setNodes]);

  // A node's real subnet is whatever boundary box it is geometrically inside right now, not
  // whatever value happens to be stored on it - otherwise dragging an ALB out of its VPC would
  // leave it still behaving as a valid public-subnet resource. Recomputed from the current node
  // positions on every change (drag, drop, resize of a boundary, template load) and only
  // written back when it actually disagrees, so this settles in one extra pass and never loops.
  //
  // The same pass also auto-carves each VPC's own CIDR block across the Public/Private subnet
  // boundaries drawn inside it - a subnet's CIDR is never typed by hand, only the VPC's is.
  // Public subnets are numbered first (left-to-right, top-to-bottom), then private subnets,
  // so a VPC with 2 public + 2 private subnets reliably gets .0/.1 for public and .2/.3 for
  // private. This can never violate AWS subnetting rules by construction: allocateSubnetCidrs
  // always produces equal, non-overlapping blocks carved out of the VPC's own range, and refuses
  // (with an explanatory error surfaced on the subnet) rather than emit a subnet smaller than
  // AWS's real /28 floor.
  useEffect(() => {
    const boundaryNodes = nodes.filter(n => n.type === 'boundaryNode');

    const subnetBoundaries = boundaryNodes.filter(
      b => (b.data as any)?.boundaryType === 'public_subnet' || (b.data as any)?.boundaryType === 'private_subnet'
    );

    // Group subnet boundaries by the VPC that actually contains them, ordering public subnets
    // before private ones (each sorted left-to-right then top-to-bottom) for stable numbering.
    const byVpc = new Map<string, Node<any>[]>();
    const orphanSubnetIds = new Set<string>();
    for (const subnet of subnetBoundaries) {
      const vpc = findContainingVpc(subnet, boundaryNodes);
      if (!vpc) {
        orphanSubnetIds.add(subnet.id);
        continue;
      }
      const list = byVpc.get(vpc.id) || [];
      list.push(subnet);
      byVpc.set(vpc.id, list);
    }

    const positionSort = (a: Node<any>, b: Node<any>) => {
      const ra = getBoundaryRect(a);
      const rb = getBoundaryRect(b);
      return ra.y - rb.y || ra.x - rb.x;
    };

    const cidrById = new Map<string, {
      cidr: string | null;
      totalAddresses: number | null;
      usableHosts: number | null;
      reservedAddresses: any[];
      usableRange: any;
      error: string | null;
    }>();
    for (const [vpcId, subnetsInVpc] of byVpc) {
      const vpcNode = boundaryNodes.find(b => b.id === vpcId)!;
      const publicOnes = subnetsInVpc.filter(s => (s.data as any).boundaryType === 'public_subnet').sort(positionSort);
      const privateOnes = subnetsInVpc.filter(s => (s.data as any).boundaryType === 'private_subnet').sort(positionSort);
      const orderedIds = [...publicOnes, ...privateOnes].map(s => s.id);

      const allocations = allocateSubnetCidrs((vpcNode.data as any)?.cidr, orderedIds);
      allocations.forEach((allocation, id) => cidrById.set(id, {
        cidr: allocation.cidr,
        totalAddresses: allocation.totalAddresses,
        usableHosts: allocation.usableHosts,
        reservedAddresses: allocation.reservedAddresses,
        usableRange: allocation.usableRange,
        error: allocation.error
      }));
    }
    orphanSubnetIds.forEach(id =>
      cidrById.set(id, {
        cidr: null,
        totalAddresses: null,
        usableHosts: null,
        reservedAddresses: [],
        usableRange: null,
        error: 'This subnet is not inside any VPC boundary, so it has no address space to be carved from.'
      })
    );

    let changed = false;

    const nextNodes = nodes.map(n => {
      const isServiceNode = n.type === 'serviceNode' || (n.type !== 'boundaryNode' && (n.data as any)?.serviceId);
      if (isServiceNode) {
        const derivedSubnet = deriveSubnetForNode(n, boundaryNodes);
        if ((n.data as any)?.subnet === derivedSubnet) return n;
        changed = true;
        return { ...n, data: { ...n.data, subnet: derivedSubnet } };
      }

      if (cidrById.has(n.id)) {
        const alloc = cidrById.get(n.id)!;
        if (
          (n.data as any)?.cidr === (alloc.cidr ?? undefined) &&
          (n.data as any)?.cidrError === (alloc.error ?? undefined) &&
          (n.data as any)?.usableHosts === (alloc.usableHosts ?? undefined)
        ) {
          return n;
        }
        changed = true;
        return {
          ...n,
          data: {
            ...n.data,
            cidr: alloc.cidr ?? undefined,
            cidrError: alloc.error ?? undefined,
            totalAddresses: alloc.totalAddresses ?? undefined,
            usableHosts: alloc.usableHosts ?? undefined,
            reservedAddresses: alloc.reservedAddresses,
            usableRange: alloc.usableRange
          }
        };
      }

      return n;
    });

    if (changed) {
      setNodes(nextNodes);
    }
  }, [nodes, setNodes]);

  const [appMode, setAppMode] = useState<AppMode>('design');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [scenario, setScenario] = useState<SimulationScenario>({
    id: 'default-scenario',
    name: 'Application Request',
    method: 'GET',
    path: '/api/v1/resource',
    startNodeId: '',
    trafficLevel: 'normal'
  });

  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [highlightTaskFlow, setHighlightTaskFlow] = useState<boolean>(true);
  const [hoveredStepIndex, setHoveredStepIndex] = useState<number | null>(null);

  const [activeChallenge, setActiveChallenge] = useState<StudentChallenge | null>(null);
  const [challengeResult, setChallengeResult] = useState<{ passed: boolean; feedback: string[]; score: number } | null>(null);
  const [isTeachingMode, setIsTeachingMode] = useState<boolean>(false);

  // Compute Analysis dynamically
  const analysis = useMemo(() => {
    return analyzeArchitecture(nodes, edges);
  }, [nodes, edges]);

  // Compute Architecture Bill dynamically
  const costReport = useMemo(() => {
    return calculateArchitectureCost(nodes, scenario.trafficLevel);
  }, [nodes, scenario.trafficLevel]);

  const recalculateAnalysis = useCallback(() => {
    // triggers useMemo automatically
  }, []);

  // Selected entities
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const selectedEdge = useMemo(() => {
    return edges.find(e => e.id === selectedEdgeId) || null;
  }, [edges, selectedEdgeId]);

  // Connect handler with default protocols based on source/target
  const onConnect = useCallback((connection: Connection) => {
    // A node cannot depend on itself: a self-loop is an immediate routing cycle.
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);

    // Both endpoints must be real service nodes. Boundary containers (VPC, subnet, AZ,
    // security group) are visual grouping only, and the simulator skips them, which
    // would leave a traversal with no next hop.
    if (!sourceNode || !targetNode) return;
    if (sourceNode.type === 'boundaryNode' || targetNode.type === 'boundaryNode') return;

    // Ignore a duplicate connection between the same pair of services.
    if (edges.some(e => e.source === connection.source && e.target === connection.target)) {
      return;
    }

    let defaultProtocol: ProtocolType = 'HTTP';
    if (targetNode?.data.serviceId === 'rds') {
      defaultProtocol = 'SQL';
    } else if (targetNode?.data.serviceId === 'sqs' || targetNode?.data.serviceId === 'sns') {
      defaultProtocol = 'Message';
    } else if (sourceNode?.data.serviceId === 'route53') {
      defaultProtocol = 'DNS';
    } else if (sourceNode?.data.serviceId === 'user') {
      defaultProtocol = 'HTTPS';
    } else if (targetNode?.data.serviceId === 's3') {
      defaultProtocol = 'Object access';
    }

    const newEdge: Edge<ConnectionData> = {
      ...connection,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
      type: 'custom',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#94A3B8'
      },
      data: {
        protocol: defaultProtocol,
        interactionType: 'synchronous',
        isCriticalDependency: true,
        timeoutMs: 2500
      }
    };

    setEdges((eds) => addEdge(newEdge as any, eds as any) as any);
  }, [nodes, edges, setEdges]);

  // Add a new node to canvas
  const addServiceNode = useCallback((
    serviceId: string,
    position?: { x: number; y: number },
    options?: Partial<ServiceNodeData>
  ) => {
    const serviceDef = SERVICE_MAP[serviceId];
    if (!serviceDef) return;

    const count = nodes.filter(n => n.data.serviceId === serviceId).length;
    const label = count > 0 ? `${serviceDef.name} #${count + 1}` : serviceDef.name;

    const newNode: Node<ServiceNodeData> = {
      id: `node-${serviceId}-${Date.now()}`,
      type: 'serviceNode',
      position: position || {
        x: 100 + Math.random() * 400,
        y: 100 + Math.random() * 250
      },
      data: {
        serviceId,
        label: options?.label || label,
        category: serviceDef.category,
        health: 'healthy',
        az: options?.az || (serviceDef.defaultConfig?.multiAz ? 'Multi-AZ' : 'AZ-A'),
        subnet: options?.subnet || (['user', 'route53', 'cloudfront'].includes(serviceId) ? 'global' : ['alb', 'api_gateway'].includes(serviceId) ? 'public' : 'private'),
        replicas: options?.replicas || serviceDef.defaultConfig?.replicas || 1,
        multiAz: options?.multiAz !== undefined ? options.multiAz : (serviceDef.defaultConfig?.multiAz || false),
        ...options
      }
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNode.id);
  }, [nodes, setNodes]);

  // Add a new boundary/group container to canvas
  const addBoundaryNode = useCallback((
    boundaryType: string,
    position?: { x: number; y: number },
    options?: { label?: string; width?: number; height?: number }
  ): string => {
    const defs: Record<string, { label: string; width: number; height: number; zIndex: number }> = {
      region: { label: 'Region (us-east-1)', width: 980, height: 600, zIndex: -3 },
      vpc: { label: 'VPC', width: 880, height: 500, zIndex: -2 },
      az: { label: 'Availability Zone', width: 360, height: 560, zIndex: -1 },
      availability_zone: { label: 'Availability Zone', width: 360, height: 560, zIndex: -1 },
      public_subnet: { label: 'Public subnet', width: 320, height: 200, zIndex: 0 },
      private_subnet: { label: 'Private subnet', width: 320, height: 200, zIndex: 0 },
      security_group: { label: 'Security group', width: 700, height: 130, zIndex: 1 },
      account: { label: "Customer's AWS Account", width: 800, height: 550, zIndex: -3 }
    };

    const config = defs[boundaryType] || { label: 'Boundary', width: 400, height: 300, zIndex: -1 };
    const count = nodes.filter(n => n.type === 'boundaryNode' && (n.data as any)?.boundaryType === boundaryType).length;
    const label = options?.label || (count > 0 ? `${config.label} #${count + 1}` : config.label);

    const newBoundary: Node<any> = {
      id: `box-${boundaryType}-${Date.now()}`,
      type: 'boundaryNode',
      position: position || { x: 100, y: 100 },
      data: {
        label,
        boundaryType,
        width: options?.width || config.width,
        height: options?.height || config.height,
        // A VPC needs an address block from the moment it exists, so subnets drawn inside it
        // have something to be carved from immediately, without the student having to open the
        // inspector first. Subnets themselves get no default - their CIDR is always derived.
        ...(boundaryType === 'vpc' ? { cidr: '10.0.0.0/16' } : {})
      },
      style: {
        width: options?.width || config.width,
        height: options?.height || config.height
      },
      draggable: true,
      selectable: true,
      zIndex: config.zIndex
    };

    setNodes(nds => [newBoundary, ...nds]);
    return newBoundary.id;
  }, [nodes, setNodes]);

  // Update node data
  const updateNodeData = useCallback((id: string, partialData: Partial<ServiceNodeData>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              ...partialData
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Update node dimensions (both data and style)
  const updateNodeDimensions = useCallback((id: string, width: number, height: number) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              width: Math.round(width),
              height: Math.round(height)
            },
            style: {
              ...node.style,
              width: Math.round(width),
              height: Math.round(height)
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Layer Management: Bring node to front (highest z-index on canvas)
  const bringToFront = useCallback((id: string) => {
    setNodes((nds) => {
      const maxZ = nds.reduce((max, n) => Math.max(max, n.zIndex ?? 0), 0);
      return nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            zIndex: maxZ + 1
          };
        }
        return node;
      });
    });
  }, [setNodes]);

  // Layer Management: Send node to back (lowest z-index on canvas)
  const sendToBack = useCallback((id: string) => {
    setNodes((nds) => {
      const minZ = nds.reduce((min, n) => Math.min(min, n.zIndex ?? 0), 0);
      return nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            zIndex: minZ - 1
          };
        }
        return node;
      });
    });
  }, [setNodes]);

  // Layer Management: Bring forward (+1 z-index)
  const bringForward = useCallback((id: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            zIndex: (node.zIndex ?? 0) + 1
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Layer Management: Send backward (-1 z-index)
  const sendBackward = useCallback((id: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            zIndex: (node.zIndex ?? 0) - 1
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Layer Management: Set explicit numerical z-index
  const setNodeZIndex = useCallback((id: string, zIndex: number) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            zIndex
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Update edge data
  const updateEdgeData = useCallback((id: string, partialData: Partial<ConnectionData>) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === id) {
          return {
            ...edge,
            data: {
              ...(edge.data as ConnectionData),
              ...partialData
            }
          };
        }
        return edge;
      })
    );
  }, [setEdges]);

  // Remove a specific node and its connected edges
  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    if (selectedNodeId === id) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, setNodes, setEdges]);

  // Duplicate a specific node with an offset position
  const duplicateNode = useCallback((id: string) => {
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) return;

    const serviceDef = SERVICE_MAP[targetNode.data.serviceId];
    const newId = `node-${targetNode.data.serviceId}-${Date.now()}`;
    const baseLabel = targetNode.data.label || serviceDef?.name || 'Node';

    const newNode: Node<ServiceNodeData> = {
      id: newId,
      type: 'serviceNode',
      position: {
        x: targetNode.position.x + 50,
        y: targetNode.position.y + 50
      },
      data: {
        ...targetNode.data,
        label: `${baseLabel} (Copy)`,
        health: 'healthy',
        failureReason: undefined,
        isSimulating: false
      }
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
  }, [nodes, setNodes]);

  // Set health of a specific node
  const setNodeHealth = useCallback((id: string, health: NodeHealth, reason?: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              health,
              failureReason: health !== 'healthy' ? (reason || `Marked as ${health}`) : undefined
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Delete selected node or edge
  const deleteSelected = useCallback(() => {
    if (selectedNodeId) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [selectedNodeId, selectedEdgeId, setNodes, setEdges]);

  // Clear canvas
  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSimulationResult(null);
    setActiveStepIndex(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setNodes, setEdges]);

  // Toggle failure of a single node
  const toggleNodeFailure = useCallback((id: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const newHealth: NodeHealth = node.data.health === 'failed' ? 'healthy' : 'failed';
          return {
            ...node,
            data: {
              ...node.data,
              health: newHealth,
              failureReason: newHealth === 'failed' ? 'Deliberate Failure Injected' : undefined
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Fail an entire Availability Zone
  const failAvailabilityZone = useCallback((az: AvailabilityZone) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.data.az === az) {
          return {
            ...node,
            data: {
              ...node.data,
              health: 'failed',
              failureReason: `Zone Outage (${az} Hardware Failure)`
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Restore all nodes to healthy
  const restoreAllNodes = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          health: 'healthy',
          failureReason: undefined,
          isSimulating: false
        }
      }))
    );
    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        data: {
          ...(edge.data as ConnectionData),
          isSimulating: false,
          isFailing: false
        }
      }))
    );
    setSimulationResult(null);
    setActiveStepIndex(null);
    setIsPlaying(false);
  }, [setNodes, setEdges]);

  // Load a reference architecture template
  const loadTemplate = useCallback((templateId: string) => {
    const template = REFERENCE_ARCHITECTURES.find(t => t.id === templateId);
    if (!template) return;

    setNodes(template.nodes);
    setEdges(template.edges);
    setSimulationResult(null);
    setActiveStepIndex(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);

    // Auto-align scenario startNodeId with an ingress service in the loaded template
    const serviceNodes = template.nodes.filter(n => n.type === 'serviceNode' || (n.data && (n.data as any).serviceId));
    const ingressNode = serviceNodes.find(n => ['user', 'client_ui', 'api_client'].includes((n.data as any).serviceId))
      || serviceNodes.find(n => ['internet_gateway', 'cloudfront', 'route53', 'alb', 'api_gateway'].includes((n.data as any).serviceId))
      || serviceNodes[0];

    if (ingressNode) {
      setScenario(prev => ({
        ...prev,
        startNodeId: ingressNode.id
      }));
    }
  }, [setNodes, setEdges]);

  // Run Request Simulation
  const runScenario = useCallback(() => {
    const result = runSimulation(nodes, edges, scenario);
    setSimulationResult(result);
    setActiveStepIndex(0);
    setHoveredStepIndex(null);
    setHighlightTaskFlow(true);
    setIsPlaying(true);
    setAppMode('simulate');
  }, [nodes, edges, scenario]);

  // Toggle Task Flow lines on/off with smart auto-simulation
  const toggleTaskFlow = useCallback(() => {
    setHighlightTaskFlow((prev) => {
      const next = !prev;
      if (next && !simulationResult && nodes.length > 0) {
        const result = runSimulation(nodes, edges, scenario);
        setSimulationResult(result);
        setActiveStepIndex(null);
      }
      return next;
    });
  }, [nodes, edges, scenario, simulationResult]);

  const resetSimulation = useCallback(() => {
    setIsPlaying(false);
    setActiveStepIndex(null);
    setHoveredStepIndex(null);
    // Clear simulation pulses from nodes & edges
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, isSimulating: false, simulationStatus: 'idle' } })));
    setEdges(eds => eds.map(e => ({
      ...e,
      data: {
        ...(e.data as ConnectionData),
        isSimulating: false,
        isFailing: false,
        flowStatus: (e.data as any)?.stepNumber ? 'completed' : 'idle',
        flowStepNumber: (e.data as any)?.stepNumber,
        flowStepIndex: undefined,
        flowAction: undefined,
        flowLatency: undefined,
        flowExplanation: undefined,
        flowStatusCode: undefined
      }
    })));
  }, [setNodes, setEdges]);

  // Step Forward in simulation
  const stepForward = useCallback(() => {
    if (!simulationResult) return;
    setActiveStepIndex((prev) => {
      const next = prev === null ? 0 : prev + 1;
      if (next >= simulationResult.steps.length) {
        setIsPlaying(false);
        return prev;
      }
      return next;
    });
  }, [simulationResult]);

  // Step Backward in simulation
  const stepBackward = useCallback(() => {
    if (!simulationResult) return;
    setActiveStepIndex((prev) => {
      if (prev === null || prev <= 0) return 0;
      return prev - 1;
    });
  }, [simulationResult]);

  // Effect: Calculate and apply Task Flow highlighting to lines & nodes
  useEffect(() => {
    // If highlightTaskFlow is OFF:
    if (!highlightTaskFlow) {
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, isSimulating: false, simulationStatus: 'idle' } })));
      setEdges(eds => eds.map(e => ({
        ...e,
        data: {
          ...(e.data as ConnectionData),
          isSimulating: false,
          isFailing: false,
          flowStatus: 'idle',
          flowStepNumber: (e.data as any)?.stepNumber,
          flowStepIndex: undefined,
          flowAction: undefined,
          flowLatency: undefined,
          flowExplanation: undefined,
          flowStatusCode: undefined
        }
      })));
      return;
    }

    // Determine target step for current focus (hovered step takes priority over active step for interactive scrubbing)
    const focusStepIndex = hoveredStepIndex !== null ? hoveredStepIndex : activeStepIndex;

    // Case 1: Active simulation result exists
    if (simulationResult && simulationResult.steps.length > 0) {
      const steps = simulationResult.steps;
      const currentStep = focusStepIndex !== null ? steps[focusStepIndex] : null;

      // Update node states along the task flow
      setNodes(nds =>
        nds.map(node => {
          const isCurrentTarget = currentStep ? node.id === currentStep.targetNodeId : false;
          const isCurrentSource = currentStep ? node.id === currentStep.sourceNodeId : false;
          const hasParticipated = steps.some((s, idx) =>
            (focusStepIndex === null || idx <= focusStepIndex) &&
            (s.targetNodeId === node.id || s.sourceNodeId === node.id)
          );
          return {
            ...node,
            data: {
              ...node.data,
              isSimulating: isCurrentTarget || isCurrentSource,
              simulationStatus: (isCurrentTarget || isCurrentSource)
                ? (currentStep?.status === 'failed' ? 'failed' : 'active')
                : hasParticipated
                ? 'success'
                : 'idle'
            }
          };
        })
      );

      // Update edges: Highlight the exact path representing the task flow
      setEdges(eds =>
        eds.map(edge => {
          // Find all steps that traverse this edge (either source->target or target->source)
          const matchingSteps: { step: SimulationStep; index: number }[] = [];
          steps.forEach((s, idx) => {
            const isMatch =
              (edge.source === s.sourceNodeId && edge.target === s.targetNodeId) ||
              (edge.source === s.targetNodeId && edge.target === s.sourceNodeId);
            if (isMatch) {
              matchingSteps.push({ step: s, index: idx });
            }
          });

          // If edge does not participate in this task flow, dim it
          if (matchingSteps.length === 0) {
            return {
              ...edge,
              data: {
                ...(edge.data as ConnectionData),
                isSimulating: false,
                isFailing: false,
                flowStatus: 'dimmed',
                flowStepNumber: (edge.data as any)?.stepNumber,
                flowStepIndex: undefined,
                flowAction: undefined,
                flowLatency: undefined,
                flowExplanation: undefined,
                flowStatusCode: undefined
              }
            };
          }

          // Edge is part of the task flow!
          if (focusStepIndex !== null) {
            // Check if this edge is the active step being processed
            const activeMatch = matchingSteps.find(m => m.index === focusStepIndex);
            if (activeMatch) {
              const isFail = activeMatch.step.status === 'failed';
              return {
                ...edge,
                data: {
                  ...(edge.data as ConnectionData),
                  isSimulating: true,
                  isFailing: isFail,
                  flowStatus: isFail ? 'failed' : 'active',
                  flowStepNumber: activeMatch.step.stepNumber,
                  flowStepIndex: activeMatch.index,
                  flowAction: activeMatch.step.action,
                  flowLatency: activeMatch.step.latencyMs,
                  flowExplanation: activeMatch.step.explanation,
                  flowStatusCode: activeMatch.step.details?.statusCode
                }
              };
            }

            // Check if this edge was completed prior to current focus
            const completedMatches = matchingSteps.filter(m => m.index < focusStepIndex);
            if (completedMatches.length > 0) {
              const lastCompleted = completedMatches[completedMatches.length - 1];
              const isFail = lastCompleted.step.status === 'failed';
              return {
                ...edge,
                data: {
                  ...(edge.data as ConnectionData),
                  isSimulating: false,
                  isFailing: isFail,
                  flowStatus: isFail ? 'failed' : 'completed',
                  flowStepNumber: lastCompleted.step.stepNumber,
                  flowStepIndex: lastCompleted.index,
                  flowAction: lastCompleted.step.action,
                  flowLatency: lastCompleted.step.latencyMs,
                  flowExplanation: lastCompleted.step.explanation,
                  flowStatusCode: lastCompleted.step.details?.statusCode
                }
              };
            }

            // Otherwise, this step is upcoming/pending in the task flow
            const pendingMatch = matchingSteps[0];
            return {
              ...edge,
              data: {
                ...(edge.data as ConnectionData),
                isSimulating: false,
                isFailing: false,
                flowStatus: 'pending',
                flowStepNumber: pendingMatch.step.stepNumber,
                flowStepIndex: pendingMatch.index,
                flowAction: pendingMatch.step.action,
                flowLatency: pendingMatch.step.latencyMs,
                flowExplanation: pendingMatch.step.explanation,
                flowStatusCode: pendingMatch.step.details?.statusCode
              }
            };
          }

          // When focusStepIndex is null (showing complete task flow at a glance)
          const primaryMatch = matchingSteps[0];
          const anyFailed = matchingSteps.some(m => m.step.status === 'failed');
          return {
            ...edge,
            data: {
              ...(edge.data as ConnectionData),
              isSimulating: false,
              isFailing: anyFailed,
              flowStatus: anyFailed ? 'failed' : 'completed',
              flowStepNumber: primaryMatch.step.stepNumber,
              flowStepIndex: primaryMatch.index,
              flowAction: primaryMatch.step.action,
              flowLatency: primaryMatch.step.latencyMs,
              flowExplanation: primaryMatch.step.explanation,
              flowStatusCode: primaryMatch.step.details?.statusCode
            }
          };
        })
      );
      return;
    }

    // Case 2: No active simulation result yet, but template edges might have pre-configured stepNumber
    setEdges(eds =>
      eds.map(edge => {
        const stepNum = (edge.data as any)?.stepNumber;
        if (stepNum) {
          return {
            ...edge,
            data: {
              ...(edge.data as ConnectionData),
              isSimulating: false,
              isFailing: false,
              flowStatus: 'completed',
              flowStepNumber: stepNum
            }
          };
        }
        return {
          ...edge,
          data: {
            ...(edge.data as ConnectionData),
            isSimulating: false,
            isFailing: false,
            flowStatus: 'idle',
            flowStepNumber: undefined
          }
        };
      })
    );
  }, [highlightTaskFlow, activeStepIndex, hoveredStepIndex, simulationResult, setNodes, setEdges]);

  // Effect: Auto-advance simulation when isPlaying is true
  useEffect(() => {
    if (!isPlaying || !simulationResult || activeStepIndex === null) return;

    const delay = Math.max(400, 1200 / playbackSpeed);
    const timer = setTimeout(() => {
      if (activeStepIndex < simulationResult.steps.length - 1) {
        setActiveStepIndex(prev => (prev !== null ? prev + 1 : 0));
      } else {
        setIsPlaying(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [isPlaying, activeStepIndex, simulationResult, playbackSpeed]);

  // Challenge test
  const runChallengeTest = useCallback(() => {
    if (!activeChallenge) return;
    const res = activeChallenge.evaluationCheck(nodes, edges, analysis);
    setChallengeResult(res);
  }, [activeChallenge, nodes, edges, analysis]);

  return (
    <ArchitectureContext.Provider
      value={{
        nodes,
        setNodes,
        onNodesChange,
        edges,
        setEdges,
        onEdgesChange,
        onConnect,

        appMode,
        setAppMode,

        selectedNode,
        setSelectedNodeId,
        selectedEdge,
        setSelectedEdgeId,

        addServiceNode,
        addBoundaryNode,
        updateNodeData,
        updateEdgeData,
        updateNodeDimensions,
        bringToFront,
        sendToBack,
        bringForward,
        sendBackward,
        setNodeZIndex,
        removeNode,
        duplicateNode,
        setNodeHealth,
        deleteSelected,
        clearCanvas,

        toggleNodeFailure,
        failAvailabilityZone,
        restoreAllNodes,

        scenario,
        setScenario,
        simulationResult,
        activeStepIndex,
        setActiveStepIndex,
        runScenario,
        resetSimulation,
        stepForward,
        stepBackward,
        isPlaying,
        setIsPlaying,
        playbackSpeed,
        setPlaybackSpeed,

        highlightTaskFlow,
        setHighlightTaskFlow,
        toggleTaskFlow,
        hoveredStepIndex,
        setHoveredStepIndex,

        analysis,
        recalculateAnalysis,

        loadTemplate,
        activeChallenge,
        setActiveChallenge,
        challengeResult,
        runChallengeTest,

        isTeachingMode,
        setIsTeachingMode,

        costReport
      }}
    >
      {children}
    </ArchitectureContext.Provider>
  );
};

export const useArchitecture = () => {
  const context = useContext(ArchitectureContext);
  if (!context) {
    throw new Error('useArchitecture must be used within an ArchitectureProvider');
  }
  return context;
};
