// Action matching: exact string, or a wildcard pattern (e.g. 's3:Get*' matches 's3:GetObject').
// No NotAction, no cross-service wildcard beyond what '*'/'?' already express - see
// IAM_ENGINE_DEVIATIONS.md §2 for exactly what real IAM action-matching features are out of scope.
import { wildcardMatch } from './glob.ts';

export function actionMatches(pattern: string, action: string): boolean {
  return wildcardMatch(pattern, action);
}

export function anyActionMatches(patterns: string[], action: string): boolean {
  return patterns.some(p => actionMatches(p, action));
}
