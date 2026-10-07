import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContributors, parseContributors } from '../src/utils/contributors.ts';
const human = (login: string) => ({ login, type: 'User', contributions: 2 });
test('Contributors exclude bots and known agents without rejecting ordinary names', () => {
  const result = parseContributors([human('new-person'), human('travelagent'), human('robot'), human('Claude-Code'), human('copilot-swe-agent'), human('helper-agent'), { login: 'automation', type: 'Bot' }, { login: 'anonymous', type: 'Anonymous' }, null, human('bad/path')]);
  assert.deepEqual(result.map(c => c.login), ['new-person', 'travelagent', 'robot']);
  assert.equal(result[0].avatar, 'https://github.com/new-person.png?size=112');
  assert.throws(() => parseContributors({ message: 'rate limited' }));
});
test('Contributors load beyond 100 accounts, deduplicate, and carry cancellation signal', async () => {
  const controller = new AbortController(); let calls = 0;
  const fetcher = (async (url, options) => {
    calls++; assert.match(String(url), new RegExp(`page=${calls}$`));
    assert.equal(options?.signal, controller.signal);
    return new Response(JSON.stringify(calls === 1 ? Array.from({ length: 100 }, (_, i) => human(`person-${i}`)) : [human('person-0'), human('new-person'), human('codex')]));
  }) as typeof fetch;
  const result = await loadContributors(controller.signal, fetcher);
  assert.equal(calls, 2); assert.equal(result.length, 101);
  assert.equal(result.at(-1)!.login, 'new-person');
});
test('Rate limits and malformed responses reject refresh; empty results are valid', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(loadContributors(signal, (async () => new Response('', { status: 403 })) as typeof fetch));
  await assert.rejects(loadContributors(signal, (async () => new Response('{}')) as typeof fetch));
  assert.deepEqual(await loadContributors(signal, (async () => new Response(null, { status: 204 })) as typeof fetch), []);
});
