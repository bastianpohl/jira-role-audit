import { describe, expect, test, vi } from 'vitest';
import { buildAudit } from './fetchAudit';
import type { JiraClient } from './jiraClient';

// Router-style mock client keyed by URL/path substring.
function mockClient(routes: Record<string, unknown>): JiraClient {
  const getJson = vi.fn(async (p: string) => {
    // Prefer the last-declared matching key, not the first, so a more
    // specific route (e.g. '/role/10' or '/project/AAA/role/10',
    // declared later) wins over a shorter route it happens to contain
    // as a substring (e.g. '/project/AAA/role', declared earlier).
    const matches = Object.keys(routes).filter((k) => p.includes(k));
    const key = matches[matches.length - 1];
    if (!key) throw new Error(`no route for ${p}`);
    return routes[key];
  });
  return { getJson: getJson as unknown as JiraClient['getJson'] };
}

const now = () => new Date('2026-07-29T10:00:00Z');

describe('buildAudit', () => {
  test('resolves direct user actors and enriches email via user lookup', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/role/10': {
        actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
      },
      '/user?accountId=u1': { accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@acme.com' },
    });

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(warnings).toEqual([]);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].emailAddress).toBe('alice@acme.com');
    expect(data.users[0].assignments[0]).toMatchObject({
      projectKey: 'AAA',
      roleName: 'Member',
      via: { kind: 'direct' },
    });
  });

  test('expands group actors into members and caches group lookups', async () => {
    const client = mockClient({
      '/project/search': {
        values: [
          { id: '1', key: 'AAA', name: 'Alpha' },
          { id: '2', key: 'BBB', name: 'Beta' },
        ],
        isLast: true,
      },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/project/BBB/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/BBB/role/10' },
      '/project/AAA/role/10': {
        actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
      },
      '/project/BBB/role/10': {
        actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
      },
      '/group/member?groupId=g1': {
        values: [{ accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@acme.com' }],
        isLast: true,
      },
    });

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.users).toHaveLength(1);
    expect(data.users[0].areaCount).toBe(2);
    expect(data.users[0].assignments[0].via).toEqual({ kind: 'group', groupName: 'devs' });
    // group members fetched once despite two projects (cache)
    const calls = (client.getJson as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls.filter((c) => c.includes('/group/member?groupId=g1'))).toHaveLength(1);
  });

  test('collects a warning and continues when a project role listing fails', async () => {
    const client: JiraClient = {
      getJson: vi.fn(async (p: string) => {
        if (p.includes('/project/search')) return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        if (p.includes('/project/AAA/role')) throw new Error('boom 403');
        throw new Error(`no route for ${p}`);
      }) as unknown as JiraClient['getJson'],
    };
    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.users).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
  });
});
