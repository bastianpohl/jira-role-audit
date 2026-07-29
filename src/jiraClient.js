/**
 * @typedef {object} JiraClient
 * @property {(pathOrUrl: string) => Promise<any>} getJson
 */

/**
 * @typedef {object} ClientOptions
 * @property {typeof fetch} [fetchFn]
 * @property {number} [maxRetries]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/**
 * @typedef {object} ClientAuth
 * @property {string} apiBaseUrl  e.g. https://api.atlassian.com/ex/jira/{cloudId}
 * @property {string} accessToken OAuth 2.0 bearer token
 */

/**
 * Create a thin Jira REST client: bearer auth, 429-retry with backoff, JSON parsing.
 * @param {ClientAuth} config
 * @param {ClientOptions} [opts]
 * @returns {JiraClient}
 */
export function createJiraClient(config, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function getJson(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config.apiBaseUrl}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' },
      });

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 30000);
        await sleep(delayMs);
        continue;
      }

      if (res.status === 401) {
        const err = new Error(
          `Jira API 401 ${res.statusText} for ${url} — the OAuth access token is invalid or expired.`,
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
