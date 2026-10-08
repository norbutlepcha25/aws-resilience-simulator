export const COMPASS_POINTS = [
  { id: 'top', label: 'N · North' },
  { id: 'top-right', label: 'NE · Northeast' },
  { id: 'right', label: 'E · East' },
  { id: 'bottom-right', label: 'SE · Southeast' },
  { id: 'bottom', label: 'S · South' },
  { id: 'bottom-left', label: 'SW · Southwest' },
  { id: 'left', label: 'W · West' },
  { id: 'top-left', label: 'NW · Northwest' },
] as const;

// Older labs/drafts distinguish source and target dots. Resolve those IDs onto
// the shared compass dots without rewriting the saved architecture.
export function compassHandleId(handle: string | null | undefined, end: 'source' | 'target'): string {
  return handle?.replace(/^(source|target)-/, '') || (end === 'source' ? 'right' : 'left');
}
