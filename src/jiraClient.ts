import type { Config } from './config';

export interface JiraClient {
  getJson<T>(pathOrUrl: string): Promise<T>;
}

export interface PageBean<T> {
  values: T[];
  isLast?: boolean;
  startAt?: number;
  maxResults?: number;
  total?: number;
}

export interface ClientOptions {
  fetchFn?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createJiraClient(config: Config, opts: ClientOptions = {}): JiraClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function getJson<T>(pathOrUrl: string): Promise<T> {
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

      return (await res.json()) as T;
    }
  }

  return { getJson };
}

export async function fetchAllPages<T>(
  client: JiraClient,
  buildPath: (startAt: number) => string,
): Promise<T[]> {
  const all: T[] = [];
  let startAt = 0;
  for (;;) {
    const page = await client.getJson<PageBean<T>>(buildPath(startAt));
    all.push(...page.values);

    if (page.isLast || page.values.length === 0) break;
    if (page.total !== undefined && startAt + page.values.length >= page.total) break;

    const step = page.maxResults && page.maxResults > 0 ? page.maxResults : page.values.length;
    if (step <= 0) break;
    startAt += step;
  }
  return all;
}
