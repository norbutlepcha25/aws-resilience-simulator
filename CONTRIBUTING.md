# Contributing

Thanks for contributing — this project doubles as a teaching tool, so student contributions are very welcome.

## Workflow

This repo uses the standard fork-and-pull-request model: nobody pushes directly to `main`.

1. **Fork** this repository (the "Fork" button on GitHub).
2. **Clone your fork** locally and create a branch for your change:
   ```bash
   git clone https://github.com/<your-username>/<repo>.git
   cd <repo>
   git checkout -b my-change
   ```
3. **Install and run it**:
   ```bash
   npm install
   npm run dev
   ```
4. Make your change.
5. **Before opening a PR**, both of these must pass:
   ```bash
   npm test
   npm run build
   ```
6. Push your branch to your fork and open a pull request against this repo's `main` branch.

## What makes a good PR

- **Keep it focused.** One fix or one feature per PR is much easier to review than a bundle of unrelated changes.
- **If you touch `src/engine/`**, add or update a test in `test/engine.test.ts` that actually exercises the behavior you changed. The engine has no UI dependency, so it's fully testable in isolation — use that.
- **If you add a reference architecture** (`src/data/referenceArchitectures.ts`), make sure:
  - Every VPC-bound resource (ALB, EC2, ECS, RDS, etc.) is geometrically placed inside a matching Public/Private subnet boundary — the test suite checks this automatically for every template (`Reference Diagram Geometry Integrity`).
  - The simulation actually runs to completion — either a genuine success, or a deliberate, clearly-explained failure. Don't ship a template that fails by accident.
- **Explain the "why", not just the "what"** in your PR description. If you're fixing a bug, say what was actually broken and how you confirmed the fix.
- For anything bigger than a small fix — a new engine behavior, a new firewall/networking concept, a UI redesign — **open an issue first** to discuss the approach before investing time in it.

## Project layout

See the [README](README.md#project-structure) for where things live. The short version: `src/engine/` is plain TypeScript with no React dependency and is where most of the "does this behave like real AWS" logic lives; `src/components/` and `src/context/` are the UI on top of it.

## Code style

- No unrelated reformatting in a PR meant to fix one thing.
- Match the existing style in the file you're editing rather than introducing a new pattern.
- Comments should explain *why*, not *what* — the code should already be readable enough to explain what it does.

## Reporting bugs / suggesting features

Open an issue. Include what you expected vs. what actually happened, and if it's a simulation bug, the exact architecture (or a screenshot) that reproduces it.
