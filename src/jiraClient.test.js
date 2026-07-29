import { describe, expect, test, vi } from 'vitest';
import { createJiraClient, fetchAllPages } from './jiraClient.js';

const cfg = {
  baseUrl: 'https://acme.atlassian.net',
  email: 'svc@acme.com',
  apiToken: 'tok',
  authHeader: 'Basic xyz',
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? { 'Content-Type': 'application/json' },
  });
}

describe('createJiraClient.getJson', () => {
  test('sends auth header and resolves relative path against baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createJiraClient(cfg, { fetchFn });
    const result = await client.getJson('/rest/api/3/myself');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(init.headers).toMatchObject({ Authorization: 'Basic xyz' });
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
