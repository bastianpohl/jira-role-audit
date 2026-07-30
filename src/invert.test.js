import { describe, expect, test } from 'vitest';
import { invertAssignments } from './invert.js';

const meta = { generatedAt: '2026-07-29T00:00:00Z', baseUrl: 'https://acme.atlassian.net' };

function raw(partial) {
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

  test('collects the distinct groups granting a user roles, sorted', () => {
    const data = invertAssignments(
      [
        raw({ via: { kind: 'group', groupName: 'devs' } }),
        raw({ projectKey: 'BBB', projectName: 'Beta', via: { kind: 'group', groupName: 'admins' } }),
        raw({ projectKey: 'CCC', projectName: 'Gamma', via: { kind: 'group', groupName: 'devs' } }),
        raw({ projectKey: 'DDD', projectName: 'Delta', via: { kind: 'direct' } }),
      ],
      meta,
    );
    expect(data.users[0].groups).toEqual(['admins', 'devs']);
  });

  test('a purely direct user has no groups', () => {
    const data = invertAssignments([raw({})], meta);
    expect(data.users[0].groups).toEqual([]);
  });

  test('carries the active status through', () => {
    const data = invertAssignments([raw({ active: false })], meta);
    expect(data.users[0].active).toBe(false);
  });

  test('status stays null when no record knows it, rather than defaulting to active', () => {
    const data = invertAssignments([raw({})], meta);
    expect(data.users[0].active).toBeNull();
  });

  test('a later record that knows the status fills in an unknown one', () => {
    const data = invertAssignments(
      [raw({ active: null }), raw({ projectKey: 'BBB', projectName: 'Beta', active: true })],
      meta,
    );
    expect(data.users[0].active).toBe(true);
  });

  test('does not let a later unknown status overwrite a known one', () => {
    const data = invertAssignments(
      [raw({ active: false }), raw({ projectKey: 'BBB', projectName: 'Beta', active: null })],
      meta,
    );
    expect(data.users[0].active).toBe(false);
  });

  test('passes through meta', () => {
    const data = invertAssignments([], meta);
    expect(data.generatedAt).toBe(meta.generatedAt);
    expect(data.baseUrl).toBe(meta.baseUrl);
    expect(data.users).toEqual([]);
  });
});
