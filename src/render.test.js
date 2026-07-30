import { describe, expect, test } from 'vitest';
import { renderHtml } from './render.js';

const data = {
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
    const parsed = JSON.parse(match[1]);
    expect(parsed.users[0].displayName).toBe('Alice');
  });

  test('carries coverage and identity into the embedded JSON so the page can warn', () => {
    const withGaps = {
      ...data,
      identity: 'admin@acme.example',
      coverage: {
        projectsVisible: 5,
        projectsAudited: 3,
        skippedProjects: [{ key: 'CCC', name: 'Gamma', reasons: ['role list unreadable: 403'] }],
        partialProjects: [{ key: 'DDD', name: 'Delta', reasons: ['role Member: 403'] }],
        warningCount: 2,
        noKnownGaps: false,
      },
    };
    const html = renderHtml(withGaps);
    const parsed = JSON.parse(
      html.match(/<script id="audit-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    );
    expect(parsed.coverage.noKnownGaps).toBe(false);
    expect(parsed.coverage.skippedProjects[0].key).toBe('CCC');
    expect(parsed.identity).toBe('admin@acme.example');
  });

  test('always ships the scope caveat and the gap banner element', () => {
    const html = renderHtml(data);
    expect(html).toContain('id="scope-banner"');
    expect(html).toContain('id="gap-banner"');
    expect(html).toMatch(/Geltungsbereich/);
    // The gap banner starts hidden and is revealed only when coverage has gaps.
    expect(html).toMatch(/id="gap-banner" class="banner banner-gap hidden"/);
  });

  test('ships the area-count filter controls and the result counter', () => {
    const html = renderHtml(data);
    expect(html).toContain('id="min-areas"');
    expect(html).toContain('id="max-areas"');
    expect(html).toContain('id="reset"');
    expect(html).toContain('id="count"');
  });

  test('ships the group and status filters plus a Status column', () => {
    const html = renderHtml(data);
    expect(html).toContain('id="group-filter"');
    expect(html).toContain('id="status-filter"');
    expect(html).toContain('data-sort="statusLabel"');
    expect(html).toContain('>Status<');
  });

  test('escapes the closing script sequence to prevent breakout', () => {
    const evil = {
      ...data,
      users: [{ ...data.users[0], displayName: 'x</script><script>alert(1)</script>' }],
    };
    const html = renderHtml(evil);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
