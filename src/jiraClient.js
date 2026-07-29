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
 * Create a thin Jira REST client: Basic auth, 429-retry with backoff, JSON parsing.
 * @param {import('./config.js').Config} config
 * @param {ClientOptions} [opts]
 * @returns {JiraClient}
 */
export function createJiraClient(config, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function getJson(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config.baseUrl}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        headers: { Authorization: config.authHeader, Accept: 'application/json' },
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
