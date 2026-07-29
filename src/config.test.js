import { describe, expect, test } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  JIRA_BASE_URL: 'https://acme.atlassian.net/',
  JIRA_CLIENT_ID: 'cid123',
  JIRA_CLIENT_SECRET: 'secret456',
};

describe('loadConfig', () => {
  test('strips trailing slash and exposes oauth credentials', () => {
    const cfg = loadConfig(base);
    expect(cfg.baseUrl).toBe('https://acme.atlassian.net');
    expect(cfg.clientId).toBe('cid123');
    expect(cfg.clientSecret).toBe('secret456');
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
