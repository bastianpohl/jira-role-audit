import { describe, expect, test, vi } from 'vitest';
import { fetchAccessToken, resolveCloudId, apiBaseUrlFor } from './auth.js';

const cfg = {
  baseUrl: 'https://acme.atlassian.net',
  clientId: 'cid123',
  clientSecret: 'secret456',
  cloudId: null,
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchAccessToken', () => {
  test('posts client_credentials to the atlassian token endpoint and returns the token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'tok-abc', token_type: 'Bearer', expires_in: 3600 }),
    );

    const token = await fetchAccessToken(cfg, { fetchFn });

    expect(token).toBe('tok-abc');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://auth.atlassian.com/oauth/token');
    expect(init.method).toBe('POST');

    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'cid123',
      client_secret: 'secret456',
      audience: 'api.atlassian.com',
    });
  });

  test('throws a clear error when the token endpoint rejects the credentials', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'invalid_client' }, { status: 401 }),
    );
    await expect(fetchAccessToken(cfg, { fetchFn })).rejects.toThrow(/401/);
  });

  test('does not leak the client secret in the error message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));
    await expect(fetchAccessToken(cfg, { fetchFn })).rejects.toThrow(
      expect.not.stringContaining('secret456'),
    );
  });
});

describe('resolveCloudId', () => {
  test('matches the accessible resource whose url equals the configured site', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([
        { id: 'cloud-other', url: 'https://other.atlassian.net' },
        { id: 'cloud-acme', url: 'https://acme.atlassian.net' },
      ]),
    );

    const cloudId = await resolveCloudId(cfg, 'tok-abc', { fetchFn });

    expect(cloudId).toBe('cloud-acme');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.atlassian.com/oauth/token/accessible-resources');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-abc' });
  });

  test('ignores a trailing slash difference when matching the site url', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'cloud-acme', url: 'https://acme.atlassian.net/' }]));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).resolves.toBe('cloud-acme');
  });

  test('uses the configured cloudId without calling the API', async () => {
    const fetchFn = vi.fn();
    const cloudId = await resolveCloudId({ ...cfg, cloudId: 'preset-cloud' }, 'tok', { fetchFn });
    expect(cloudId).toBe('preset-cloud');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('throws listing the available sites when none matches', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'cloud-other', url: 'https://other.atlassian.net' }]));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).rejects.toThrow(
      /https:\/\/other\.atlassian\.net/,
    );
  });

  test('throws when the credential can reach no sites at all', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).rejects.toThrow(/no accessible/i);
  });
});

describe('apiBaseUrlFor', () => {
  test('builds the api.atlassian.com gateway base url', () => {
    expect(apiBaseUrlFor('cloud-acme')).toBe('https://api.atlassian.com/ex/jira/cloud-acme');
  });
});
