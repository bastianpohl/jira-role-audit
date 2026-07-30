import { describe, expect, test, vi } from 'vitest';
import { buildAudit } from './fetchAudit.js';

// Router-style mock client keyed by URL/path substring.
function mockClient(routes) {
  const getJson = vi.fn(async (p) => {
    // Prefer the last-declared matching key, not the first, so a more
    // specific route (e.g. '/role/10' or '/project/AAA/role/10',
    // declared later) wins over a shorter route it happens to contain
    // as a substring (e.g. '/project/AAA/role', declared earlier).
    const matches = Object.keys(routes).filter((k) => p.includes(k));
    const key = matches[matches.length - 1];
    if (!key) throw new Error(`no route for ${p}`);
    return routes[key];
  });
  return { getJson };
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

  test('requests role details as a relative gateway path, not the site-absolute url Jira returns', async () => {
    // Jira returns role URLs pointing at the site (acme.atlassian.net). Those are not
    // reachable with an OAuth bearer token, which must go through api.atlassian.com.
    // The client only knows the gateway base, so buildAudit has to pass a relative path.
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/role/10': {
        actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
      },
      '/user?accountId=u1': { accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@acme.com' },
    });

    await buildAudit(client, 'https://acme.atlassian.net', { now });

    const requested = client.getJson.mock.calls.map((c) => c[0]);
    expect(requested).toContain('/rest/api/3/project/AAA/role/10');
    expect(requested.every((p) => !p.startsWith('http'))).toBe(true);
  });

  test('warns and skips a role whose url carries no extractable role id', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'not-a-role-url' },
    });

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });

    expect(data.users).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
    expect(warnings[0]).toMatch(/Member/);
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
    const calls = client.getJson.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.includes('/group/member?groupId=g1'))).toHaveLength(1);
    // Jira's group-member endpoint defaults to excluding deactivated users; the audit
    // must explicitly request them so offboarded-but-still-grouped accounts show up.
    const groupMemberCall = calls.find((c) => c.includes('/group/member?groupId=g1'));
    expect(groupMemberCall).toContain('includeInactiveUsers=true');
  });

  test('collects a warning and continues when a group actor lookup fails, without aborting the whole audit', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return {
            values: [
              { id: '1', key: 'AAA', name: 'Alpha' },
              { id: '2', key: 'BBB', name: 'Beta' },
            ],
            isLast: true,
          };
        }
        if (p.includes('/project/AAA/role/10')) {
          return {
            actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
          };
        }
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        if (p.includes('/project/BBB/role/20')) {
          return {
            actors: [{ type: 'atlassian-user-role-actor', displayName: 'Bob', actorUser: { accountId: 'u2' } }],
          };
        }
        if (p.includes('/project/BBB/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/BBB/role/20' };
        }
        if (p.includes('/group/member')) throw new Error('group boom 403');
        if (p.includes('/user?accountId=u2')) {
          return { accountId: 'u2', displayName: 'Bob', emailAddress: 'bob@acme.com' };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });

    // The successfully-resolved user from project BBB must still be present.
    expect(data.users).toHaveLength(1);
    expect(data.users[0].displayName).toBe('Bob');

    // The failing group lookup from project AAA must be recorded as a warning, not thrown.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
    expect(warnings[0]).toMatch(/Member/);
    expect(warnings[0]).toMatch(/devs/);
  });

  test('collects a warning and falls back to null email when a direct user lookup fails, without aborting the run', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return {
            values: [
              { id: '1', key: 'AAA', name: 'Alpha' },
              { id: '2', key: 'BBB', name: 'Beta' },
            ],
            isLast: true,
          };
        }
        if (p.includes('/project/AAA/role/10')) {
          return {
            actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
          };
        }
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        if (p.includes('/project/BBB/role/20')) {
          return {
            actors: [{ type: 'atlassian-user-role-actor', displayName: 'Bob', actorUser: { accountId: 'u2' } }],
          };
        }
        if (p.includes('/project/BBB/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/BBB/role/20' };
        }
        if (p.includes('/user?accountId=u1')) throw new Error('user boom 500');
        if (p.includes('/user?accountId=u2')) {
          return { accountId: 'u2', displayName: 'Bob', emailAddress: 'bob@acme.com' };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });

    // Both users still appear; the failing lookup falls back to null email instead of aborting.
    expect(data.users).toHaveLength(2);
    const alice = data.users.find((u) => u.accountId === 'u1');
    const bob = data.users.find((u) => u.accountId === 'u2');
    expect(alice).toBeDefined();
    expect(alice?.emailAddress).toBeNull();
    expect(alice?.displayName).toBe('Alice');
    expect(bob?.emailAddress).toBe('bob@acme.com');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/u1/);
  });

  test('collects a warning and continues when a project role listing fails', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        if (p.includes('/project/AAA/role')) throw new Error('boom 403');
        throw new Error(`no route for ${p}`);
      }),
    };
    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.users).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
  });

  test('rejects (does not warn-and-continue) when a role detail call fails with a fatal error', async () => {
    const fatal = new Error('Jira API 401 Unauthorized — token invalid or expired');
    fatal.fatal = true;
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role/10')) throw fatal;
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    await expect(buildAudit(client, 'https://acme.atlassian.net', { now })).rejects.toBe(fatal);
  });

  test('rejects when a project role-map call fails with a fatal error', async () => {
    const fatal = new Error('Jira API 401 Unauthorized — token invalid or expired');
    fatal.fatal = true;
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role')) throw fatal;
        throw new Error(`no route for ${p}`);
      }),
    };

    await expect(buildAudit(client, 'https://acme.atlassian.net', { now })).rejects.toBe(fatal);
  });

  test('rejects when a per-actor (group) lookup fails with a fatal error', async () => {
    const fatal = new Error('Jira API 401 Unauthorized — token invalid or expired');
    fatal.fatal = true;
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role/10')) {
          return {
            actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
          };
        }
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        if (p.includes('/group/member')) throw fatal;
        throw new Error(`no route for ${p}`);
      }),
    };

    await expect(buildAudit(client, 'https://acme.atlassian.net', { now })).rejects.toBe(fatal);
  });

  test('rejects when resolveUser fails with a fatal error', async () => {
    const fatal = new Error('Jira API 401 Unauthorized — token invalid or expired');
    fatal.fatal = true;
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role/10')) {
          return {
            actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
          };
        }
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        if (p.includes('/user?accountId=u1')) throw fatal;
        throw new Error(`no route for ${p}`);
      }),
    };

    await expect(buildAudit(client, 'https://acme.atlassian.net', { now })).rejects.toBe(fatal);
  });

  test('reports no known gaps and a full project count on a clean run', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/project/AAA/role/10': {
        actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
      },
      '/user?accountId=u1': { accountId: 'u1', displayName: 'Alice', emailAddress: 'a@acme.com' },
    });

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.coverage.noKnownGaps).toBe(true);
    expect(data.coverage.projectsVisible).toBe(1);
    expect(data.coverage.projectsAudited).toBe(1);
    expect(data.coverage.skippedProjects).toEqual([]);
  });

  test('records a project whose role list is refused as skipped, not merely as a warning', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return {
            values: [
              { id: '1', key: 'AAA', name: 'Alpha' },
              { id: '2', key: 'BBB', name: 'Beta' },
            ],
            isLast: true,
          };
        }
        if (p.includes('/project/BBB/role')) throw new Error('Jira API 403 Forbidden');
        if (p.includes('/project/AAA/role/10')) return { actors: [] };
        if (p.includes('/project/AAA/role')) {
          return { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.coverage.noKnownGaps).toBe(false);
    expect(data.coverage.projectsVisible).toBe(2);
    expect(data.coverage.projectsAudited).toBe(1);
    expect(data.coverage.skippedProjects).toHaveLength(1);
    expect(data.coverage.skippedProjects[0]).toMatchObject({ key: 'BBB', name: 'Beta' });
    expect(data.coverage.skippedProjects[0].reasons[0]).toMatch(/403/);
  });

  test('records a project as partial when one of several roles is refused', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role/11')) throw new Error('Jira API 403 Forbidden');
        if (p.includes('/project/AAA/role/10')) return { actors: [] };
        if (p.includes('/project/AAA/role')) {
          return {
            Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10',
            Admin: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/11',
          };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.coverage.skippedProjects).toEqual([]);
    expect(data.coverage.partialProjects).toHaveLength(1);
    expect(data.coverage.partialProjects[0].key).toBe('AAA');
    // A partially read project still counts as audited — it did yield data.
    expect(data.coverage.projectsAudited).toBe(1);
    expect(data.coverage.noKnownGaps).toBe(false);
  });

  test('collects multiple gap reasons for the same project under one entry', async () => {
    const client = {
      getJson: vi.fn(async (p) => {
        if (p.includes('/project/search')) {
          return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        }
        if (p.includes('/project/AAA/role/10')) throw new Error('boom one');
        if (p.includes('/project/AAA/role/11')) throw new Error('boom two');
        if (p.includes('/project/AAA/role')) {
          return {
            Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10',
            Admin: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/11',
          };
        }
        throw new Error(`no route for ${p}`);
      }),
    };

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.coverage.partialProjects).toHaveLength(1);
    expect(data.coverage.partialProjects[0].reasons).toHaveLength(2);
  });

  test('excludes configured projects without fetching their roles', async () => {
    const client = mockClient({
      '/project/search': {
        values: [
          { id: '1', key: 'AAA', name: 'Alpha' },
          { id: '2', key: 'BBB', name: 'Beta' },
        ],
        isLast: true,
      },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/project/AAA/role/10': {
        actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
      },
      '/user?accountId=u1': { accountId: 'u1', displayName: 'Alice', emailAddress: 'a@acme.com' },
    });

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', {
      now,
      excludeProjects: ['BBB'],
    });

    expect(data.coverage.excludedProjects).toEqual([{ key: 'BBB', name: 'Beta' }]);
    expect(data.coverage.projectsVisible).toBe(2);
    expect(data.coverage.projectsAudited).toBe(1);
    // No role call for the excluded project.
    const paths = client.getJson.mock.calls.map(([p]) => p);
    expect(paths.some((p) => p.includes('BBB'))).toBe(false);
    // And nobody holds a role in it.
    expect(data.users.flatMap((u) => u.assignments).some((a) => a.projectKey === 'BBB')).toBe(false);
  });

  test('matches exclusions case-insensitively', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
    });
    const { data } = await buildAudit(client, 'https://acme.atlassian.net', {
      now,
      excludeProjects: ['aaa'],
    });
    expect(data.coverage.excludedProjects).toEqual([{ key: 'AAA', name: 'Alpha' }]);
    expect(data.coverage.unmatchedExclusions).toEqual([]);
  });

  test('warns when an exclusion matches no visible project', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': {},
    });
    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', {
      now,
      excludeProjects: ['NOPE'],
    });
    expect(data.coverage.unmatchedExclusions).toEqual(['NOPE']);
    expect(warnings.some((w) => /NOPE/.test(w))).toBe(true);
  });

  test('an exclusion is not counted as a gap — it is deliberate', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
    });
    const { data } = await buildAudit(client, 'https://acme.atlassian.net', {
      now,
      excludeProjects: ['AAA'],
    });
    expect(data.coverage.noKnownGaps).toBe(true);
    expect(data.coverage.skippedProjects).toEqual([]);
    expect(data.coverage.projectsAudited).toBe(0);
  });

  test('passes the acting identity into the report data', async () => {
    const client = mockClient({
      '/project/search': { values: [], isLast: true },
    });
    const { data } = await buildAudit(client, 'https://acme.atlassian.net', {
      now,
      identity: 'admin@acme.example',
    });
    expect(data.identity).toBe('admin@acme.example');
  });

  test('warns and continues when a role actor has an unhandled type', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/role/10': {
        actors: [{ type: 'atlassian-app-role-actor', displayName: 'Some App' }],
      },
    });

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });

    // The unhandled actor produces no user.
    expect(data.users).toEqual([]);
    // A warning is recorded identifying the project, role, and actor type.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
    expect(warnings[0]).toMatch(/Member/);
    expect(warnings[0]).toMatch(/atlassian-app-role-actor/);
  });
});
