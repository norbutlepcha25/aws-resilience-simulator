import { SERVICE_MAP } from './serviceCatalog.ts';

export interface StorageClassOrType {
  name: string;
  code?: string;
  headline: string;
  durabilityOrAvailability: string;
  performance: string;
  useCases: string;
  costProfile: string;
  features?: string[];
}

export interface ServiceNoteKnowledge {
  serviceId: string;
  serviceName: string;
  tagline: string;
  storageModel: 'Object Storage' | 'Block Storage' | 'File Storage (POSIX)' | 'Managed Cloud Service';
  overview: string;
  keyClassesOrTypesTitle: string;
  classesOrTypes: StorageClassOrType[];
  architecturalFeatures: { title: string; description: string }[];
  useCases: { title: string; description: string; architectureTip: string }[];
  finopsTips: string[];
}

export const SERVICE_KNOWLEDGE_BASE: Record<string, ServiceNoteKnowledge> = {
  s3: {
    serviceId: 's3',
    serviceName: 'Amazon Simple Storage Service (S3)',
    tagline: 'Industry-leading scalable, durable object storage (11 9s durability)',
    storageModel: 'Object Storage',
    overview: 'Amazon S3 stores data as objects within buckets. Objects consist of file data, a key (name), metadata, and a version ID. S3 scales infinitely, provides 99.999999999% (11 9s) durability by redundantly storing data across a minimum of three Availability Zones, and supports objects up to 5 TB in size.',
    keyClassesOrTypesTitle: 'S3 Storage Classes & Bucket Types',
    classesOrTypes: [
      {
        name: 'S3 Standard',
        code: 'STANDARD',
        headline: 'Default high-frequency access object storage',
        durabilityOrAvailability: '99.999999999% durability / 99.99% availability',
        performance: 'Milliseconds first-byte latency, unlimited throughput',
        useCases: 'Cloud applications, dynamic websites, active data lakes, mobile apps, gaming assets.',
        costProfile: 'Standard tier pricing per GB/month; no retrieval fee or minimum duration.',
        features: ['Redundant across ≥ 3 AZs', 'Zero retrieval fees', 'No minimum object size']
      },
      {
        name: 'S3 Intelligent-Tiering',
        code: 'INTELLIGENT_TIERING',
        headline: 'Automated cost optimization without operational overhead',
        durabilityOrAvailability: '99.999999999% durability / 99.9% availability',
        performance: 'Same millisecond latency as S3 Standard',
        useCases: 'Data with unpredictable, changing, or unknown access patterns.',
        costProfile: 'Small monthly monitoring fee per object; automatically moves objects between 3 access tiers (Frequent, Infrequent, Archive Instant) with zero retrieval charges.',
        features: ['Zero retrieval fees', 'Automatic lifecycle movements', 'No impact on application performance']
      },
      {
        name: 'S3 Standard-IA (Infrequent Access)',
        code: 'STANDARD_IA',
        headline: 'Low-cost storage for data accessed less frequently but needed immediately',
        durabilityOrAvailability: '99.999999999% durability / 99.9% availability',
        performance: 'Milliseconds latency for rapid recovery',
        useCases: 'Disaster recovery backups, older media assets, secondary data copies.',
        costProfile: '~40% lower storage cost than S3 Standard; per-GB data retrieval fee applies; 30-day minimum billable duration.',
        features: ['Multi-AZ redundancy', '30-day min storage duration', 'Per-GB retrieval fee']
      },
      {
        name: 'S3 One Zone-IA',
        code: 'ONEZONE_IA',
        headline: 'Lowest cost Infrequent Access stored in a single Availability Zone',
        durabilityOrAvailability: '99.999999999% durability / 99.5% availability (Lost if AZ is destroyed)',
        performance: 'Milliseconds latency within its hosting AZ',
        useCases: 'Easily reproducible secondary backups, on-premises sync mirrors, transcoded video thumbnails.',
        costProfile: '20% cheaper than Standard-IA; retrieval fee applies; data is NOT resilient against physical AZ destruction.',
        features: ['Single-AZ containment', 'Lower price point', '30-day min billable duration']
      },
      {
        name: 'S3 Glacier Instant Retrieval',
        code: 'GLACIER_IR',
        headline: 'Archival cost tier with millisecond retrieval speed',
        durabilityOrAvailability: '99.999999999% durability / 99.9% availability',
        performance: 'Milliseconds first-byte latency',
        useCases: 'Medical imaging records, news archives, regulatory documentation requiring immediate ad-hoc viewing.',
        costProfile: 'Up to 68% savings compared to Standard-IA; 90-day minimum billable storage duration; retrieval fees apply.',
        features: ['Rare access (< 1x per quarter)', 'Millisecond access speed', 'Multi-AZ durability']
      },
      {
        name: 'S3 Glacier Flexible Retrieval (formerly S3 Glacier)',
        code: 'GLACIER',
        headline: 'Secure, durable cold archive with flexible retrieval windows',
        durabilityOrAvailability: '99.999999999% durability / 99.99% availability',
        performance: 'Expedited (1–5 min), Standard (3–5 hours), Bulk (5–12 hours, free)',
        useCases: 'Yearly backup snapshots, historical financial records, digital preservation.',
        costProfile: 'Significantly cheaper than S3 Standard; 90-day minimum duration; free bulk retrievals.',
        features: ['Three retrieval speed options', 'Supports Glacier Vault Lock', 'WORM compliance']
      },
      {
        name: 'S3 Glacier Deep Archive',
        code: 'DEEP_ARCHIVE',
        headline: 'Lowest-cost cloud storage tier anywhere ($0.00099/GB/month)',
        durabilityOrAvailability: '99.999999999% durability / 99.99% availability',
        performance: 'Standard (12 hours), Bulk (48 hours)',
        useCases: 'Long-term regulatory compliance archives (HIPAA, SEC, GDPR), media tape replacement (7–10+ years).',
        costProfile: 'Less than $1 per terabyte/month; 180-day minimum billable storage duration.',
        features: ['Lowest cloud storage price', 'Replaces physical tape libraries', '180-day min duration']
      },
      {
        name: 'S3 Express One Zone',
        code: 'EXPRESS_ONEZONE',
        headline: 'Ultra high-performance directory bucket delivering single-digit millisecond latency',
        durabilityOrAvailability: '99.999999999% durability (Single AZ)',
        performance: 'Single-digit millisecond latency; up to 10x faster request processing than S3 Standard',
        useCases: 'AI/ML model training checkpoints, financial real-time analytics, high-frequency media processing.',
        costProfile: 'Higher storage fee, significantly discounted per-request API costs; co-located in compute AZ.',
        features: ['Directory bucket architecture', 'Extreme request concurrency', 'Optimized for high request rates']
      }
    ],
    architecturalFeatures: [
      {
        title: 'S3 Versioning & Object Lock (WORM)',
        description: 'Retain multiple versions of an object in the same bucket to protect against accidental deletion or overwrite. Object Lock enables Write Once, Read Many (WORM) storage with Compliance or Governance retention modes.'
      },
      {
        title: 'S3 Lifecycle Configuration',
        description: 'Automate cost reduction by establishing rules to cascade objects from S3 Standard → S3 Standard-IA → S3 Glacier Flexible → S3 Glacier Deep Archive → Expiration (deletion).'
      },
      {
        title: 'Replication (Cross-Region & Same-Region)',
        description: 'CRR automatically replicates objects asynchronously to a bucket in another AWS Region for geo-redundancy and disaster recovery. SRR replicates across accounts or within the same region for compliance segregation.'
      },
      {
        title: 'S3 Event Notifications & Object Lambda',
        description: 'Emit real-time events to Amazon SNS, Amazon SQS, or AWS Lambda upon object creation or deletion. S3 Object Lambda enables dynamic data redaction, watermarking, or format transformation during GET requests.'
      }
    ],
    useCases: [
      {
        title: 'Static Website Hosting & CDN Origin',
        description: 'Store HTML, CSS, JavaScript, and media assets in S3. Pair with Amazon CloudFront for SSL termination, global edge caching, and DDoS shielding.',
        architectureTip: 'Enable CloudFront Origin Access Control (OAC) and enforce S3 Block Public Access to keep the bucket completely private.'
      },
      {
        title: 'Big Data Lake & Serverless SQL Analytics',
        description: 'Centralized repository for raw, parquet, and partitioned analytical logs. Queried directly using Amazon Athena without managing databases or compute clusters.',
        architectureTip: 'Use Hive-style partitioning (year=YYYY/month=MM/day=DD) and GZIP/Snappy compression to minimize scanned bytes and Athena query costs.'
      },
      {
        title: 'Disaster Recovery & Regulatory Archival',
        description: 'Long-term backup retention using S3 Glacier Deep Archive with AWS Backup policies or S3 Lifecycle transitions.',
        architectureTip: 'Set S3 Lifecycle rules to abort incomplete multipart uploads after 7 days to eliminate orphaned hidden chunk costs.'
      }
    ],
    finopsTips: [
      'Enable S3 Intelligent-Tiering on workloads with unpredictable access patterns to eliminate manual lifecycle maintenance.',
      'Always configure a lifecycle rule to clean up noncurrent versions and abort incomplete multipart uploads.',
      'Avoid moving objects smaller than 128 KB into Standard-IA or Glacier, as 128 KB minimum billable object size applies.',
      'Deploy S3 Gateway Endpoints in your VPC route tables to allow private EC2-to-S3 traffic without incurring NAT Gateway data processing fees.'
    ]
  },

  ebs: {
    serviceId: 'ebs',
    serviceName: 'Amazon Elastic Block Store (EBS)',
    tagline: 'High-performance, persistent block-level storage volumes for EC2 instances',
    storageModel: 'Block Storage',
    overview: 'Amazon EBS provides block-level storage volumes designed for use with Amazon EC2 instances. Each volume is automatically replicated within its single Availability Zone to protect against component failure. EBS volumes behave like raw, unformatted physical hard drives or SSDs that can be formatted with any filesystem (ext4, XFS, NTFS) and used for operating systems, databases, and enterprise applications.',
    keyClassesOrTypesTitle: 'EBS Volume Types & Performance Characteristics',
    classesOrTypes: [
      {
        name: 'General Purpose SSD (gp3)',
        code: 'gp3',
        headline: 'Latest generation baseline SSD with independent IOPS and throughput scaling',
        durabilityOrAvailability: '99.8% – 99.9% annual durability (Single AZ)',
        performance: 'Baseline 3,000 IOPS and 125 MB/s included free; scales up to 16,000 IOPS and 1,000 MB/s independently of volume size',
        useCases: 'Virtual desktops, medium-sized databases, container storage, development/test environments, web application root volumes.',
        costProfile: '20% lower cost per GB than gp2; pay independently for provisioned IOPS and throughput above baseline.',
        features: ['Independent IOPS/throughput scaling', 'No burst credit mechanism', 'Lowest cost SSD volume']
      },
      {
        name: 'General Purpose SSD (gp2)',
        code: 'gp2',
        headline: 'Legacy baseline SSD where performance scales strictly with volume capacity',
        durabilityOrAvailability: '99.8% – 99.9% annual durability (Single AZ)',
        performance: '3 IOPS/GB baseline (min 100 IOPS up to 16,000 IOPS); bursts to 3,000 IOPS using I/O credit bucket; max 250 MB/s throughput',
        useCases: 'Legacy boot volumes and general purpose workloads not yet migrated to gp3.',
        costProfile: 'Higher cost than gp3; requires buying extra disk space just to get higher IOPS.',
        features: ['Burst bucket credits', 'Tied capacity/performance', 'Recommended to upgrade to gp3']
      },
      {
        name: 'Provisioned IOPS SSD (io2 Block Express)',
        code: 'io2 Block Express',
        headline: 'Mission-critical, ultra high-performance block storage delivering SAN capabilities',
        durabilityOrAvailability: '99.999% annual durability (Five 9s)',
        performance: 'Up to 256,000 IOPS and 4,000 MB/s throughput with sub-millisecond latency; 1,000 IOPS per GB provisioned',
        useCases: 'Largest mission-critical relational databases (SAP HANA, Oracle, Microsoft SQL Server, PostgreSQL), high-throughput I/O intensive transactional processing.',
        costProfile: 'Premium tier; billed for GB storage plus provisioned IOPS; supports EBS Multi-Attach.',
        features: ['Sub-millisecond latency', 'Up to 256k IOPS', 'Supports Multi-Attach on Nitro', '99.999% durability']
      },
      {
        name: 'Provisioned IOPS SSD (io1)',
        code: 'io1',
        headline: 'Previous generation provisioned IOPS SSD for I/O intensive workloads',
        durabilityOrAvailability: '99.8% – 99.9% annual durability',
        performance: 'Up to 64,000 IOPS and 1,000 MB/s throughput; 50 IOPS per GB provisioned',
        useCases: 'Legacy I/O intensive databases; recommended to upgrade to io2 for 100x better durability at equal cost.',
        costProfile: 'Priced on GB capacity plus provisioned IOPS.',
        features: ['Supports Multi-Attach', 'Predecessor to io2']
      },
      {
        name: 'Throughput Optimized HDD (st1)',
        code: 'st1',
        headline: 'Low-cost magnetic HDD volume for large, sequential, throughput-intensive workloads',
        durabilityOrAvailability: '99.8% – 99.9% annual durability (Single AZ)',
        performance: 'Up to 500 MB/s throughput and 500 IOPS; burst credit bucket performance model',
        useCases: 'Apache Kafka streaming logs, Big Data MapReduce clusters, data warehousing, log processing pipelines.',
        costProfile: 'Economical storage; cannot be used as an EC2 boot volume; min size 125 GB.',
        features: ['Sequential I/O optimized', 'Cannot be boot volume', 'Burst throughput credits']
      },
      {
        name: 'Cold HDD (sc1)',
        code: 'sc1',
        headline: 'Lowest-cost block storage designed for infrequently accessed sequential workloads',
        durabilityOrAvailability: '99.8% – 99.9% annual durability (Single AZ)',
        performance: 'Up to 250 MB/s throughput and 250 IOPS',
        useCases: 'Cold sequential log archives, batch processing with low access frequency.',
        costProfile: 'Cheapest block storage option on AWS; cannot be used as a boot volume; min size 125 GB.',
        features: ['Lowest cost block volume', 'Cannot be boot volume', 'Infrequent sequential access']
      }
    ],
    architecturalFeatures: [
      {
        title: 'Elastic Volumes (Zero-Downtime Modifications)',
        description: 'Dynamically expand volume size, change volume type (e.g. gp2 to gp3), or tune provisioned IOPS/throughput on the fly with no detached volume or EC2 reboot required.'
      },
      {
        title: 'EBS Snapshots & Fast Snapshot Restore (FSR)',
        description: 'Point-in-time incremental block-level backups stored automatically in Amazon S3. Fast Snapshot Restore eliminates initial block initialization latency for restored volumes.'
      },
      {
        title: 'EBS Multi-Attach',
        description: 'Allows attaching a single Provisioned IOPS SSD (io1 or io2) volume to up to 16 Nitro-based EC2 instances within the same AZ simultaneously for clustered applications (e.g. cluster file systems).'
      },
      {
        title: 'KMS Default Encryption',
        description: 'Encrypt EBS data volumes and boot volumes seamlessly using AWS Key Management Service (KMS). Snapshots created from encrypted volumes are automatically encrypted.'
      }
    ],
    useCases: [
      {
        title: 'Enterprise Relational Databases (OLTP)',
        description: 'Self-hosted MySQL, PostgreSQL, or Oracle instances on EC2 backed by gp3 or io2 Block Express volumes.',
        architectureTip: 'Separate the database data directory, transaction write-ahead logs (WAL), and temporary tables onto distinct EBS volumes to prevent I/O contention.'
      },
      {
        title: 'EC2 Operating System Root Volumes',
        description: 'High-availability boot drives for Linux and Windows instances with DeleteOnTermination configuration.',
        architectureTip: 'Set DeleteOnTermination=false on database data volumes to prevent accidental data loss if the EC2 instance is terminated.'
      },
      {
        title: 'High-Throughput Streaming & Log Aggregation',
        description: 'Kafka and Elasticsearch clusters processing sequential data streams backed by st1 Throughput Optimized HDD.',
        architectureTip: 'Ensure EC2 instance size provides sufficient EBS-optimized network bandwidth to saturate volume throughput.'
      }
    ],
    finopsTips: [
      'Migrate existing gp2 volumes to gp3 immediately to capture an instant 20% cost reduction and higher baseline performance.',
      'Run periodic FinOps audits to identify and delete unattached (orphaned) EBS volumes left behind by terminated EC2 instances.',
      'Use AWS Backup or Amazon Data Lifecycle Manager (DLM) to automatically prune old EBS snapshots.',
      'Size EBS root volumes appropriately—avoid over-provisioning storage capacity when object storage (S3) could store the data cheaper.'
    ]
  },

  efs: {
    serviceId: 'efs',
    serviceName: 'Amazon Elastic File System (EFS)',
    tagline: 'Serverless, fully elastic, multi-AZ shared POSIX file system over NFS',
    storageModel: 'File Storage (POSIX)',
    overview: 'Amazon EFS provides a serverless, fully elastic file storage system that grows and shrinks automatically as you add and remove files, with no provisioning or management needed. It supports standard Network File System (NFSv4.0 and NFSv4.1) protocols and standard POSIX permissions, enabling concurrent read/write access from thousands of EC2 instances, containers (ECS, EKS), and AWS Lambda functions across multiple Availability Zones.',
    keyClassesOrTypesTitle: 'EFS File System Types & Storage Classes',
    classesOrTypes: [
      {
        name: 'EFS Standard (Multi-AZ)',
        code: 'Regional Standard',
        headline: 'Multi-AZ redundancy delivering maximum availability and disaster resilience',
        durabilityOrAvailability: '99.999999999% durability / 99.99% availability across multiple AZs',
        performance: 'Low millisecond latency for active file system operations',
        useCases: 'Production enterprise applications, container shared state, content management systems (WordPress), multi-AZ web servers.',
        costProfile: 'Standard tier per-GB pricing; zero data retrieval fees for active storage.',
        features: ['Redundant across ≥ 3 AZs', 'Tolerates complete AZ failure', 'Recommended for production']
      },
      {
        name: 'EFS One Zone',
        code: 'One Zone',
        headline: 'Single-AZ file storage delivering 47% lower storage costs',
        durabilityOrAvailability: '99.999999999% durability / 99.5% availability (within a single AZ)',
        performance: 'Sub-millisecond read latency within the same AZ',
        useCases: 'Development, staging, build artifacts, temporary simulation scratch workspaces.',
        costProfile: '47% cheaper than Multi-AZ Standard; data is not resilient against an AZ failure.',
        features: ['Single AZ containment', 'Substantial cost savings', 'Supports One Zone IA tier']
      },
      {
        name: 'EFS Infrequent Access (EFS IA)',
        code: 'IA',
        headline: 'Cost-optimized tier for files not accessed in the last 7 to 90 days',
        durabilityOrAvailability: '99.999999999% durability / same availability as parent system',
        performance: 'Low double-digit millisecond first-byte latency',
        useCases: 'Historical files, compliance audits, older reports accessed occasionally.',
        costProfile: 'Up to 92% cheaper storage cost ($0.025/GB/mo) compared to EFS Standard; small data access charge per GB read.',
        features: ['Lifecycle policy automation', 'Transparent file access', 'Substantial price reduction']
      },
      {
        name: 'EFS Archive',
        code: 'ARCHIVE',
        headline: 'Lowest-cost file tier optimized for cold file data accessed a few times per year',
        durabilityOrAvailability: '99.999999999% durability',
        performance: 'Higher latency, optimized for cold retention',
        useCases: 'Long-term file archiving, historical records preservation.',
        costProfile: 'Up to 50% cheaper than EFS IA ($0.011/GB/mo in us-east-1); per-GB read fee applies.',
        features: ['Ideal for cold file retention', 'Automatic tiering support', 'Lowest EFS storage cost']
      },
      {
        name: 'EFS Intelligent-Tiering',
        code: 'INTELLIGENT_TIERING',
        headline: 'Automatic cost optimization across Standard, Infrequent Access, and Archive',
        durabilityOrAvailability: '99.999999999% durability',
        performance: 'Dynamically matches tier latency without application code changes',
        useCases: 'File workloads where access patterns are unknown or dynamically changing.',
        costProfile: 'Automatically moves cold files to IA/Archive and promotes accessed files back to Standard tier with zero manual scripting.',
        features: ['Zero operational overhead', 'No manual lifecycle tuning', 'Transparent access']
      }
    ],
    architecturalFeatures: [
      {
        title: 'Elastic Throughput vs Provisioned Throughput',
        description: 'Elastic Throughput automatically scales throughput dynamically up to 10+ GB/s based on actual read/write workload demand (pay only for bytes transferred). Provisioned Throughput guarantees dedicated MB/s bandwidth independent of stored data.'
      },
      {
        title: 'General Purpose vs Max I/O Performance Modes',
        description: 'General Purpose mode provides the lowest latency per file operation (ideal for web hosting and enterprise apps). Max I/O mode scales to higher aggregate throughput and IOPS for big data and massively parallel compute clusters.'
      },
      {
        title: 'Multi-AZ Mount Targets & Security Groups',
        description: 'Create mount targets in each VPC subnet across AZs. Attach security groups to mount targets restricting port TCP 2049 (NFS) to authorized compute instances.'
      },
      {
        title: 'Native AWS Lambda & Container Integration',
        description: 'Mount EFS file systems directly into AWS Lambda functions for persistent storage of large datasets or AI models, and into Amazon ECS/EKS tasks via persistent volume claims.'
      }
    ],
    useCases: [
      {
        title: 'Shared Content Management Systems (WordPress / Drupal)',
        description: 'A fleet of auto-scaled EC2 web servers across multiple AZs mounting a shared EFS file system for media uploads (`/wp-content/uploads`).',
        architectureTip: 'Mount EFS using the Amazon EFS Mount Helper (`amazon-efs-utils`) to enable TLS in-transit encryption and IAM authorization.'
      },
      {
        title: 'Persistent Storage for Kubernetes (EKS) & ECS Tasks',
        description: 'Stateful container workloads requiring shared read-write access (`ReadWriteMany` / RWX) across multiple nodes and AZs.',
        architectureTip: 'Use the AWS EFS CSI Driver in Amazon EKS with dynamic provisioning and access points to enforce container user UID/GID isolation.'
      },
      {
        title: 'AWS Lambda Machine Learning Inference',
        description: 'Load large PyTorch or TensorFlow model weights (> 10 GB) into EFS and mount directly into Lambda functions without exceeding package size limits.',
        architectureTip: 'Place Lambda functions inside the same VPC and subnets as the EFS mount targets to minimize initialization cold-start latency.'
      }
    ],
    finopsTips: [
      'Enable EFS Lifecycle Management or EFS Intelligent-Tiering to automatically transition inactive files to the Infrequent Access (IA) tier for up to 92% savings.',
      'Select Elastic Throughput mode for applications with bursty or unpredictable traffic to avoid overpaying for fixed Provisioned Throughput.',
      'Use EFS One Zone for non-production environments (Dev/Test/Staging) to save 47% on base storage costs.',
      'Ensure unmounted file systems or unused access points are decommissioned to prevent idle charges.'
    ]
  }
};

