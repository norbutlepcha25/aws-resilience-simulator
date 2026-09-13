// Resource ARN matching: exact ARN, or a wildcard pattern (e.g. 'arn:aws:s3:::my-bucket/*'
// matches 'arn:aws:s3:::my-bucket/thumbnails/cat.jpg'). No NotResource - see
// IAM_ENGINE_DEVIATIONS.md §2.
import { wildcardMatch } from './glob.ts';

export function resourceMatches(pattern: string, resourceArn: string): boolean {
  return wildcardMatch(pattern, resourceArn);
}

export function anyResourceMatches(patterns: string[], resourceArn: string): boolean {
  return patterns.some(p => resourceMatches(p, resourceArn));
}
