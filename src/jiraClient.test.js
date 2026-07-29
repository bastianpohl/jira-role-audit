import { describe, expect, test, vi } from 'vitest';
import { createJiraClient, fetchAllPages } from './jiraClient.js';

const cfg = {
  apiBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-acme',
  authHeader: 'Bearer tok-abc',
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

  test('refreshes the token on 401 and retries the request with the new one', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ done: true }));
    const refreshAuthHeader = vi.fn().mockResolvedValue('Bearer tok-fresh');
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    await expect(client.getJson('/x')).resolves.toEqual({ done: true });
    expect(refreshAuthHeader).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer tok-abc' });
    expect(fetchFn.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer tok-fresh' });
  });

  test('applies the refreshed token to subsequent requests without refreshing again', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      // A fresh Response per call — a Response body can only be read once.
      .mockImplementation(async () => jsonResponse({ done: true }));
    const refreshAuthHeader = vi.fn().mockResolvedValue('Bearer tok-fresh');
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    await client.getJson('/first');
    await client.getJson('/second');

    expect(refreshAuthHeader).toHaveBeenCalledTimes(1);
    const lastInit = fetchFn.mock.calls.at(-1)[1];
    expect(lastInit.headers).toMatchObject({ Authorization: 'Bearer tok-fresh' });
  });

  test('stays fatal when the request still 401s after a successful refresh', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    const refreshAuthHeader = vi.fn().mockResolvedValue('Bearer tok-fresh');
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err.fatal).toBe(true);
    expect(refreshAuthHeader).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('throws a fatal error explaining the refresh failure when re-minting the token fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    const refreshAuthHeader = vi.fn().mockRejectedValue(new Error('invalid_client'));
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/refreshing it failed/i);
    expect(err.message).toMatch(/invalid_client/);
  });

  test('treats a refresh callback that yields no token as a fatal failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    const refreshAuthHeader = vi.fn().mockResolvedValue(undefined);
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/no access token/i);
  });

  test('a token refresh does not consume the 429 retry budget', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ done: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const refreshAuthHeader = vi.fn().mockResolvedValue('Bearer tok-fresh');
    const client = createJiraClient(cfg, { fetchFn, sleep, refreshAuthHeader, maxRetries: 2 });

    await expect(client.getJson('/x')).resolves.toEqual({ done: true });
    // Backoff advanced 1s -> 2s across the two 429s; the 401 in between did not reset
    // or consume the budget.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  test('sends a Basic header verbatim against the site url when no refresh is configured', async () => {
    const basicCfg = {
      apiBaseUrl: 'https://acme.atlassian.net',
      authHeader: 'Basic ZW1haWw6dG9rZW4=',
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createJiraClient(basicCfg, { fetchFn });

    await expect(client.getJson('/rest/api/3/myself')).resolves.toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(init.headers).toMatchObject({ Authorization: 'Basic ZW1haWw6dG9rZW4=' });
  });

  test('fails fast on 401 without a refresh callback (API tokens do not expire)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    const client = createJiraClient(cfg, { fetchFn });

    const err = await client.getJson('/x').then(() => null, (e) => e);
    expect(err.fatal).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('collapses concurrent 401 refreshes onto a single token request', async () => {
    let refreshCount = 0;
    const fetchFn = vi.fn(async (_url, init) =>
      init.headers.Authorization === 'Bearer tok-abc'
        ? jsonResponse({}, { status: 401 })
        : jsonResponse({ done: true }),
    );
    const refreshAuthHeader = vi.fn(async () => {
      refreshCount++;
      await new Promise((r) => setTimeout(r, 5));
      return 'Bearer tok-fresh';
    });
    const client = createJiraClient(cfg, { fetchFn, refreshAuthHeader });

    const results = await Promise.all([client.getJson('/a'), client.getJson('/b')]);
    expect(results).toEqual([{ done: true }, { done: true }]);
    expect(refreshCount).toBe(1);
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
