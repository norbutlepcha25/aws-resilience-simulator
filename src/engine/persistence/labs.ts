import type { LabReference } from '../../data/courseLabs.ts';
import { referenceSnapshot } from './references.ts';

/** Export the live graph while retaining lab checks, IAM data and learning outcomes. */
export function labSnapshot(lab: LabReference, nodes: LabReference['nodes'], edges: LabReference['edges'], scenario: LabReference['scenario']): LabReference {
  const graph = referenceSnapshot({ id: lab.id, name: lab.title, category: 'Labs', difficulty: 'Beginner', description: lab.description, learningOutcome: lab.expected, nodes, edges, scenario });
  return { ...lab, nodes: graph.nodes, edges: graph.edges, scenario: graph.scenario! };
}
