export interface CascadeStage {
  stageNumber: number;
  phase: string;
  component: string;
  event: string;
  systemImpact: string;
  teachingTakeaway: string;
  metricChange: {
    latency: string;
    errorRate: string;
    activeThreads: string;
  };
}

export const CASCADING_FAILURE_STAGES: CascadeStage[] = [
  {
    stageNumber: 1,
    phase: 'Initial Trigger',
    component: 'Amazon RDS Database',
    event: 'Database primary node encounters storage saturation or unindexed query deadlock.',
    systemImpact: 'Active database connections hang waiting for disk I/O. Query execution time jumps from 15ms to 12,000ms.',
    teachingTakeaway: 'Distributed systems rarely fail instantly with a clean break; they usually fail with slow degradation and increasing latency.',
    metricChange: {
      latency: '12,000ms (+800%)',
      errorRate: '0%',
      activeThreads: '50/100'
    }
  },
  {
    stageNumber: 2,
    phase: 'Upstream Coupling',
    component: 'ECS Application Tasks',
    event: 'Worker threads block waiting for database TCP sockets to return.',
    systemImpact: 'Application server thread pool exhausts all available worker threads (200/200). New incoming requests cannot be accepted and queue up in the OS socket buffer.',
    teachingTakeaway: 'Synchronous coupling without strict timeouts causes upstream services to absorb and amplify downstream slowness.',
    metricChange: {
      latency: '30,000ms (Max Timeout)',
      errorRate: '15% (504 Gateway Timeout)',
      activeThreads: '200/200 (100% Saturation)'
    }
  },
  {
    stageNumber: 3,
    phase: 'Health Check Collapse',
    component: 'Application Load Balancer (ALB)',
    event: 'ALB health check probe to /healthz times out because all container threads are blocked.',
    systemImpact: 'ALB marks healthy ECS tasks as UNHEALTHY due to consecutive timeout failures. Target group capacity drops to 0.',
    teachingTakeaway: 'When application code shares the same thread pool as health check endpoints, slow dependencies will cause the load balancer to mistakenly evict healthy containers!',
    metricChange: {
      latency: 'Instant 502',
      errorRate: '100% (502 Bad Gateway)',
      activeThreads: 'Deadlock'
    }
  },
  {
    stageNumber: 4,
    phase: 'Thundering Herd / Retry Storm',
    component: 'Client Browsers / Route 53',
    event: 'Thousands of frustrated users aggressively hit Refresh (F5) repeatedly.',
    systemImpact: 'Traffic surge multiplies by 5x. When database or compute attempts to reboot, the incoming tidal wave of queued retries crashes it immediately on startup.',
    teachingTakeaway: 'Mitigation requires: 1) Aggressive socket timeouts, 2) Circuit breakers (Netflix Hystrix / Resilience4j pattern), 3) Separate health check threads, 4) Asynchronous SQS buffers, and 5) Exponential backoff with jitter on clients.',
    metricChange: {
      latency: 'Infinite',
      errorRate: '100%',
      activeThreads: 'Crash Loop'
    }
  }
];
