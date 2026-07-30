import { describe, expect, test } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  JIRA_BASE_URL: 'https://acme.atlassian.net/',
  JIRA_CLIENT_ID: 'cid123',
  JIRA_CLIENT_SECRET: 'secret456',
};

const basicBase = {
  JIRA_BASE_URL: 'https://acme.atlassian.net/',
  JIRA_EMAIL: 'admin@acme.example',
  JIRA_API_TOKEN: 'token789',
};

describe('loadConfig', () => {
  test('strips trailing slash and exposes oauth credentials', () => {
    const cfg = loadConfig(base);
    expect(cfg.auth).toBe('oauth');
    expect(cfg.baseUrl).toBe('https://acme.atlassian.net');
    expect(cfg.clientId).toBe('cid123');
    expect(cfg.clientSecret).toBe('secret456');
  });

  test('infers basic auth from JIRA_EMAIL + JIRA_API_TOKEN', () => {
    const cfg = loadConfig(basicBase);
    expect(cfg.auth).toBe('basic');
    expect(cfg.baseUrl).toBe('https://acme.atlassian.net');
    expect(cfg.email).toBe('admin@acme.example');
    expect(cfg.apiToken).toBe('token789');
  });

  test('refuses to guess when both credential sets are configured', () => {
    expect(() => loadConfig({ ...base, ...basicBase })).toThrow(/JIRA_AUTH/);
  });

  test('JIRA_AUTH picks the mode when both credential sets are present', () => {
    expect(loadConfig({ ...base, ...basicBase, JIRA_AUTH: 'basic' }).auth).toBe('basic');
    expect(loadConfig({ ...base, ...basicBase, JIRA_AUTH: 'oauth' }).auth).toBe('oauth');
  });

  test('JIRA_AUTH is case-insensitive and tolerates surrounding whitespace', () => {
    expect(loadConfig({ ...base, ...basicBase, JIRA_AUTH: ' Basic ' }).auth).toBe('basic');
  });

  test('rejects an unknown JIRA_AUTH value instead of silently defaulting', () => {
    expect(() => loadConfig({ ...base, JIRA_AUTH: 'ldap' })).toThrow(/must be either/i);
  });

  test('names the missing var for the selected mode only', () => {
    const { JIRA_API_TOKEN, ...partial } = basicBase;
    expect(() => loadConfig(partial)).toThrow(/JIRA_API_TOKEN/);
    expect(() => loadConfig(partial)).not.toThrow(/JIRA_CLIENT_ID/);
  });

  test('mentions the API token alternative when nothing at all is configured', () => {
    expect(() => loadConfig({})).toThrow(/JIRA_EMAIL/);
  });

  test('excludeProjects defaults to an empty list', () => {
    expect(loadConfig(base).excludeProjects).toEqual([]);
  });

  test('parses excluded project keys, upper-casing and de-duplicating them', () => {
    const cfg = loadConfig({ ...base, JIRA_EXCLUDE_PROJECTS: 'aaa, BBB,ccc  DDD, bbb' });
    expect(cfg.excludeProjects).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
  });

  test('ignores stray separators in the exclusion list', () => {
    const cfg = loadConfig({ ...base, JIRA_EXCLUDE_PROJECTS: ' , ,AAA,, ' });
    expect(cfg.excludeProjects).toEqual(['AAA']);
  });

  test('exclusions are available in basic auth mode too', () => {
    const cfg = loadConfig({ ...basicBase, JIRA_EXCLUDE_PROJECTS: 'ZZZ' });
    expect(cfg.excludeProjects).toEqual(['ZZZ']);
  });

  test('cloudId is null when not configured', () => {
    expect(loadConfig(base).cloudId).toBeNull();
  });

  test('cloudId is taken from the environment when set', () => {
    const cfg = loadConfig({ ...base, JIRA_CLOUD_ID: 'cloud-abc' });
    expect(cfg.cloudId).toBe('cloud-abc');
  });

  test('throws listing all missing vars', () => {
    expect(() => loadConfig({})).toThrow(/JIRA_BASE_URL.*JIRA_CLIENT_ID.*JIRA_CLIENT_SECRET/);
  });

  test('throws naming only the missing var', () => {
    const { JIRA_CLIENT_SECRET, ...partial } = base;
    expect(() => loadConfig(partial)).toThrow(/JIRA_CLIENT_SECRET/);
    expect(() => loadConfig(partial)).not.toThrow(/JIRA_CLIENT_ID/);
  });
});
