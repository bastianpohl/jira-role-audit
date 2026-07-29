import { describe, expect, test, vi } from 'vitest';
import { fetchAccessToken, resolveCloudId, apiBaseUrlFor, basicAuthHeader } from './auth.js';

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

describe('basicAuthHeader', () => {
  test('base64-encodes email:token', () => {
    const header = basicAuthHeader('admin@acme.example', 'token789');
    expect(header.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('admin@acme.example:token789');
  });

  test('encodes non-ascii characters as utf-8 rather than mangling them', () => {
    const header = basicAuthHeader('bäcker@acme.example', 'töken');
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('bäcker@acme.example:töken');
  });
});

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
    expect(sent).toEqual({
      grant_type: 'client_credentials',
      client_id: 'cid123',
      client_secret: 'secret456',
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
    const err = await fetchAccessToken(cfg, { fetchFn }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain('secret456');
    expect(err.stack ?? '').not.toContain('secret456');
  });

  test('surfaces the response body detail when the token endpoint rejects the credentials', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: 'invalid_client', error_description: 'Unknown client id' },
        { status: 401 },
      ),
    );
    const err = await fetchAccessToken(cfg, { fetchFn }).then(() => null, (e) => e);
    expect(err.message).toMatch(/invalid_client/);
    expect(err.message).toMatch(/Unknown client id/);
  });

  test('throws a clear error when the token endpoint returns 200 with a non-JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<html>Not JSON</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(fetchAccessToken(cfg, { fetchFn })).rejects.toThrow(/JSON/i);
  });

  test('rejects when the response is 200 but contains no access_token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token_type: 'Bearer' }));
    await expect(fetchAccessToken(cfg, { fetchFn })).rejects.toThrow(/access_token/);
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

  test('throws a distinct message when the accessible-resources response is not an array', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).rejects.toThrow(/unexpected/i);
  });

  test('matches the accessible resource url case-insensitively', async () => {
    const mixedCaseCfg = { ...cfg, baseUrl: 'https://ACME.atlassian.net' };
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'cloud-acme', url: 'https://acme.atlassian.net' }]));
    await expect(resolveCloudId(mixedCaseCfg, 'tok', { fetchFn })).resolves.toBe('cloud-acme');
  });

  test('throws a clear error when the matched resource has no id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([{ url: 'https://acme.atlassian.net' }]));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).rejects.toThrow(/id/i);
  });

  test('propagates a non-2xx response from accessible-resources', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 }));
    await expect(resolveCloudId(cfg, 'tok', { fetchFn })).rejects.toThrow(/500/);
  });
});

describe('apiBaseUrlFor', () => {
  test('builds the api.atlassian.com gateway base url', () => {
    expect(apiBaseUrlFor('cloud-acme')).toBe('https://api.atlassian.com/ex/jira/cloud-acme');
  });
});
