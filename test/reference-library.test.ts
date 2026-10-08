import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { parseReference, saveReference, readReferenceLibrary, referenceSnapshot } from '../src/engine/persistence/references.ts';

test('Each built-in reference has its own JSON source and loads without losing graph data', () => {
  const folder = new URL('../src/data/references/', import.meta.url);
  const files = readdirSync(folder).filter(name => name.endsWith('.json'));
  assert.equal(files.length, REFERENCE_ARCHITECTURES.length);
  const ids = new Set();
  for (const file of files) {
    const reference = parseReference(readFileSync(new URL(file, folder), 'utf8'));
    assert.ok(!ids.has(reference.id)); ids.add(reference.id);
    assert.deepEqual(reference, REFERENCE_ARCHITECTURES.find(ref => ref.id === reference.id));
  }
});
test('Reference library roundtrip preserves configuration, boundaries and scenario; invalid imports are atomic', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const ref = { ...structuredClone(REFERENCE_ARCHITECTURES[0]), id: 'custom-test', name: 'My reference' };
  saveReference(storage, ref);
  assert.deepEqual(readReferenceLibrary(storage), [ref]);
  saveReference(storage, { ...ref, name: 'Renamed' });
  assert.equal(readReferenceLibrary(storage).length, 1);
  assert.throws(() => parseReference(JSON.stringify({ ...ref, edges: [{ id: 'bad', source: 'missing', target: 'missing' }] })), /connection/);
  assert.equal(readReferenceLibrary(storage)[0].name, 'Renamed');
  assert.throws(() => parseReference(JSON.stringify({ format: 'aws-architecture-lab', state: {} })), /reference/);
});

test('Edited references can be saved when the request start node was removed', () => {
  const ref = structuredClone(REFERENCE_ARCHITECTURES[0]);
  ref.scenario = { id: 'edited', name: 'Edited request', method: 'GET', path: '/test', startNodeId: 'removed-node', trafficLevel: 'normal' };
  const saved = referenceSnapshot(ref);
  assert.equal(saved.scenario!.startNodeId, '');
  assert.equal(saved.scenario!.path, '/test');
  assert.equal(ref.scenario.startNodeId, 'removed-node');
  assert.deepEqual(saved.nodes, ref.nodes);
  assert.deepEqual(saved.edges, ref.edges);
  assert.throws(() => parseReference(JSON.stringify(ref)), /request scenario/);
  ref.scenario.startNodeId = ref.nodes[0].id;
  assert.deepEqual(referenceSnapshot(ref).scenario, ref.scenario);
});
