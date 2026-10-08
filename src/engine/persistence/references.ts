import type { ReferenceArchitecture } from '../../data/referenceTypes.ts';
export const REFERENCE_LIBRARY_KEY = 'aws-architecture-lab.references.v1';
/** A removed request entry point must not prevent saving the edited diagram.
 * Keep request settings, but leave entry-point selection to the user on reload. */
export function referenceSnapshot(ref: ReferenceArchitecture): ReferenceArchitecture {
  const scenario = ref.scenario && {
    ...ref.scenario,
    startNodeId: ref.nodes.some(node => node.id === ref.scenario!.startNodeId)
      ? ref.scenario.startNodeId : '',
  };
  return parseReference(JSON.stringify({ ...ref, scenario }));
}
export function parseReference(text: string): ReferenceArchitecture {
  if (text.length > 20_000_000) throw new Error('Reference exceeds the 20 MB limit.');
  const ref = JSON.parse(text);
  if (!ref || typeof ref.id !== 'string' || !ref.id || typeof ref.name !== 'string' || !ref.name.trim() || ref.name.length > 120 || !Array.isArray(ref.nodes) || !Array.isArray(ref.edges)) throw new Error('Invalid reference diagram. Use a reference JSON file, not a workspace draft.');
  const ids = new Set<string>();
  for (const node of ref.nodes) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !node.data || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error('Invalid or duplicate reference node.');
    ids.add(node.id);
  }
  const edges = new Set<string>();
  for (const edge of ref.edges) {
    if (!edge || typeof edge.id !== 'string' || edges.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) throw new Error('Invalid reference connection.');
    edges.add(edge.id);
  }
  if (ref.scenario && (typeof ref.scenario.method !== 'string' || typeof ref.scenario.path !== 'string' || (ref.scenario.startNodeId && !ids.has(ref.scenario.startNodeId)))) throw new Error('Invalid reference request scenario.');
  return { ...ref, category: typeof ref.category === 'string' ? ref.category : 'My references', difficulty: ['Beginner', 'Intermediate', 'Advanced'].includes(ref.difficulty) ? ref.difficulty : 'Beginner', description: typeof ref.description === 'string' ? ref.description : '', learningOutcome: typeof ref.learningOutcome === 'string' ? ref.learningOutcome : '' };
}
export function readReferenceLibrary(storage: Pick<Storage, 'getItem'>): ReferenceArchitecture[] {
  const saved = JSON.parse(storage.getItem(REFERENCE_LIBRARY_KEY) ?? '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid browser reference library.');
  return saved.map(ref => parseReference(JSON.stringify(ref)));
}
export function saveReference(storage: Pick<Storage, 'getItem' | 'setItem'>, ref: ReferenceArchitecture) {
  const validated = parseReference(JSON.stringify(ref));
  const refs = readReferenceLibrary(storage).filter(item => item.id !== validated.id);
  refs.push(validated); storage.setItem(REFERENCE_LIBRARY_KEY, JSON.stringify(refs));
  return refs;
}
