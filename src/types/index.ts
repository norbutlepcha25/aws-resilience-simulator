export type ServiceCategory =
  | 'Client / Ingress'
  | 'Compute'
  | 'Storage'
  | 'Databases'
  | 'Networking & Content Delivery'
  | 'Security, Identity & Compliance'
  | 'Integration & Messaging'
  | 'Analytics'
  | 'Machine Learning & AI'
  | 'Management & Governance'
  | 'Developer Tools'
  | 'Containers'
  | 'Frontend Web & Mobile'
  | 'Migration & Transfer'
  | 'Media Services'
  | 'Business Applications'
  | 'End User Computing'
  | 'Internet of Things (IoT)'
  | 'Cloud Financial Management'
  | 'Blockchain & Quantum'
  | 'Robotics & Satellite'
  // Backwards compatibility aliases
  | 'DNS / Edge'
  | 'Load Balancing'
  | 'Networking'
  | 'Security'
  | 'Messaging';

export type NodeHealth = 'healthy' | 'degraded' | 'failed';

export type ProtocolType =
  | 'HTTPS'
  | 'HTTP'
  | 'DNS'
  | 'SQL'
  | 'gRPC'
  | 'TCP'
  | 'Event'
  | 'Message'
  | 'Object access';

export type AvailabilityZone = 'AZ-A' | 'AZ-B' | 'AZ-C' | 'Multi-AZ' | 'Edge / Global';
export type SubnetType = 'public' | 'private' | 'isolated' | 'global' | 'unassigned';

export interface AWSService {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  architecturalRole: string;
  color: string;
  iconName: string;
  inputs: string[];
  outputs: string[];
  commonInteractions: ProtocolType[];
  dependencies: string[];
  failureModes: string[];
  resilienceCharacteristics: string[];
  scalabilityCharacteristics: string[];
  securityConsiderations: string[];
  alternatives: string[];
  teachingNotes: string[];
  defaultConfig?: {
    capacity?: number;
    replicas?: number;
    multiAz?: boolean;
    cached?: boolean;
    timeoutMs?: number;
  };
}

export interface ServiceNodeData extends Record<string, unknown> {
  serviceId: string;
  label: string;
  category: ServiceCategory;
  health: NodeHealth;
  az: AvailabilityZone;
  subnet: SubnetType;
  replicas: number;
  multiAz: boolean;
  notes?: string;
  /** IDs of `security_group` boundary nodes attached to this resource - explicit, like
   *  attaching a Security Group to an ENI in real AWS, independent of canvas position. */
  securityGroupIds?: string[];
  isSimulating?: boolean;
  simulationStatus?: 'active' | 'success' | 'failed' | 'idle';
  trafficLoad?: number;
  failureReason?: string;
  customConfig?: Record<string, any>;
}

export type FlowStatus = 'active' | 'completed' | 'pending' | 'failed' | 'dimmed' | 'idle';

export interface ConnectionData extends Record<string, unknown> {
  protocol: ProtocolType;
  label?: string;
  stepNumber?: number;
  interactionType: 'synchronous' | 'asynchronous' | 'cached' | 'event';
  isCriticalDependency: boolean;
  timeoutMs: number;
  animated?: boolean;
  isFailing?: boolean;
  isSimulating?: boolean;
  // Task Flow visualization
  flowStatus?: FlowStatus;
  flowStepNumber?: number;
  flowStepIndex?: number;
  flowAction?: string;
  flowLatency?: number;
  flowExplanation?: string;
  flowStatusCode?: number;
}

export interface SimulationStep {
  id: string;
  stepNumber: number;
  timestampMs: number;
  sourceNodeId: string;
  targetNodeId: string;
  sourceNodeName: string;
  targetNodeName: string;
  protocol: ProtocolType;
  action: string;
  status: 'processing' | 'success' | 'failed' | 'bypassed';
  explanation: string;
  targetHealth: NodeHealth;
  latencyMs: number;
  details?: {
    targetsEvaluated?: { id: string; name: string; health: NodeHealth; selected: boolean }[];
    cacheHit?: boolean;
    statusCode?: number;
    failureReason?: string;
    recoveryApplied?: string;
  };
}

export interface SimulationScenario {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  startNodeId: string;
  trafficLevel: 'low' | 'normal' | 'high' | 'very_high' | '10x' | '100x';
  simulateFailureCascade?: boolean;
}

export interface SimulationResult {
  scenario: SimulationScenario;
  steps: SimulationStep[];
  success: boolean;
  totalLatencyMs: number;
  statusCode: number;
  summary: string;
  bottlenecksDetected: string[];
  cascadeOccurred: boolean;
}

export interface ScoreDetail {
  score: number; // 0-100
  positiveReasons: string[];
  negativeReasons: string[];
}

export interface SPOFItem {
  nodeId: string;
  nodeName: string;
  serviceId: string;
  category: ServiceCategory;
  impactLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  impactPath: string[];
  explanation: string;
  mitigation: string;
}

export interface BottleneckItem {
  nodeId: string;
  nodeName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  explanation: string;
  mitigation: string;
}

export interface SecurityAuditItem {
  severity: 'CRITICAL' | 'WARNING' | 'GOOD';
  title: string;
  explanation: string;
  recommendation: string;
  affectedNodes: string[];
}

export interface ArchitectureAnalysis {
  availability: ScoreDetail;
  resilience: ScoreDetail;
  faultTolerance: ScoreDetail;
  scalability: ScoreDetail;
  security: ScoreDetail;
  spofs: SPOFItem[];
  bottlenecks: BottleneckItem[];
  securityIssues: SecurityAuditItem[];
  overallRating: 'Resilient' | 'Moderate' | 'Fragile' | 'Incomplete';
  summary: string;
}

export interface StudentChallenge {
  id: string;
  title: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  scenario: string;
  trafficScale: string;
  requirements: string[];
  evaluationCheck: (nodes: any[], edges: any[], analysis: ArchitectureAnalysis) => {
    passed: boolean;
    feedback: string[];
    score: number;
  };
  initialTemplateId?: string;
}

export type AppMode = 'design' | 'simulate' | 'failure' | 'analyze' | 'compare' | 'challenges' | 'teaching';
