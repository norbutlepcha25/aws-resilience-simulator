import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../types/index.ts';

export interface ReferenceArchitecture {
  id: string;
  name: string;
  category: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  description: string;
  learningOutcome: string;
  nodes: Node<any>[];
  edges: Edge<any>[];
}

export const REFERENCE_ARCHITECTURES: ReferenceArchitecture[] = [
  {
    id: 'vpc-subnets-multi-az-security-groups',
    name: 'Multi-AZ VPC with Public & Private Subnets & Security Groups',
    category: 'Networking & VPC Design',
    difficulty: 'Intermediate',
    description: 'Official AWS Architecture: Region boundary, VPC, dual Availability Zones, Public subnets (Web servers), Private subnets (Database servers), cross-AZ Security Groups, Internet Gateway, ALB, and S3 Gateway Endpoint.',
    learningOutcome: 'Demonstrates the foundational AWS 3-tier networking model: public ingress through IGW & ALB, database isolation in private subnets, security group boundaries, and direct S3 VPC gateway routing.',
    nodes: [
      // 1. Boundary: Region
      {
        id: 'box-region',
        type: 'boundaryNode',
        position: { x: 20, y: 20 },
        data: {
          label: 'Region',
          boundaryType: 'region',
          width: 890,
          height: 600
        },
        style: { width: 890, height: 600 },
        draggable: true,
        selectable: true,
        zIndex: -3
      },

      // 2. Boundary: VPC
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 125, y: 90 },
        data: {
          label: 'VPC',
          boundaryType: 'vpc',
          width: 770,
          height: 490,
          cidr: '10.0.0.0/16'
        },
        style: { width: 770, height: 490 },
        draggable: true,
        selectable: true,
        zIndex: -2
      },

      // 3. Boundary: Availability Zone A (Left)
      {
        id: 'box-az-a',
        type: 'boundaryNode',
        position: { x: 165, y: 50 },
        data: {
          label: 'Availability Zone',
          boundaryType: 'az',
          width: 330,
          height: 550
        },
        style: { width: 330, height: 550 },
        draggable: true,
        selectable: true,
        zIndex: -1
      },

      // 4. Boundary: Availability Zone B (Right)
      {
        id: 'box-az-b',
        type: 'boundaryNode',
        position: { x: 535, y: 50 },
        data: {
          label: 'Availability Zone',
          boundaryType: 'az',
          width: 330,
          height: 550
        },
        style: { width: 330, height: 550 },
        draggable: true,
        selectable: true,
        zIndex: -1
      },

      // 5. Boundary: Public Subnet A
      {
        id: 'box-pub-subnet-a',
        type: 'boundaryNode',
        position: { x: 190, y: 150 },
        data: {
          label: 'Public subnet',
          boundaryType: 'public_subnet',
          width: 280,
          height: 180
        },
        style: { width: 280, height: 180 },
        draggable: true,
        selectable: true,
        zIndex: 0
      },

      // 6. Boundary: Public Subnet B
      {
        id: 'box-pub-subnet-b',
        type: 'boundaryNode',
        position: { x: 560, y: 150 },
        data: {
          label: 'Public subnet',
          boundaryType: 'public_subnet',
          width: 280,
          height: 180
        },
        style: { width: 280, height: 180 },
        draggable: true,
        selectable: true,
        zIndex: 0
      },

      // 7. Boundary: Web Tier Security Group (Red outline spanning across AZ A & B)
      {
        id: 'box-sg-web',
        type: 'boundaryNode',
        position: { x: 125, y: 200 },
        data: {
          label: 'Security group',
          boundaryType: 'security_group',
          width: 770,
          height: 120
        },
        style: { width: 770, height: 120 },
        draggable: true,
        selectable: true,
        zIndex: 1
      },

      // 8. Boundary: Private Subnet A
      {
        id: 'box-priv-subnet-a',
        type: 'boundaryNode',
        position: { x: 190, y: 370 },
        data: {
          label: 'Private subnet',
          boundaryType: 'private_subnet',
          width: 280,
          height: 180
        },
        style: { width: 280, height: 180 },
        draggable: true,
        selectable: true,
        zIndex: 0
      },

      // 9. Boundary: Private Subnet B
      {
        id: 'box-priv-subnet-b',
        type: 'boundaryNode',
        position: { x: 560, y: 370 },
        data: {
          label: 'Private subnet',
          boundaryType: 'private_subnet',
          width: 280,
          height: 180
        },
        style: { width: 280, height: 180 },
        draggable: true,
        selectable: true,
        zIndex: 0
      },

      // 10. Boundary: Database Tier Security Group (Red outline spanning across AZ A & B)
      {
        id: 'box-sg-db',
        type: 'boundaryNode',
        position: { x: 125, y: 420 },
        data: {
          label: 'Security group',
          boundaryType: 'security_group',
          width: 770,
          height: 120
        },
        style: { width: 770, height: 120 },
        draggable: true,
        selectable: true,
        zIndex: 1
      },

      // --- Services Nodes ---
      // Amazon S3 Bucket (Outside VPC, inside Region)
      {
        id: 'node-s3',
        type: 'serviceNode',
        position: { x: 42, y: 220 },
        data: {
          serviceId: 's3',
          label: 'Amazon S3',
          category: 'Storage',
          health: 'healthy',
          az: 'Global / Region',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },

      // S3 Gateway Endpoint - placed inside the AZ-A private subnet it actually serves, so the
      // database tier's route to S3 stays on the AWS backbone instead of failing without a NAT.
      {
        id: 'node-s3-gateway',
        type: 'serviceNode',
        position: { x: 190, y: 480 },
        data: {
          serviceId: 's3_gateway_endpoint',
          label: 'S3 gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true
        }
      },

      // Internet Gateway (attaches to the VPC itself, not to any one subnet)
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 472, y: 65 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },

      // Application Load Balancer (placed inside the AZ-A public subnet box)
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 200, y: 160 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 2,
          multiAz: true
        }
      },

      // Web servers (AZ-A Public Subnet)
      {
        id: 'node-web-a',
        type: 'serviceNode',
        position: { x: 275, y: 225 },
        data: {
          serviceId: 'ec2',
          label: 'Web servers',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'public',
          replicas: 2,
          multiAz: false,
          autoScalingEnabled: true,
          minReplicas: 2,
          maxReplicas: 6
        }
      },

      // Web servers (AZ-B Public Subnet)
      {
        id: 'node-web-b',
        type: 'serviceNode',
        position: { x: 645, y: 225 },
        data: {
          serviceId: 'ec2',
          label: 'Web servers',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-B',
          subnet: 'public',
          replicas: 2,
          multiAz: false,
          autoScalingEnabled: true,
          minReplicas: 2,
          maxReplicas: 6
        }
      },

      // Database servers (AZ-A Private Subnet)
      {
        id: 'node-db-a',
        type: 'serviceNode',
        position: { x: 275, y: 445 },
        data: {
          serviceId: 'rds',
          label: 'Database servers',
          category: 'Databases',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 1,
          multiAz: true,
          notes: 'Multi-AZ primary'
        }
      },

      // Database servers (AZ-B Private Subnet)
      {
        id: 'node-db-b',
        type: 'serviceNode',
        position: { x: 645, y: 445 },
        data: {
          serviceId: 'rds',
          label: 'Database servers',
          category: 'Databases',
          health: 'healthy',
          az: 'AZ-B',
          subnet: 'private',
          replicas: 1,
          multiAz: true,
          notes: 'Multi-AZ synchronous standby'
        }
      }
    ],
    edges: [
      {
        id: 'edge-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'edge-alb-web-a',
        source: 'node-alb',
        target: 'node-web-a',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'edge-alb-web-b',
        source: 'node-alb',
        target: 'node-web-b',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'edge-web-a-db-a',
        source: 'node-web-a',
        target: 'node-db-a',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 5000 }
      },
      {
        id: 'edge-web-b-db-a',
        source: 'node-web-b',
        target: 'node-db-a',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 5000 }
      },
      {
        id: 'edge-db-a-db-b',
        source: 'node-db-a',
        target: 'node-db-b',
        type: 'custom',
        data: { protocol: 'Replication', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 }
      },
      {
        id: 'edge-db-a-s3-gateway',
        source: 'node-db-a',
        target: 'node-s3-gateway',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 3000 }
      },
      {
        id: 'edge-s3-gateway-s3',
        source: 'node-s3-gateway',
        target: 'node-s3',
        type: 'custom',
        data: { protocol: 'S3 API', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 3000 }
      }
    ]
  },
  {
    id: 'aws-data-transfer-hub',
    name: 'AWS Data Transfer Hub & Serverless Workflow',
    category: 'Serverless / Microservice',
    difficulty: 'Intermediate',
    description: 'Official AWS architecture featuring Data Transfer Hub UI, Cognito auth, AppSync GraphQL, Lambda, DynamoDB, Step Functions, and Fargate across Customer and Managed accounts.',
    learningOutcome: 'Demonstrates end-to-end multi-account serverless workflow orchestration, token authentication, and containerized data replication.',
    nodes: [
      // 1. Boundary: Customer's AWS Account
      {
        id: 'box-customer-account',
        type: 'boundaryNode',
        position: { x: 20, y: 30 },
        data: {
          label: "Customer's AWS Account",
          boundaryType: 'account',
          width: 720,
          height: 540
        },
        draggable: false,
        selectable: false,
        zIndex: -1
      },

      // 2. Boundary: Authentication (Dashed)
      {
        id: 'box-auth',
        type: 'boundaryNode',
        position: { x: 80, y: 70 },
        data: {
          label: 'Authentication',
          boundaryType: 'auth',
          width: 200,
          height: 110
        },
        draggable: false,
        selectable: false,
        zIndex: 0
      },

      // 3. Boundary: Step Functions Workflow (Pink)
      {
        id: 'box-step-functions',
        type: 'boundaryNode',
        position: { x: 500, y: 60 },
        data: {
          label: 'AWS Step Functions workflow',
          boundaryType: 'workflow',
          width: 210,
          height: 300
        },
        draggable: false,
        selectable: false,
        zIndex: 0
      },

      // 4. Boundary: AWS Managed Account
      {
        id: 'box-managed-account',
        type: 'boundaryNode',
        position: { x: 770, y: 30 },
        data: {
          label: 'AWS Managed Account',
          boundaryType: 'account',
          width: 290,
          height: 540
        },
        draggable: false,
        selectable: false,
        zIndex: -1
      },

      // Boundary: Private subnet holding the Fargate replication task (the only resource
      // here with an ENI that must actually live inside a VPC subnet - everything else on
      // this diagram is a fully-managed/serverless service reached over the AWS control plane)
      {
        id: 'box-fargate-vpc',
        type: 'boundaryNode',
        position: { x: 500, y: 390 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 220, height: 140, cidr: '10.0.0.0/16' },
        style: { width: 220, height: 140 },
        draggable: false,
        selectable: true,
        zIndex: -1
      },
      {
        id: 'box-fargate-subnet',
        type: 'boundaryNode',
        position: { x: 520, y: 410 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 180, height: 100 },
        style: { width: 180, height: 100 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },

      // --- Nodes in Customer Account ---
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: 45, y: 450 },
        data: {
          serviceId: 'user',
          label: 'User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-ui',
        type: 'serviceNode',
        position: { x: 45, y: 320 },
        data: {
          serviceId: 'client_ui',
          label: 'Data Transfer Hub UI',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-cognito',
        type: 'serviceNode',
        position: { x: 95, y: 105 },
        data: {
          serviceId: 'cognito',
          label: 'Amazon Cognito',
          category: 'Security',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-openid',
        type: 'serviceNode',
        position: { x: 200, y: 105 },
        data: {
          serviceId: 'openid',
          label: 'OpenID Connect',
          category: 'Security',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-cloudfront',
        type: 'serviceNode',
        position: { x: 200, y: 440 },
        data: {
          serviceId: 'cloudfront',
          label: 'Amazon CloudFront',
          category: 'DNS / Edge',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-s3-client',
        type: 'serviceNode',
        position: { x: 340, y: 440 },
        data: {
          serviceId: 's3',
          label: 'Amazon S3 (Web)',
          category: 'Storage',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-appsync',
        type: 'serviceNode',
        position: { x: 240, y: 240 },
        data: {
          serviceId: 'appsync',
          label: 'AWS AppSync',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-lambda',
        type: 'serviceNode',
        position: { x: 370, y: 240 },
        data: {
          serviceId: 'lambda',
          label: 'AWS Lambda',
          category: 'Compute',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 5,
          multiAz: true
        }
      },
      {
        id: 'node-dynamodb',
        type: 'serviceNode',
        position: { x: 370, y: 80 },
        data: {
          serviceId: 'dynamodb',
          label: 'Amazon DynamoDB',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      // Inside Step Functions
      {
        id: 'node-step-lambda',
        type: 'serviceNode',
        position: { x: 550, y: 120 },
        data: {
          serviceId: 'lambda',
          label: 'AWS Lambda (Workflow)',
          category: 'Compute',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-cloudformation',
        type: 'serviceNode',
        position: { x: 550, y: 240 },
        data: {
          serviceId: 'cloudformation',
          label: 'AWS CloudFormation',
          category: 'Monitoring',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-fargate',
        type: 'serviceNode',
        position: { x: 550, y: 440 },
        data: {
          serviceId: 'fargate',
          label: 'AWS Fargate',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      },

      // --- Nodes in AWS Managed Account ---
      {
        id: 'node-s3-managed',
        type: 'serviceNode',
        position: { x: 800, y: 190 },
        data: {
          serviceId: 's3',
          label: 'Amazon S3 (Template)',
          category: 'Storage',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-ecr-managed',
        type: 'serviceNode',
        position: { x: 800, y: 440 },
        data: {
          serviceId: 'ecr',
          label: 'Amazon ECR',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      }
    ],
    edges: [
      // 1. UI -> CloudFront -> S3
      {
        id: 'e-ui-cf',
        source: 'node-ui',
        target: 'node-cloudfront',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'cached', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-cf-s3',
        source: 'node-cloudfront',
        target: 'node-s3-client',
        type: 'custom',
        data: { protocol: 'Object access', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      // 2. UI -> AppSync
      {
        id: 'e-ui-appsync',
        source: 'node-ui',
        target: 'node-appsync',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      // 3. UI -> Cognito Auth
      {
        id: 'e-ui-auth',
        source: 'node-ui',
        target: 'node-cognito',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      // 4. AppSync -> Lambda
      {
        id: 'e-appsync-lambda',
        source: 'node-appsync',
        target: 'node-lambda',
        type: 'custom',
        data: { protocol: 'Event', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2500 }
      },
      // 8. Lambda -> DynamoDB
      {
        id: 'e-lambda-dynamo',
        source: 'node-lambda',
        target: 'node-dynamodb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 8, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      // 5. Lambda -> Step Functions (represented by step-lambda)
      {
        id: 'e-lambda-step',
        source: 'node-lambda',
        target: 'node-step-lambda',
        type: 'custom',
        data: { protocol: 'Event', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      // Step Functions Lambda -> CloudFormation
      {
        id: 'e-step-cfn',
        source: 'node-step-lambda',
        target: 'node-cloudformation',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 4000 }
      },
      // CloudFormation -> Fargate
      {
        id: 'e-cfn-fargate',
        source: 'node-cloudformation',
        target: 'node-fargate',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 4000 }
      },
      // 6. Managed S3 -> Step Functions
      {
        id: 'e-managed-s3',
        source: 'node-s3-managed',
        target: 'node-cloudformation',
        type: 'custom',
        data: { protocol: 'Object access', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      // 7. Managed ECR -> Fargate
      {
        id: 'e-managed-ecr',
        source: 'node-ecr-managed',
        target: 'node-fargate',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 7, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      }
    ]
  },

  {
    id: 'highly-available-multiaz',
    name: 'Highly Available Multi-AZ Web Application',
    category: 'High Availability',
    difficulty: 'Intermediate',
    description: 'Resilient multi-tier architecture spanning AZ-A and AZ-B with CloudFront caching, ALB traffic distribution, redundant ECS tasks, and Multi-AZ RDS.',
    learningOutcome: 'Demonstrates zero-downtime failover when an entire Availability Zone or individual compute task fails.',
    nodes: [
      // Boundary: VPC
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 450, y: 60 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 560, height: 380, cidr: '10.0.0.0/16' },
        style: { width: 560, height: 380 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 470, y: 170 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 160, height: 140 },
        style: { width: 160, height: 140 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 650, y: 80 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 340, height: 340 },
        style: { width: 340, height: 340 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: 40, y: 220 },
        data: {
          serviceId: 'user',
          label: 'Client User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-r53',
        type: 'serviceNode',
        position: { x: 190, y: 220 },
        data: {
          serviceId: 'route53',
          label: 'Route 53',
          category: 'DNS / Edge',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-cf',
        type: 'serviceNode',
        position: { x: 340, y: 220 },
        data: {
          serviceId: 'cloudfront',
          label: 'Amazon CloudFront',
          category: 'DNS / Edge',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 420, y: 100 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 500, y: 220 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-ecs-az-a',
        type: 'serviceNode',
        position: { x: 690, y: 120 },
        data: {
          serviceId: 'ecs',
          label: 'AWS Fargate (AZ-A)',
          category: 'Containers',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 2,
          multiAz: false
        }
      },
      {
        id: 'node-ecs-az-b',
        type: 'serviceNode',
        position: { x: 690, y: 320 },
        data: {
          serviceId: 'ecs',
          label: 'AWS Fargate (AZ-B)',
          category: 'Containers',
          health: 'healthy',
          az: 'AZ-B',
          subnet: 'private',
          replicas: 2,
          multiAz: false
        }
      },
      {
        id: 'node-rds-multi-az',
        type: 'serviceNode',
        position: { x: 890, y: 220 },
        data: {
          serviceId: 'rds',
          label: 'Amazon RDS (Multi-AZ)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true,
          notes: 'Synchronous hot standby in AZ-B'
        }
      }
    ],
    edges: [
      {
        id: 'e-u-r53',
        source: 'node-user',
        target: 'node-r53',
        type: 'custom',
        data: { protocol: 'DNS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-r53-cf',
        source: 'node-r53',
        target: 'node-cf',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'cached', isCriticalDependency: true, timeoutMs: 1500 }
      },
      {
        id: 'e-cf-igw',
        source: 'node-cf',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2500 }
      },
      {
        id: 'e-alb-ecs-a',
        source: 'node-alb',
        target: 'node-ecs-az-a',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-ecs-b',
        source: 'node-alb',
        target: 'node-ecs-az-b',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 }
      },
      {
        id: 'e-ecs-a-rds',
        source: 'node-ecs-az-a',
        target: 'node-rds-multi-az',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'e-ecs-b-rds',
        source: 'node-ecs-az-b',
        target: 'node-rds-multi-az',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      }
    ]
  },

  {
    id: 'basic-spof-app',
    name: 'Basic Web App (Single-Instance Anti-Pattern)',
    category: 'Monolith / Baseline',
    difficulty: 'Beginner',
    description: 'A classic three-tier architecture with zero redundancy. Every tier contains a critical single point of failure (SPOF).',
    learningOutcome: 'Demonstrates what happens when any single component crashes without redundancy or load balancing.',
    nodes: [
      // Boundary: VPC (everything here sits in one public subnet - part of the anti-pattern)
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 340, y: 50 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 520, height: 280, cidr: '10.0.0.0/16' },
        style: { width: 520, height: 280 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 360, y: 80 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 480, height: 220 },
        style: { width: 480, height: 220 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: 50, y: 220 },
        data: {
          serviceId: 'user',
          label: 'User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-route53',
        type: 'serviceNode',
        position: { x: 260, y: 220 },
        data: {
          serviceId: 'route53',
          label: 'Amazon Route 53',
          category: 'DNS / Edge',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 375, y: 100 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-ec2',
        type: 'serviceNode',
        position: { x: 490, y: 220 },
        data: {
          serviceId: 'ec2',
          label: 'Amazon EC2',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'public',
          replicas: 1,
          multiAz: false,
          notes: 'Single instance in AZ-A'
        }
      },
      {
        id: 'node-rds',
        type: 'serviceNode',
        position: { x: 740, y: 220 },
        data: {
          serviceId: 'rds',
          label: 'Amazon RDS',
          category: 'Databases',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'public',
          replicas: 1,
          multiAz: false,
          notes: 'Single instance without Multi-AZ'
        }
      }
    ],
    edges: [
      {
        id: 'edge-user-r53',
        source: 'node-user',
        target: 'node-route53',
        type: 'custom',
        data: { protocol: 'DNS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      {
        id: 'edge-r53-igw',
        source: 'node-route53',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'edge-igw-ec2',
        source: 'node-igw',
        target: 'node-ec2',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'edge-ec2-rds',
        source: 'node-ec2',
        target: 'node-rds',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 5000 }
      }
    ]
  },

  {
    id: 'event-driven-async',
    name: 'Event-Driven Decoupled Architecture (SQS Buffer)',
    category: 'Decoupled / Asynchronous',
    difficulty: 'Advanced',
    description: 'Protects backend relational databases from traffic surges by introducing an asynchronous SQS buffer between the web API and background worker tasks.',
    learningOutcome: 'Teaches how asynchronous message queues act as shock absorbers preventing database thread exhaustion during 10x traffic spikes.',
    nodes: [
      // Boundary: VPC
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 150, y: 50 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 920, height: 310, cidr: '10.0.0.0/16' },
        style: { width: 920, height: 310 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 170, y: 170 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 120, height: 120 },
        style: { width: 120, height: 120 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 340, y: 60 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 700, height: 280 },
        style: { width: 700, height: 280 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: 40, y: 220 },
        data: {
          serviceId: 'user',
          label: 'Client User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 120, y: 100 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 200, y: 220 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-web-ecs',
        type: 'serviceNode',
        position: { x: 380, y: 220 },
        data: {
          serviceId: 'ecs',
          label: 'Web API (ECS)',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 3,
          multiAz: true
        }
      },
      {
        id: 'node-sqs',
        type: 'serviceNode',
        position: { x: 560, y: 220 },
        data: {
          serviceId: 'sqs',
          label: 'Amazon SQS',
          category: 'Messaging',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true,
          notes: 'Buffers requests'
        }
      },
      {
        id: 'node-worker-ecs',
        type: 'serviceNode',
        position: { x: 740, y: 220 },
        data: {
          serviceId: 'ecs',
          label: 'Worker Service',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-rds',
        type: 'serviceNode',
        position: { x: 920, y: 220 },
        data: {
          serviceId: 'rds',
          label: 'Amazon RDS (Multi-AZ)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      }
    ],
    edges: [
      {
        id: 'e-u-igw',
        source: 'node-user',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-web',
        source: 'node-alb',
        target: 'node-web-ecs',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-web-sqs',
        source: 'node-web-ecs',
        target: 'node-sqs',
        type: 'custom',
        data: { protocol: 'Message', stepNumber: 4, interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-sqs-worker',
        source: 'node-sqs',
        target: 'node-worker-ecs',
        type: 'custom',
        data: { protocol: 'Message', stepNumber: 5, interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 3000 }
      },
      {
        id: 'e-worker-rds',
        source: 'node-worker-ecs',
        target: 'node-rds',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 4000 }
      }
    ]
  },
  {
    id: 'vpc-nat-autoscaling-3tier',
    name: '3-Tier VPC: Public/Private Subnets, NAT Gateway & Auto Scaling',
    category: 'VPC & Networking',
    difficulty: 'Intermediate',
    description: 'Production-ready 3-tier VPC architecture with Internet Gateway, Public ALB & NAT Gateway, Private Auto-Scaled EC2 cluster, VPC Endpoint to S3, and Multi-AZ Aurora database.',
    learningOutcome: 'Demonstrates private subnet isolation, outbound NAT translation, Auto Scaling group dynamic capacity adjustment, VPC Endpoint routing, and Multi-AZ database failover.',
    nodes: [
      // Boundary 1: VPC Container
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 180, y: 30 },
        data: {
          label: 'Amazon VPC (10.0.0.0/16)',
          boundaryType: 'vpc',
          width: 880,
          height: 520,
          cidr: '10.0.0.0/16'
        },
        style: { width: 880, height: 520 },
        draggable: false,
        selectable: false,
        zIndex: -1
      },
      // Boundary 2: Public Subnet Container
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 210, y: 70 },
        data: {
          label: 'Public Subnet (ALB & NAT Gateway with EIP)',
          boundaryType: 'public_subnet',
          width: 250,
          height: 440
        },
        style: { width: 250, height: 440 },
        draggable: false,
        selectable: false,
        zIndex: 0
      },
      // Boundary 3: Private Subnet Container
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 500, y: 70 },
        data: {
          label: 'Private Application Subnet (Auto-Scaled Compute)',
          boundaryType: 'private_subnet',
          width: 260,
          height: 440
        },
        style: { width: 260, height: 440 },
        draggable: false,
        selectable: false,
        zIndex: 0
      },

      // Client Outside VPC
      {
        id: 'node-client-user',
        type: 'serviceNode',
        position: { x: 40, y: 220 },
        data: {
          serviceId: 'user',
          label: 'Internet Users',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },

      // Public Subnet Services
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 250, y: 110 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'public',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 250, y: 240 },
        data: {
          serviceId: 'alb',
          label: 'Public Application Load Balancer',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-nat-gw',
        type: 'serviceNode',
        position: { x: 250, y: 380 },
        data: {
          serviceId: 'nat_gateway',
          label: 'NAT Gateway (EIP)',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },

      // Private Subnet Services (Compute & Auto Scaling)
      {
        id: 'node-asg-app',
        type: 'serviceNode',
        position: { x: 550, y: 240 },
        data: {
          serviceId: 'ec2',
          label: 'Auto-Scaled App Tier',
          category: 'Compute',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 3,
          multiAz: true
        }
      },
      {
        id: 'node-auto-scaling',
        type: 'serviceNode',
        position: { x: 550, y: 110 },
        data: {
          serviceId: 'auto_scaling',
          label: 'EC2 Auto Scaling Group',
          category: 'Compute',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true
        }
      },

      // Isolated DB Subnet / Backends
      {
        id: 'node-aurora-db',
        type: 'serviceNode',
        position: { x: 650, y: 400 },
        data: {
          serviceId: 'aurora',
          label: 'Amazon Aurora (Multi-AZ)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-s3-bucket',
        type: 'serviceNode',
        position: { x: 840, y: 400 },
        data: {
          serviceId: 's3',
          label: 'Amazon S3 (Data Lake)',
          category: 'Storage',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      }
    ],
    edges: [
      {
        id: 'e-user-igw',
        source: 'node-client-user',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      {
        id: 'e-alb-app',
        source: 'node-alb',
        target: 'node-asg-app',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-app-asg',
        source: 'node-auto-scaling',
        target: 'node-asg-app',
        type: 'custom',
        data: { protocol: 'Event', stepNumber: 3, interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-app-db',
        source: 'node-asg-app',
        target: 'node-aurora-db',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'e-app-nat',
        source: 'node-asg-app',
        target: 'node-nat-gw',
        type: 'custom',
        data: { protocol: 'TCP', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      {
        id: 'e-nat-s3',
        source: 'node-nat-gw',
        target: 'node-s3-bucket',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 6, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2500 }
      }
    ]
  },

  {
    id: 'simple-website',
    name: 'Simple website',
    category: 'VPC & Networking',
    difficulty: 'Beginner',
    description: 'The minimum correct shape for hosting a website on AWS: a Region containing one VPC with a public subnet (Internet Gateway + Application Load Balancer) and a private subnet (web server), plus an S3 bucket for storage reached over a VPC Gateway Endpoint instead of the public internet.',
    learningOutcome: 'Shows why public internet traffic can only enter a VPC through an Internet Gateway, why the web server itself belongs in a private subnet behind the ALB, and how private compute reaches S3 securely via a Gateway Endpoint instead of a NAT Gateway.',
    nodes: [
      // Region boundary
      {
        id: 'box-region',
        type: 'boundaryNode',
        position: { x: 20, y: 20 },
        data: { label: 'Region (us-east-1)', boundaryType: 'region', width: 660, height: 420 },
        style: { width: 660, height: 420 },
        draggable: false,
        selectable: true,
        zIndex: -3
      },
      // VPC boundary
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 50, y: 60 },
        data: { label: 'VPC (10.0.0.0/16)', boundaryType: 'vpc', width: 600, height: 340, cidr: '10.0.0.0/16' },
        style: { width: 600, height: 340 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      // Public subnet boundary (holds IGW + ALB)
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 80, y: 110 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 220, height: 260, cidr: '10.0.0.0/24' },
        style: { width: 220, height: 260 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      // Private subnet boundary (holds the web server)
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 350, y: 110 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 260, height: 260, cidr: '10.0.1.0/24' },
        style: { width: 260, height: 260 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },

      // --- Service nodes ---
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: -170, y: 210 },
        data: {
          serviceId: 'user',
          label: 'Website Visitor',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 105, y: 150 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 105, y: 280 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-web',
        type: 'serviceNode',
        position: { x: 400, y: 215 },
        data: {
          serviceId: 'ec2',
          label: 'Web Server',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 1,
          multiAz: false,
          notes: 'Serves the website; only reachable from the ALB.'
        }
      },
      {
        id: 'node-s3-gateway',
        type: 'serviceNode',
        position: { x: 400, y: 320 },
        data: {
          serviceId: 's3_gateway_endpoint',
          label: 'S3 Gateway Endpoint',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true,
          notes: 'Lets the private subnet reach S3 over the AWS backbone, without a NAT Gateway.'
        }
      },
      {
        id: 'node-s3',
        type: 'serviceNode',
        position: { x: 720, y: 265 },
        data: {
          serviceId: 's3',
          label: 'Amazon S3 (Website Storage)',
          category: 'Storage',
          health: 'healthy',
          az: 'Global / Region',
          subnet: 'global',
          replicas: 1,
          multiAz: true,
          notes: 'Stores site assets, uploads, and backups.'
        }
      }
    ],
    edges: [
      {
        id: 'e-user-igw',
        source: 'node-user',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-web',
        source: 'node-alb',
        target: 'node-web',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-web-endpoint',
        source: 'node-web',
        target: 'node-s3-gateway',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-endpoint-s3',
        source: 'node-s3-gateway',
        target: 'node-s3',
        type: 'custom',
        data: { protocol: 'Object access', stepNumber: 5, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 2000 }
      }
    ]
  },

  {
    id: 'serverless-container',
    name: 'Serverless Container',
    category: 'Containers',
    difficulty: 'Advanced',
    description: 'Multi-tenant ECS Fargate microservices behind a single HTTP API: Cognito issues JWT access tokens with custom scopes, API Gateway validates them and forwards path-based requests, AWS Cloud Map resolves live service locations by DNS, and each microservice (pets, foods) scales independently and owns its own DynamoDB table.',
    learningOutcome: 'Demonstrates JWT-based API authorization, service discovery instead of hardcoded endpoints, per-service Auto Scaling, and the database-per-service pattern for independently deployable microservices.',
    nodes: [
      // Boundary: AWS Cloud (everything except the end user lives inside the account)
      {
        id: 'box-aws-cloud',
        type: 'boundaryNode',
        position: { x: 40, y: 20 },
        data: { label: 'AWS Cloud', boundaryType: 'account', width: 940, height: 600 },
        style: { width: 940, height: 600 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      // Boundary: VPC - only the Fargate tasks actually need a subnet; Cognito, API Gateway
      // (HTTP API) and Cloud Map are fully-managed and reachable with no VPC placement at all.
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 460, y: 60 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 300, height: 520, cidr: '10.0.0.0/16' },
        style: { width: 300, height: 520 },
        draggable: false,
        selectable: true,
        zIndex: -1
      },
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 480, y: 90 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 260, height: 460 },
        style: { width: 260, height: 460 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },

      // --- Service nodes ---
      {
        id: 'node-users',
        type: 'serviceNode',
        position: { x: -220, y: 260 },
        data: {
          serviceId: 'user',
          label: 'Users',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      // Listed before Cognito so the request simulator's single linear trace follows the real
      // API call path (User -> API Gateway) rather than wandering into the separate, one-time
      // token-issuance side-channel (User -> Cognito) when picking the first unvisited hop.
      {
        id: 'node-api-gateway',
        type: 'serviceNode',
        position: { x: 90, y: 260 },
        data: {
          serviceId: 'api_gateway',
          label: 'API Gateway (HTTP API + JWT AuthZ)',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true,
          notes: 'Validates the Cognito-issued JWT and its custom scopes before forwarding petstore/* and foodstore/* requests.'
        }
      },
      {
        id: 'node-cognito',
        type: 'serviceNode',
        position: { x: 90, y: 60 },
        data: {
          serviceId: 'cognito',
          label: 'Cognito (User Pools)',
          category: 'Security, Identity & Compliance',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true,
          notes: 'Issues the JWT access token with custom scopes the client presents to API Gateway.'
        }
      },
      {
        id: 'node-cloud-map',
        type: 'serviceNode',
        position: { x: 270, y: 260 },
        data: {
          serviceId: 'cloud_map',
          label: 'Cloud Map (SRV records)',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: true,
          notes: 'Resolves the live IP/port of each ECS service by name instead of a hardcoded endpoint.'
        }
      },

      // --- Pets microservice ---
      {
        id: 'node-ecs-pets',
        type: 'serviceNode',
        position: { x: 500, y: 120 },
        data: {
          serviceId: 'ecs',
          label: 'ECS Service (pets)',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-autoscaling-pets',
        type: 'serviceNode',
        position: { x: 620, y: 120 },
        data: {
          serviceId: 'auto_scaling',
          label: 'Service Auto Scaling (pets)',
          category: 'Management & Governance',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-dynamodb-pets',
        type: 'serviceNode',
        position: { x: 820, y: 150 },
        data: {
          serviceId: 'dynamodb',
          label: 'DynamoDB Table (pets)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      },

      // --- Foods microservice ---
      {
        id: 'node-ecs-foods',
        type: 'serviceNode',
        position: { x: 500, y: 380 },
        data: {
          serviceId: 'ecs',
          label: 'ECS Service (foods)',
          category: 'Containers',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 2,
          multiAz: true
        }
      },
      {
        id: 'node-autoscaling-foods',
        type: 'serviceNode',
        position: { x: 620, y: 380 },
        data: {
          serviceId: 'auto_scaling',
          label: 'Service Auto Scaling (foods)',
          category: 'Management & Governance',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-dynamodb-foods',
        type: 'serviceNode',
        position: { x: 820, y: 400 },
        data: {
          serviceId: 'dynamodb',
          label: 'DynamoDB Table (foods)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'global',
          replicas: 1,
          multiAz: true
        }
      }
    ],
    edges: [
      {
        id: 'e-users-cognito',
        source: 'node-users',
        target: 'node-cognito',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: false, timeoutMs: 1500 }
      },
      {
        id: 'e-users-apigw',
        source: 'node-users',
        target: 'node-api-gateway',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-apigw-cloudmap',
        source: 'node-api-gateway',
        target: 'node-cloud-map',
        type: 'custom',
        data: { protocol: 'DNS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 500 }
      },
      {
        id: 'e-apigw-ecs-pets',
        source: 'node-api-gateway',
        target: 'node-ecs-pets',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-apigw-ecs-foods',
        source: 'node-api-gateway',
        target: 'node-ecs-foods',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-autoscaling-pets-ecs',
        source: 'node-autoscaling-pets',
        target: 'node-ecs-pets',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-ecs-pets-dynamodb',
        source: 'node-ecs-pets',
        target: 'node-dynamodb-pets',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      },
      {
        id: 'e-autoscaling-foods-ecs',
        source: 'node-autoscaling-foods',
        target: 'node-ecs-foods',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-ecs-foods-dynamodb',
        source: 'node-ecs-foods',
        target: 'node-dynamodb-foods',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500 }
      }
    ]
  },

  {
    id: 'ec2-auto-scaling-failure-recovery',
    name: 'Auto Scaling: EC2 Instance Failure Recovery',
    category: 'High Availability',
    difficulty: 'Intermediate',
    description: 'An Auto Scaling Group runs two EC2 instances across AZ-A and AZ-B behind an Application Load Balancer. Fail one EC2 instance (right-click it -> Simulate Failure) and re-run the scenario to see the ALB detect the failed health check and instantly route all traffic to the surviving instance, while the Auto Scaling Group replaces the failed one in the background.',
    learningOutcome: 'Shows the two mechanisms that work together during an EC2 failure: the ALB\'s health check immediately removes the bad instance from rotation (seconds), while the Auto Scaling Group separately detects the same failure and launches a replacement to restore full capacity (minutes) - and how a traffic spike independently triggers the ASG to scale out.',
    nodes: [
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 60, y: 40 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 780, height: 440, cidr: '10.0.0.0/16' },
        style: { width: 780, height: 440 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 90, y: 70 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 180, height: 140 },
        style: { width: 180, height: 140 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'box-private-subnet',
        type: 'boundaryNode',
        position: { x: 320, y: 70 },
        data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 480, height: 380 },
        style: { width: 480, height: 380 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },

      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: -180, y: 220 },
        data: {
          serviceId: 'user',
          label: 'User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 110, y: 80 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 110, y: 150 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 1,
          multiAz: true
        }
      },

      // Listed before ec2-b so the ALB's "first healthy target" selection deterministically
      // picks this one when both are healthy, making the failover demo predictable: fail this
      // node and re-run to watch the ALB choose ec2-b instead.
      {
        id: 'node-ec2-a',
        type: 'serviceNode',
        position: { x: 350, y: 100 },
        data: {
          serviceId: 'ec2',
          label: 'EC2 Instance (AZ-A)',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-ec2-b',
        type: 'serviceNode',
        position: { x: 350, y: 260 },
        data: {
          serviceId: 'ec2',
          label: 'EC2 Instance (AZ-B)',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-B',
          subnet: 'private',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-asg',
        type: 'serviceNode',
        position: { x: 560, y: 180 },
        data: {
          serviceId: 'auto_scaling',
          label: 'EC2 Auto Scaling Group (min 2, max 6)',
          category: 'Management & Governance',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true,
          notes: 'Continuously health-checks every instance and replaces any that fail; scales out on sustained high traffic.'
        }
      },
      {
        id: 'node-rds',
        type: 'serviceNode',
        position: { x: 700, y: 180 },
        data: {
          serviceId: 'rds',
          label: 'Amazon RDS (Multi-AZ)',
          category: 'Databases',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'private',
          replicas: 1,
          multiAz: true
        }
      }
    ],
    edges: [
      {
        id: 'e-user-igw',
        source: 'node-user',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-ec2-a',
        source: 'node-alb',
        target: 'node-ec2-a',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-ec2-b',
        source: 'node-alb',
        target: 'node-ec2-b',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-asg-ec2-a',
        source: 'node-asg',
        target: 'node-ec2-a',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-asg-ec2-b',
        source: 'node-asg',
        target: 'node-ec2-b',
        type: 'custom',
        data: { protocol: 'Event', interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 1000 }
      },
      {
        id: 'e-ec2-a-rds',
        source: 'node-ec2-a',
        target: 'node-rds',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      },
      {
        id: 'e-ec2-b-rds',
        source: 'node-ec2-b',
        target: 'node-rds',
        type: 'custom',
        data: { protocol: 'SQL', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      }
    ]
  },

  {
    id: 'nacl-vs-security-group',
    name: 'Network ACL vs Security Group in Action',
    category: 'Networking & VPC Design',
    difficulty: 'Intermediate',
    description: 'A request travels User -> ALB -> App tier -> Database tier, crossing a Security Group at each tier and a Network ACL on the database subnet. Run the scenario as-is: it is deliberately wired with one protocol mismatch so you see both mechanisms correctly ALLOW traffic earlier in the trace, and then watch the database tier\'s Security Group actively BLOCK it - while its Network ACL, evaluated first, lets the very same packet through.',
    learningOutcome: 'Contrasts the two firewall layers AWS gives every VPC resource: a Network ACL is stateless, attaches to the whole subnet, and only needs an explicit DENY rule to block traffic (everything else passes) - here it only denies raw TCP, so it waves the mismatched request through. A Security Group is stateful, attaches to the individual instance, and is allow-list only - the database\'s Security Group permits just SQL, so an HTTPS request is rejected even though the NACL had no objection. Together they demonstrate defense in depth: either layer alone can stop bad traffic, and a mistake in one is not necessarily caught by the other.',
    nodes: [
      {
        id: 'box-vpc',
        type: 'boundaryNode',
        position: { x: 60, y: 40 },
        data: { label: 'VPC', boundaryType: 'vpc', width: 760, height: 440, cidr: '10.0.0.0/16' },
        style: { width: 760, height: 440 },
        draggable: false,
        selectable: true,
        zIndex: -2
      },
      {
        id: 'box-public-subnet',
        type: 'boundaryNode',
        position: { x: 90, y: 70 },
        data: { label: 'Public subnet', boundaryType: 'public_subnet', width: 180, height: 140 },
        style: { width: 180, height: 140 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      {
        id: 'box-app-subnet',
        type: 'boundaryNode',
        position: { x: 320, y: 70 },
        data: { label: 'App subnet', boundaryType: 'private_subnet', width: 220, height: 160 },
        style: { width: 220, height: 160 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      // Security Group around the App tier: stateful, instance-level, allow-list only.
      // Allows HTTP (what the ALB actually sends) - traffic passes with a visible note.
      {
        id: 'box-app-sg',
        type: 'boundaryNode',
        position: { x: 340, y: 100 },
        data: { label: 'App Tier Security Group', boundaryType: 'security_group', width: 180, height: 100, allowedProtocols: ['HTTP'] },
        style: { width: 180, height: 100 },
        draggable: false,
        selectable: true,
        zIndex: 1
      },
      {
        id: 'box-db-subnet',
        type: 'boundaryNode',
        position: { x: 320, y: 270 },
        data: {
          label: 'Database subnet',
          boundaryType: 'private_subnet',
          width: 220,
          height: 160,
          // Network ACL: stateless, subnet-wide, explicit DENY list. Only denies raw TCP port
          // scans - it has no rule against HTTPS, so it lets the mismatched request through.
          naclDenyInbound: ['TCP']
        },
        style: { width: 220, height: 160 },
        draggable: false,
        selectable: true,
        zIndex: 0
      },
      // Security Group around the database: stateful, instance-level, allow-list only.
      // Only allows SQL - the (intentionally misconfigured) HTTPS request is rejected here.
      {
        id: 'box-db-sg',
        type: 'boundaryNode',
        position: { x: 340, y: 300 },
        data: { label: 'Database Security Group', boundaryType: 'security_group', width: 180, height: 100, allowedProtocols: ['SQL'] },
        style: { width: 180, height: 100 },
        draggable: false,
        selectable: true,
        zIndex: 1
      },

      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: -180, y: 220 },
        data: {
          serviceId: 'user',
          label: 'User',
          category: 'Client / Ingress',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'global',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 110, y: 80 },
        data: {
          serviceId: 'internet_gateway',
          label: 'Internet Gateway',
          category: 'Networking & Content Delivery',
          health: 'healthy',
          az: 'Edge / Global',
          subnet: 'public',
          replicas: 1,
          multiAz: false
        }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 110, y: 150 },
        data: {
          serviceId: 'alb',
          label: 'Application Load Balancer',
          category: 'Load Balancing',
          health: 'healthy',
          az: 'Multi-AZ',
          subnet: 'public',
          replicas: 1,
          multiAz: true
        }
      },
      {
        id: 'node-ec2-app',
        type: 'serviceNode',
        position: { x: 380, y: 130 },
        data: {
          serviceId: 'ec2',
          label: 'App Server',
          category: 'Compute',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 1,
          multiAz: false,
          // Attached by reference, exactly like real AWS - not by being drawn inside the box.
          securityGroupIds: ['box-app-sg']
        }
      },
      {
        id: 'node-rds',
        type: 'serviceNode',
        position: { x: 380, y: 330 },
        data: {
          serviceId: 'rds',
          label: 'Amazon RDS',
          category: 'Databases',
          health: 'healthy',
          az: 'AZ-A',
          subnet: 'private',
          replicas: 1,
          multiAz: false,
          securityGroupIds: ['box-db-sg'],
          notes: 'Deliberately queried over HTTPS instead of SQL, to demonstrate the Security Group rejecting a protocol mismatch that the Network ACL alone would not catch.'
        }
      }
    ],
    edges: [
      {
        id: 'e-user-igw',
        source: 'node-user',
        target: 'node-igw',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 1, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 }
      },
      {
        id: 'e-igw-alb',
        source: 'node-igw',
        target: 'node-alb',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 2, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-alb-ec2-app',
        source: 'node-alb',
        target: 'node-ec2-app',
        type: 'custom',
        data: { protocol: 'HTTP', stepNumber: 3, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 2000 }
      },
      {
        id: 'e-ec2-app-rds',
        source: 'node-ec2-app',
        target: 'node-rds',
        type: 'custom',
        data: { protocol: 'HTTPS', stepNumber: 4, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 }
      }
    ]
  }
];
