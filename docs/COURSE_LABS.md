# DSO303 Labs

The top navigation now opens Labs instead of Challenges. Existing challenge data and evaluation code remain intact.

The catalog follows the course links in the [course lab index](https://norbutlepcha25.github.io/dso303/Lab/overview.html), retaining the earlier Lab 0 warm-up. Navigation numbers are retained; the ALB and scaling pages also call themselves 04B and 04C.

| Lab | Reference simulations | Scope |
| --- | --- | --- |
| 0: IAM warm-up | Implicit deny; explicit deny | Effective policy evaluation |
| 1: IAM foundation | Scoped S3 access; explicit deny | Effective policy evaluation |
| 2: VPC | Private S3 endpoint request | Network reference; EC2/S3 probes are teaching aids |
| 3: EC2/VPC | Web to database-tier EC2; SG denial | Connectivity, not database execution |
| 4: ECS | Web to private Fargate tasks | Running-task availability and SGs |
| 5: ALB | Healthy request; task A failure | Selection of surviving task B |
| 6: Auto Scaling | Two-task and four-task snapshots | Supplied capacity, not automatic scaling |
| 7: EKS (05A) | Enrolment path; results path; unavailable enrolment | Internal workload abstractions, not Kubernetes DNS or scheduling |
| 8: EKS scaling (05B) | Two/five replica snapshots; unavailable workload | Fixed worker count; no HPA, Ingress or node scaling execution |

Each lab links to its original instructions and lists unsupported operations. These references supplement the course; they do not execute CLI commands, create AWS resources, run Docker, reproduce Floci, or demonstrate the full AWS service lifecycle. Route-table nodes are annotated references, not proof of full route-selection fidelity. IAM runs do not claim network connectivity or S3 object execution. Their latency is zero because the policy evaluator does not model API latency.

## Student workflow

1. Open Labs and choose a lab.
2. Open the original instructions for the complete exercise.
3. Load a reference to edit its canvas, or run a reference to see its recorded decisions and flow.
4. For network labs, edit configuration and use Send Request or Failure Lab to explore consequences.

Loading or running a reference replaces the current canvas and clears previous simulation/failure state. Running a reference always uses the supplied snapshot. IAM examples use a dedicated policy evaluator; ordinary Send Request is not a replay of that user-policy input.

## Add a future lab

Add a `CourseLab` entry in `src/data/courseLabs.ts` with a stable ID, course number, original URL, learning objectives, explicit limitations, and one or more `LabReference` snapshots. Reference service IDs must exist in the catalog; edges must resolve to nodes. Add expected outcomes to `test/course-labs.test.ts` and verify them against the existing engines. Do not add AWS semantics to `LabsModal`.

`src/engine/labs/runLabReference.ts` delegates network scenarios to the live simulator and IAM scenarios to the policy evaluator. Context owns canvas replacement and playback. Catalog snapshots are cloned so student edits cannot alter another student's starting example.

Validation: engine tests cover all 18 reference outcomes, determinism, immutable inputs, graph references, SG denial and target failover. The UI integration test covers lab selection, instructions, run, clean loading and subsequent Send Request. Existing tests remain unchanged in their assertions.