/**
 * Returns detailed architectural knowledge for a given service.
 * If custom rich notes are defined (S3, EBS, EFS), returns that entry.
 * Otherwise, synthesizes a structured note from serviceCatalog.ts.
 */
export function getServiceKnowledge(serviceId: string): ServiceNoteKnowledge {
  const custom = SERVICE_KNOWLEDGE_BASE[serviceId];
  if (custom) return custom;

  const catalogEntry = SERVICE_MAP[serviceId];
  if (catalogEntry) {
    return {
      serviceId: catalogEntry.id,
      serviceName: catalogEntry.name,
      tagline: catalogEntry.description,
      storageModel: 'Managed Cloud Service',
      overview: `${catalogEntry.name} is a managed AWS service in the ${catalogEntry.category} category. ${catalogEntry.architecturalRole}`,
      keyClassesOrTypesTitle: `${catalogEntry.name} Capabilities & Configurations`,
      classesOrTypes: [
        {
          name: 'Standard Configuration',
          headline: catalogEntry.description,
          durabilityOrAvailability: catalogEntry.category === 'Storage' ? 'High Durability' : 'Multi-AZ High Availability',
          performance: 'Cloud-native managed performance',
          useCases: catalogEntry.architecturalRole,
          costProfile: 'Pay-as-you-go AWS cloud pricing model.',
          features: catalogEntry.commonInteractions
        }
      ],
      architecturalFeatures: [
        {
          title: 'Architectural Role',
          description: catalogEntry.architecturalRole
        },
        {
          title: 'Network & Protocol Support',
          description: `Supported inbound protocols: ${catalogEntry.inputs.length ? catalogEntry.inputs.join(', ') : 'Managed API'}. Supported outbound protocols: ${catalogEntry.outputs.length ? catalogEntry.outputs.join(', ') : 'Internal'}.`
        }
      ],
      useCases: [
        {
          title: `Primary Workload Pattern`,
          description: catalogEntry.architecturalRole,
          architectureTip: catalogEntry.teachingNotes.length ? catalogEntry.teachingNotes[0] : 'Follow AWS Well-Architected Framework best practices.'
        }
      ],
      finopsTips: [
        'Review AWS Cost Explorer and CloudWatch metrics regularly to right-size capacity.',
        'Apply resource tagging for granular billing attribution across teams.'
      ]
    };
  }

  return {
    serviceId,
    serviceName: serviceId.toUpperCase(),
    tagline: 'AWS Cloud Service',
    storageModel: 'Managed Cloud Service',
    overview: `AWS cloud infrastructure service.`,
    keyClassesOrTypesTitle: 'Service Details',
    classesOrTypes: [],
    architecturalFeatures: [],
    useCases: [],
    finopsTips: []
  };
}
