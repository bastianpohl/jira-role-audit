import { describe, expect, test } from 'vitest';
import { invertAssignments } from './invert';
import type { RawAssignment } from './auditTypes';

const meta = { generatedAt: '2026-07-29T00:00:00Z', baseUrl: 'https://acme.atlassian.net' };

function raw(partial: Partial<RawAssignment>): RawAssignment {
  return {
    projectKey: 'AAA',
    projectName: 'Alpha',
    roleName: 'Member',
    accountId: 'u1',
    displayName: 'Alice',
    emailAddress: 'alice@acme.com',
    via: { kind: 'direct' },
    ...partial,
  };
}

describe('invertAssignments', () => {
  test('groups assignments by user and counts distinct projects', () => {
    const data = invertAssignments(
      [
        raw({}),
        raw({ projectKey: 'BBB', projectName: 'Beta', roleName: 'Administrator' }),
        raw({ projectKey: 'AAA', projectName: 'Alpha', roleName: 'Administrator' }),
      ],
      meta,
    );
    expect(data.users).toHaveLength(1);
    const alice = data.users[0];
    expect(alice.accountId).toBe('u1');
    expect(alice.assignments).toHaveLength(3);
    expect(alice.areaCount).toBe(2); // AAA + BBB distinct
  });

  test('keeps users separate and sorts them by displayName', () => {
    const data = invertAssignments(
      [raw({ accountId: 'u2', displayName: 'Zoe' }), raw({ accountId: 'u1', displayName: 'Alice' })],
      meta,
    );
    expect(data.users.map((u) => u.displayName)).toEqual(['Alice', 'Zoe']);
  });

  test('preserves group access path', () => {
    const data = invertAssignments(
      [raw({ via: { kind: 'group', groupName: 'devs' } })],
      meta,
    );
    expect(data.users[0].assignments[0].via).toEqual({ kind: 'group', groupName: 'devs' });
  });

  test('passes through meta', () => {
    const data = invertAssignments([], meta);
    expect(data.generatedAt).toBe(meta.generatedAt);
    expect(data.baseUrl).toBe(meta.baseUrl);
    expect(data.users).toEqual([]);
  });
});
