# Lab reference source files

Each `.json` file is one complete `LabReference` (see `../courseLabShared.ts`): id, title,
description, expected outcome, optional simulation scope, nodes/edges/scenario, and optionally
`configurationChecks` and/or an `authorization` block for policy-only labs.

Course-lab metadata (which labs exist, their objectives, source URL, limitations, and which
reference IDs belong to which lab) lives separately in `../courseLabsMeta.json` - it isn't part
of this folder because it isn't architecture data a student edits on the canvas.

## Edit or add a lab reference

1. In the app, open **Labs** and load a lab diagram onto the canvas.
2. Edit its layout, connections and service configuration. Click **Save lab diagram**
   at the top-left of the canvas to export the edited diagram. The button appears only
   while a lab diagram is loaded. The export preserves its ID, title, description,
   expected outcome, scope, configuration checks and authorization data.
3. Replace the matching JSON file in `src/data/labs/` with the exported JSON (the save
   dialog suggests its original `NN-<id>.json` filename). Do not paste workspace draft
   JSON here, or add a second file with the same ID. A missing request start node is
   cleared on export and reported; choose an entry point before simulation.
4. If this is a *new* lab reference (not editing an existing one), add its `id` to the matching
   lab's `referenceIds` array in `../courseLabsMeta.json`.
5. Restart `npm run dev`, run `npm run build`, or run `npm run labs:sync` if the dev server is
   already running. The catalogue is regenerated automatically before dev/build/test.
6. Run `npm test` - `test/course-labs.test.ts` exercises every lab reference (unique IDs, valid
   graph, deterministic simulation outcome, subnet placement, and more).

There is no in-app upload/import for lab references (unlike a regular architecture reference,
these carry configuration checks and IAM authorization data that need reviewing, not just
re-uploading) - editing the file and placing it here is the only path to a permanent change.

`../labsRegistry.ts` is generated; do not edit it. `../courseLabs.ts` assembles `COURSE_LABS` by
looking up each lab's `referenceIds` (from `courseLabsMeta.json`) against every file in this
folder - a referenced ID with no matching file throws at import time rather than silently
dropping that lab reference.

Migration: this folder replaced generator functions in `courseLabs.ts`/the retired
`courseLabsAdvanced.ts` that produced these objects programmatically. Every file here was written
by running that code once and dumping its exact output - `npm test` passing unchanged (469/469,
same as before the migration) is the evidence nothing was lost.
