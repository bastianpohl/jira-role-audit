import { describe, expect, test, vi } from 'vitest';
import { createJiraClient, fetchAllPages } from './jiraClient.js';

const cfg = {
  apiBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-acme',
  accessToken: 'tok-abc',
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? { 'Content-Type': 'application/json' },
  });
}

describe('createJiraClient.getJson', () => {
  test('sends a bearer token and resolves paths against the api gateway base url', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createJiraClient(cfg, { fetchFn });
    const result = await client.getJson('/rest/api/3/myself');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.atlassian.com/ex/jira/cloud-acme/rest/api/3/myself');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-abc' });
  });

  test('retries on 429 honoring Retry-After then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ done: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createJiraClient(cfg, { fetchFn, sleep });
    const result = await client.getJson('/x');
    expect(result).toEqual({ done: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('throws on non-ok, non-429 status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 }));
    const client = createJiraClient(cfg, { fetchFn });
    await expect(client.getJson('/x')).rejects.toThrow(/403/);
  });

  test('throws a fatal error on 401 so an expired/invalid token cannot be silently swallowed', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    const client = createJiraClient(cfg, { fetchFn });
    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/401/);
    expect(err.message).toMatch(/token/i);
  });

  test('does not mark a 403 as fatal (per-project permission gaps are legitimate warnings)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 }));
    const client = createJiraClient(cfg, { fetchFn });
    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.fatal).toBeFalsy();
  });
});

describe('fetchAllPages', () => {
  test('accumulates values across pages until isLast', async () => {
    const pages = [
      { values: [1, 2], isLast: false, startAt: 0, maxResults: 2 },
      { values: [3], isLast: true, startAt: 2, maxResults: 2 },
    ];
    const client = {
      getJson: vi.fn((path) => Promise.resolve(path.includes('startAt=0') ? pages[0] : pages[1])),
    };
    const all = await fetchAllPages(client, (s) => `/p?startAt=${s}`);
    expect(all).toEqual([1, 2, 3]);
    expect(client.getJson).toHaveBeenCalledTimes(2);
  });
});
