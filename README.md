# AWS Architecture Lab

An interactive, in-browser AWS architecture simulator for teaching cloud resilience, networking, and system design. Drag AWS services onto a canvas, wire them together, and run realistic request simulations that enforce actual AWS behavior — not just a static diagram tool.

Built with React, TypeScript, [@xyflow/react](https://reactflow.dev/), and Tailwind CSS.

## What it does

- **Design** architectures on a canvas using real AWS service icons, VPCs, subnets, and security boundaries.
- **Simulate** requests end-to-end — the engine models ALB health-check failover, Multi-AZ database failover, Auto Scaling, NAT/Internet Gateway routing, CloudFront caching, WAF filtering, SQS decoupling, and more.
- **Enforce real AWS rules**, not just draw boxes:
  - A resource dropped outside every subnet boundary is geometrically invalid and the simulation fails, exactly as AWS would refuse it.
  - A VPC's CIDR block is automatically carved into non-overlapping subnet ranges as you add Public/Private subnets, refusing splits that would violate AWS's `/28` minimum subnet size.
  - Security Groups (stateful, instance-level, allow-list) and Network ACLs (stateless, subnet-level, deny-list) are independently configurable and evaluated in the real order a packet crosses them.
- **Break things on purpose**: fail an EC2 instance, take down an Availability Zone, remove a NAT Gateway — and watch the simulation explain exactly what happens and why.
- **Reference architectures**: a library of pre-built, verified diagrams (3-tier VPC, serverless containers with Cognito/API Gateway/Cloud Map, event-driven SQS decoupling, EC2 Auto Scaling failure recovery, NACL vs Security Group, and more) that all pass their own automated tests.
- **Teaching tools**: student challenges with automated rubric scoring, a presentation/teaching mode, PNG export, and a Markdown/JSON architecture report export.

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm test          # run the engine test suite
npm run build      # type-check + production build
```

## Project structure

```
src/
  engine/
    simulation/     request traversal engine, network firewall (NACL/SG) checks
    analysis/        SPOF detection, bottleneck detection, multidimensional scoring
    layout/          geometric containment (subnet/VPC placement), CIDR allocation
  data/              AWS service catalog, reference architecture templates, student challenges
  context/           React state (canvas nodes/edges, simulation, analysis)
  components/        canvas, inspector panel, palette, modals
test/
  engine.test.ts     engine + reference-architecture test suite (run with `npm test`)
```

The engine (`src/engine/`) is plain TypeScript with no React dependency, so its behavior is fully covered by `test/engine.test.ts` independent of the UI.

## Contributing

Contributions are welcome — this project is used as a teaching tool, so student contributions are especially encouraged. Before opening a pull request:

1. `npm test` and `npm run build` must both pass.
2. If you touch `src/engine/`, add or update a test in `test/engine.test.ts` covering the behavior.
3. If you add a reference architecture, make sure its node placement is geometrically valid (the test suite checks every template's subnet placement automatically) and that its simulation actually succeeds (or fails on purpose, with a clear reason).

Open an issue first for anything beyond a small fix, so the approach can be discussed before you put time into it.

## License

MIT — see [LICENSE](LICENSE).

The AWS service icons under `src/components/serviceIcon/` are AWS's own [Architecture Icons](https://aws.amazon.com/architecture/icons/), used here under AWS's asset-package terms for building architecture diagrams. They are not covered by this project's MIT license and remain AWS's assets.
