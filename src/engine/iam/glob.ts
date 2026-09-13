// Shared wildcard matcher for IAM action patterns, resource ARN patterns, and StringLike
// conditions - the same '*'/'?' glob syntax real AWS IAM policies use (a trailing suffix
// wildcard is the common case - e.g. 's3:Get*' - but '*'/'?' are honored anywhere in the pattern).
export function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;

  const regexSource = pattern
    .split('')
    .map(ch => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');

  return new RegExp(`^${regexSource}$`).test(value);
}
