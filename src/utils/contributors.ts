export type Contributor = { login: string; name?: string; avatar: string; contributions?: number };
export const CONTRIBUTOR_REPOSITORY = 'norbutlepcha25/cloud-architecture-lab';
export const fallbackContributors: Contributor[] = [
  { login: 'CS-Sensei', name: 'cs-Sensei' },
  { login: 'norbutlepcha25' },
  { login: 'Namgay282004', name: 'Namgay Wangchuk' },
  { login: 'KeldenPDorji', name: 'Drac' },
].map(c => ({ ...c, avatar: `https://github.com/${c.login}.png?size=112` }));
const knownNames = new Map(fallbackContributors.map(c => [c.login.toLowerCase(), c.name]));
// GitHub does not identify all AI accounts. Add confirmed agent logins here as needed.
export const excludedContributorLogins = new Set([
  'claude', 'claude-code', 'codex', 'openai-codex', 'copilot', 'copilot-swe-agent',
  'github-actions', 'dependabot', 'renovate', 'devin-ai', 'sweep-ai',
]);
const automationSuffix = /(?:\[bot\]|-bot|-agent)$/i;

export function parseContributors(rows: unknown): Contributor[] {
  if (!Array.isArray(rows)) throw new Error('Invalid GitHub contributor response');
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const { login, type, contributions, avatar_url } = row;
    if (type !== 'User' || typeof login !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login)
        || excludedContributorLogins.has(login.toLowerCase()) || automationSuffix.test(login)) return [];
    let avatar = `https://github.com/${login}.png?size=112`;
    if (typeof avatar_url === 'string') {
      try {
        const url = new URL(avatar_url);
        if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com') {
          url.searchParams.set('s', '112'); avatar = url.toString();
        }
      } catch { /* Retain the account avatar fallback. */ }
    }
    return [{ login, name: knownNames.get(login.toLowerCase()),
      avatar,
      contributions: Number.isInteger(contributions) && contributions >= 0 ? contributions : undefined }];
  });
}

/** Read all pages without credentials. A failed page rejects the whole refresh, preserving fallback. */
export async function loadContributors(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Contributor[]> {
  const contributors = new Map<string, Contributor>();
  for (let page = 1; ; page++) {
    const response = await fetcher(`https://api.github.com/repos/${CONTRIBUTOR_REPOSITORY}/contributors?per_page=100&page=${page}`, {
      signal, headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub contributors unavailable (${response.status})`);
    if (response.status === 204) break;
    const rows: unknown = await response.json();
    for (const contributor of parseContributors(rows)) contributors.set(contributor.login.toLowerCase(), contributor);
    if ((rows as unknown[]).length < 100) break;
  }
  return [...contributors.values()];
}
