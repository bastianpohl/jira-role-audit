import { describe, expect, test } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  JIRA_BASE_URL: 'https://acme.atlassian.net/',
  JIRA_EMAIL: 'svc@acme.com',
  JIRA_API_TOKEN: 'tok123',
};

describe('loadConfig', () => {
  test('strips trailing slash and builds basic auth header', () => {
    const cfg = loadConfig(base);
    expect(cfg.baseUrl).toBe('https://acme.atlassian.net');
    const expected = 'Basic ' + Buffer.from('svc@acme.com:tok123').toString('base64');
    expect(cfg.authHeader).toBe(expected);
  });

  test('throws listing all missing vars', () => {
    expect(() => loadConfig({})).toThrow(/JIRA_BASE_URL.*JIRA_EMAIL.*JIRA_API_TOKEN/);
  });
});
