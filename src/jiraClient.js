/**
 * @typedef {object} JiraClient
 * @property {(pathOrUrl: string) => Promise<any>} getJson
 */

/**
 * @typedef {object} ClientOptions
 * @property {typeof fetch} [fetchFn]
 * @property {number} [maxRetries]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => Promise<string>} [refreshAuthHeader]
 *   Obtain a fresh Authorization header. Service account OAuth tokens live 60
 *   minutes, which a large audit can outlast, so a 401 triggers one
 *   refresh-and-retry before it is treated as fatal. Omit it for credentials that
 *   do not expire (API tokens), where a 401 can only mean bad credentials.
 */

/**
 * @typedef {object} ClientAuth
 * @property {string} apiBaseUrl  OAuth: https://api.atlassian.com/ex/jira/{cloudId}
 *                                API token: the site URL, e.g. https://acme.atlassian.net
 * @property {string} authHeader  Full Authorization header value ('Bearer …' or 'Basic …')
 */

/**
 * Create a thin Jira REST client: 429-retry with backoff, JSON parsing, and an
 * auth scheme it deliberately knows nothing about beyond the header value.
 * @param {ClientAuth} config
 * @param {ClientOptions} [opts]
 * @returns {JiraClient}
 */
export function createJiraClient(config, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const refreshAuthHeader = opts.refreshAuthHeader ?? null;

  // Held in a mutable local (not on config) so a refresh applies to every later
  // request, not just the one that hit the 401.
  let authHeader = config.authHeader;
  let inFlightRefresh = null;

  /** Refresh credentials, collapsing concurrent callers onto a single token request. */
  async function refresh() {
    if (!inFlightRefresh) {
      inFlightRefresh = (async () => {
        try {
          const fresh = await refreshAuthHeader();
          if (!fresh) throw new Error('the refresh callback returned no access token');
          authHeader = fresh;
          return fresh;
        } finally {
          inFlightRefresh = null;
        }
      })();
    }
    return inFlightRefresh;
  }

  async function getJson(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config.apiBaseUrl}${pathOrUrl}`;
    // Counted separately from the 401 refresh so refreshing does not eat the
    // rate-limit budget (and vice versa).
    let rateLimitAttempt = 0;
    let refreshed = false;

    for (;;) {
      const res = await fetchFn(url, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });

      if (res.status === 429 && rateLimitAttempt < maxRetries) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** rateLimitAttempt, 30000);
        rateLimitAttempt++;
        await sleep(delayMs);
        continue;
      }

      if (res.status === 401) {
        // An expired mid-audit token and a bad credential look identical here, so
        // try exactly one refresh: if the retry still 401s, the credential is at
        // fault and the error stays fatal.
        if (refreshAuthHeader && !refreshed) {
          refreshed = true;
          try {
            await refresh();
          } catch (cause) {
            const err = new Error(
              `Jira API 401 ${res.statusText} for ${url} — the OAuth access token expired and ` +
                `refreshing it failed: ${cause.message}`,
            );
            err.fatal = true;
            throw err;
          }
          continue;
        }

        const err = new Error(
          `Jira API 401 ${res.statusText} for ${url} — the credentials were rejected ` +
            '(invalid or expired token).',
        );
        err.fatal = true;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Jira API ${res.status} ${res.statusText} for ${url}`);
      }

      return await res.json();
    }
  }

  return { getJson };
}

/**
 * Follow Jira page beans (`values` + `isLast`/`total`) until exhausted.
 * @template T
 * @param {JiraClient} client
 * @param {(startAt: number) => string} buildPath
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages(client, buildPath) {
  const all = [];
  let startAt = 0;
  for (;;) {
    const page = await client.getJson(buildPath(startAt));
    all.push(...page.values);

    if (page.isLast || page.values.length === 0) break;
    if (page.total !== undefined && startAt + page.values.length >= page.total) break;

    const step = page.maxResults && page.maxResults > 0 ? page.maxResults : page.values.length;
    if (step <= 0) break;
    startAt += step;
  }
  return all;
}
