# EKS workload snapshot coverage

The EKS icon represents either a Kubernetes workload Service snapshot or a control-plane reference. Legacy VPC-hosted EKS nodes use `replicas` as the initial desired, running and Ready counts. Legacy global/reference-only EKS nodes represent control-plane metadata. Explicit `customConfig.eks` overrides these defaults without rewriting saved architectures.

The More information overlay displays cluster grouping, namespace, Deployment, Service, aggregate pod snapshots and containers. Editing the right panel persists configuration immediately. Matching nonempty cluster names group snapshots visually; they do not create Kubernetes membership, compute placement or shared control-plane state. External ALB/NLB, IAM and ECR resources remain on the architecture canvas.

## Implemented rules

- Application requests require valid configuration and matching Ready pod endpoints. Running pods and desired replicas alone do not establish readiness. The selector abstraction is one exact label value, not the full Kubernetes label selector language.
- A control-plane reference cannot serve application requests. An explicitly unavailable control plane does not automatically invalidate an observed existing Ready data path; HPA reconciliation estimates are unavailable.
- Load balancer adapters exclude EKS workload snapshots with no matching Ready endpoints. This is endpoint eligibility, not a simulation of controller reconciliation or AWS target registration/health-check timing.
- Direct internet client nodes cannot reach a ClusterIP by drawing an edge. Other ingress still depends on the existing network/firewall model. Setting Service type LoadBalancer does not provision or infer an ALB/NLB.
- Traffic, multiple replicas, multi-AZ and an ASG never instantly create EKS pods.
- CPU HPA exposes an opt-in basic estimate: ceil(observed running pods × observed utilization / target), bounded to configured min/max. Metrics, CPU requests and a running sample are required. Applying the estimate changes desired replicas only.

## Explicit limitations

This is PARTIAL coverage, not a Kubernetes runtime. Scheduling, pod startup, readiness probes, rolling updates, eviction, node failure, per-pod ENIs, EndpointSlice/kube-proxy, DNS, NetworkPolicy, Kubernetes API authorization, IRSA/Pod Identity, controller reconciliation and saturation are not implemented here. Existing generic IAM/network coverage is not proof of EKS-specific identity or pod networking. The normal Ready-only path does not support publishNotReadyAddresses. Port mappings are annotations, not a full Service packet translation engine. NodePort and LoadBalancer are configuration annotations; real exposure is not inferred. Fargate profiles and EC2/node autoscaler fields describe compute but do not execute placement or provision nodes. HPA tolerance, stabilization, missing pod metrics and rollout semantics are excluded, so its value is labeled an estimate.

## Sources and regression evidence

- [AWS Kubernetes concepts](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-concepts.html)
- [AWS EKS scaling](https://docs.aws.amazon.com/eks/latest/userguide/autoscaling.html)
- [AWS Fargate profiles](https://docs.aws.amazon.com/eks/latest/userguide/fargate-profile.html)
- [AWS Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html)
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Kubernetes HPA algorithm](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)

`test/eks-live.test.ts` documents rule IDs, sources, scenarios and expected/actual assertions for endpoint readiness, selectors, control-plane separation, validation, scaling prerequisites, external access and load balancer eligibility. `test/ui/ui-integration.test.ts` verifies opt-in display, nested containers, persisted readiness, unrelated configuration preservation and keyboard dismissal/focus restoration. Existing lab/reference architectures remain regression inputs.
