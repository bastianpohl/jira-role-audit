const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const API_GATEWAY = 'https://api.atlassian.com/ex/jira';

/** Strip trailing slashes so site URLs compare equal regardless of formatting. */
function normalizeUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/**
 * Exchange the service account's client credentials for an access token.
 * The secret is never included in thrown errors.
 * @param {import('./config.js').Config} config
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<string>} the bearer access token
 */
export async function fetchAccessToken(config, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;

  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: 'api.atlassian.com',
    }),
  });

  if (!res.ok) {
    throw new Error(
      `OAuth token request failed: ${res.status} ${res.statusText}. ` +
        'Check JIRA_CLIENT_ID / JIRA_CLIENT_SECRET and the credential\'s scopes.',
    );
  }

  const body = await res.json();
  if (!body.access_token) {
    throw new Error('OAuth token response contained no access_token.');
  }
  return body.access_token;
}

/**
 * Determine the cloudId of the configured Jira site.
 * Uses config.cloudId when set, otherwise looks it up via accessible-resources.
 * @param {import('./config.js').Config} config
 * @param {string} accessToken
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<string>}
 */
export async function resolveCloudId(config, accessToken, opts = {}) {
  if (config.cloudId) return config.cloudId;

  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Could not list accessible resources: ${res.status} ${res.statusText}`);
  }

  const resources = await res.json();
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error(
      'The service account has no accessible Jira sites. Grant it access to the site and ' +
        'ensure the OAuth credential has Jira scopes.',
    );
  }

  const wanted = normalizeUrl(config.baseUrl);
  const match = resources.find((r) => normalizeUrl(r.url) === wanted);
  if (!match) {
    const available = resources.map((r) => normalizeUrl(r.url)).join(', ');
    throw new Error(
      `No accessible Jira site matches JIRA_BASE_URL (${wanted}). Available: ${available}. ` +
        'Fix JIRA_BASE_URL or set JIRA_CLOUD_ID explicitly.',
    );
  }
  return match.id;
}

/**
 * Build the API gateway base URL for a cloudId.
 * OAuth requests go through api.atlassian.com, not the site URL.
 * @param {string} cloudId
 * @returns {string}
 */
export function apiBaseUrlFor(cloudId) {
  return `${API_GATEWAY}/${cloudId}`;
}
