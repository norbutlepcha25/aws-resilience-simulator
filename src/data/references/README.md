# Reference diagram source files

Each `.json` file is one complete `ReferenceArchitecture`: metadata, nodes (including
boundaries and service configuration), edges, and optionally a request scenario.

## Add your own diagram

1. Build the architecture on the canvas.
2. Open **Reference Diagrams** at the top-left of the canvas.
3. Enter a name and click **Save as reference**. Save/download the reference JSON file.
4. For a new diagram, place that file in this folder (`src/data/references/`). To update
   an existing diagram, load it first, keep its name when saving, and replace the contents
   of its existing JSON file with the exported reference JSON. Its ID and teaching
   metadata are preserved. Do not add another file with the same ID.
5. Restart `npm run dev`, run `npm run build`, or run `npm run references:sync` if the dev
   server is already running. The catalogue is regenerated automatically before dev/build/test.
6. Run `npm test` to validate the reference and existing scenarios before publishing it.

Do not paste Export's whole workspace draft JSON into a reference file. If you already
have a draft, import it into the app and use **Save as reference**. Alternatively, copy
only `state.nodes`, `state.edges`, and `state.scenario` into the matching top-level fields
of the existing reference JSON, retaining its `id`, `name`, category and descriptions.
If the scenario start node was deleted, set `scenario.startNodeId` to an empty string or
a valid node ID. **Save as reference** clears a missing start node automatically and
reports it; select an entry point before simulating the saved reference.

`../referenceRegistry.ts` is generated; do not edit it. `../referenceArchitectures.ts`
keeps the existing import API compatible. Files are loaded in filename order. Built-in
files have numeric prefixes to preserve their existing display order. IDs must be unique.

The browser cannot silently write into the repository. Save as reference also attempts
to keep a copy in browser storage, but the exported file is the portable source artifact.
After deployment, new source references appear for students when they load the new release.

Migration: all 14 built-in reference snapshots were compared against the old fully
initialized catalogue before replacing it; graph/configuration contents were identical.
