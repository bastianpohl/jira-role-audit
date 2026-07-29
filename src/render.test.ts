import { describe, expect, test } from 'vitest';
import { renderHtml } from './render';
import type { AuditData } from './auditTypes';

const data: AuditData = {
  generatedAt: '2026-07-29T10:00:00Z',
  baseUrl: 'https://acme.atlassian.net',
  users: [
    {
      accountId: 'u1',
      displayName: 'Alice',
      emailAddress: 'alice@acme.com',
      areaCount: 2,
      assignments: [
        { projectKey: 'AAA', projectName: 'Alpha', roleName: 'Member', via: { kind: 'direct' } },
        { projectKey: 'BBB', projectName: 'Beta', roleName: 'Administrator', via: { kind: 'group', groupName: 'devs' } },
      ],
    },
  ],
};

describe('renderHtml', () => {
  test('produces a full HTML document', () => {
    const html = renderHtml(data);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('</html>');
  });

  test('embeds audit data as parseable JSON', () => {
    const html = renderHtml(data);
    const match = html.match(/<script id="audit-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.users[0].displayName).toBe('Alice');
  });

  test('escapes the closing script sequence to prevent breakout', () => {
    const evil: AuditData = {
      ...data,
      users: [{ ...data.users[0], displayName: 'x</script><script>alert(1)</script>' }],
    };
    const html = renderHtml(evil);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
