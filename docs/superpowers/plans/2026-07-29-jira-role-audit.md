# Jira Role/Area Audit Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TypeScript tool that audits which Jira Cloud users hold which project roles in which projects ("Bereiche") and renders a single self-contained HTML report with an overview and per-user detail view.

**Architecture:** A CLI generator loads config from `.env`, uses a thin Jira REST client (Basic auth, pagination, 429-retry) to fetch all projects → roles → actors, resolves group actors into member users (cached), inverts the data into a user-centric structure, and renders it into one HTML file with embedded JSON + vanilla JS to switch between overview and detail.

**Tech Stack:** Node ≥ 18 (native `fetch`), TypeScript run via `tsx` (no build step), `dotenv`, Vitest for tests.

## Global Constraints

- Package is ESM: `package.json` has `"type": "module"`.
- Relative imports are extensionless; `tsconfig.json` uses `"moduleResolution": "Bundler"`.
- Jira Cloud REST API v3, base path `/rest/api/3`. Base URL form: `https://<org>.atlassian.net`.
- Auth: HTTP Basic, header value `Basic base64(JIRA_EMAIL:JIRA_API_TOKEN)`.
- Required env vars: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. Never commit real `.env` (already in `.gitignore`).
- `emailAddress` may be `null` (account privacy) → represented as `null`, rendered as `—`.
- A "Bereich" = a Jira project; distinct project count drives `areaCount`.
- All pure logic is unit-tested against mocked API responses (TDD). No live API calls in tests.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: runnable `npm test` (Vitest) and `npm start` (tsx) scripts; ESM + TS toolchain the later tasks rely on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "jira-role-audit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Base URL of your Jira Cloud site (no trailing slash)
JIRA_BASE_URL=https://your-org.atlassian.net
# Service user email address
JIRA_EMAIL=service-user@your-org.com
# API token created at https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_API_TOKEN=your-api-token
```

- [ ] **Step 4: Install dependencies**

Run: `cd ~/jira-role-audit && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Create a temporary smoke test `src/smoke.test.ts`**

```ts
import { expect, test } from 'vitest';

test('toolchain runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: PASS (1 test passed).

- [ ] **Step 7: Delete the smoke test and commit**

```bash
rm src/smoke.test.ts
git add -A
git commit -m "chore: scaffold node/ts toolchain with vitest"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Config { baseUrl: string; email: string; apiToken: string; authHeader: string }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): Config` — validates required vars, strips trailing slashes from `baseUrl`, builds Basic auth header. Throws `Error` listing all missing vars.

- [ ] **Step 1: Write the failing tests `src/config.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

const base = {
  JIRA_BASE_URL: 'https://acme.atlassian.net/',
  JIRA_EMAIL: 'svc@acme.com',
  JIRA_API_TOKEN: 'tok123',
};

describe('loadConfig', () => {
  test('strips trailing slash and builds basic auth header', () => {
    const cfg = loadConfig(base);
    expect(cfg.baseUrl).toBe('https://acme.atlassian.net');
    const expected = 'Basic ' + Buffer.from('svc@acme.com:tok123').toString('base64');
    expect(cfg.authHeader).toBe(expected);
  });

  test('throws listing all missing vars', () => {
    expect(() => loadConfig({})).toThrow(/JIRA_BASE_URL.*JIRA_EMAIL.*JIRA_API_TOKEN/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- config`
Expected: FAIL (`loadConfig` not found / module missing).

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import 'dotenv/config';

export interface Config {
  baseUrl: string;
  email: string;
  apiToken: string;
  authHeader: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrlRaw = env.JIRA_BASE_URL;
  const email = env.JIRA_EMAIL;
  const apiToken = env.JIRA_API_TOKEN;

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!apiToken) missing.push('JIRA_API_TOKEN');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const baseUrl = baseUrlRaw!.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  return { baseUrl, email: email!, apiToken: apiToken!, authHeader };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- config`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config loader with env validation and basic auth"
```

---

### Task 3: Jira HTTP client (auth, 429-retry, pagination)

**Files:**
- Create: `src/jiraClient.ts`
- Test: `src/jiraClient.test.ts`

**Interfaces:**
- Consumes: `Config` from `./config`.
- Produces:
  - `interface JiraClient { getJson<T>(pathOrUrl: string): Promise<T> }`
  - `interface PageBean<T> { values: T[]; isLast?: boolean; startAt?: number; maxResults?: number; total?: number }`
  - `function createJiraClient(config: Config, opts?: { fetchFn?: typeof fetch; maxRetries?: number; sleep?: (ms: number) => Promise<void> }): JiraClient`
  - `function fetchAllPages<T>(client: JiraClient, buildPath: (startAt: number) => string): Promise<T[]>`

- [ ] **Step 1: Write the failing tests `src/jiraClient.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest';
import { createJiraClient, fetchAllPages } from './jiraClient';
import type { Config } from './config';

const cfg: Config = {
  baseUrl: 'https://acme.atlassian.net',
  email: 'svc@acme.com',
  apiToken: 'tok',
  authHeader: 'Basic xyz',
};

function jsonResponse(body: unknown, init: Partial<{ status: number; headers: Record<string, string> }> = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? { 'Content-Type': 'application/json' },
  });
}

describe('createJiraClient.getJson', () => {
  test('sends auth header and resolves relative path against baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createJiraClient(cfg, { fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.getJson<{ ok: boolean }>('/rest/api/3/myself');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Basic xyz' });
  });

  test('retries on 429 honoring Retry-After then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ done: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createJiraClient(cfg, { fetchFn: fetchFn as unknown as typeof fetch, sleep });
    const result = await client.getJson<{ done: boolean }>('/x');
    expect(result).toEqual({ done: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('throws on non-ok, non-429 status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 }));
    const client = createJiraClient(cfg, { fetchFn: fetchFn as unknown as typeof fetch });
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
      getJson: vi.fn((path: string) => Promise.resolve(path.includes('startAt=0') ? pages[0] : pages[1])),
    };
    const all = await fetchAllPages<number>(client as never, (s) => `/p?startAt=${s}`);
    expect(all).toEqual([1, 2, 3]);
    expect(client.getJson).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- jiraClient`
Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `src/jiraClient.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- jiraClient`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/jiraClient.ts src/jiraClient.test.ts
git commit -m "feat: add jira http client with 429-retry and pagination"
```

---

### Task 4: Audit data model + invert logic (pure)

**Files:**
- Create: `src/auditTypes.ts`
- Create: `src/invert.ts`
- Test: `src/invert.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (in `auditTypes.ts`):
  - `type AccessVia = { kind: 'direct' } | { kind: 'group'; groupName: string }`
  - `interface RawAssignment { projectKey: string; projectName: string; roleName: string; accountId: string; displayName: string; emailAddress: string | null; via: AccessVia }`
  - `interface Assignment { projectKey: string; projectName: string; roleName: string; via: AccessVia }`
  - `interface AuditUser { accountId: string; displayName: string; emailAddress: string | null; assignments: Assignment[]; areaCount: number }`
  - `interface AuditData { generatedAt: string; baseUrl: string; users: AuditUser[] }`
- Produces (in `invert.ts`):
  - `function invertAssignments(raws: RawAssignment[], meta: { generatedAt: string; baseUrl: string }): AuditData`

- [ ] **Step 1: Create `src/auditTypes.ts`**

```ts
export type AccessVia = { kind: 'direct' } | { kind: 'group'; groupName: string };

export interface RawAssignment {
  projectKey: string;
  projectName: string;
  roleName: string;
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  via: AccessVia;
}

export interface Assignment {
  projectKey: string;
  projectName: string;
  roleName: string;
  via: AccessVia;
}

export interface AuditUser {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  assignments: Assignment[];
  areaCount: number;
}

export interface AuditData {
  generatedAt: string;
  baseUrl: string;
  users: AuditUser[];
}
```

- [ ] **Step 2: Write the failing tests `src/invert.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { invertAssignments } from './invert';
import type { RawAssignment } from './auditTypes';

const meta = { generatedAt: '2026-07-29T00:00:00Z', baseUrl: 'https://acme.atlassian.net' };

function raw(partial: Partial<RawAssignment>): RawAssignment {
  return {
    projectKey: 'AAA',
    projectName: 'Alpha',
    roleName: 'Member',
    accountId: 'u1',
    displayName: 'Alice',
    emailAddress: 'alice@acme.com',
    via: { kind: 'direct' },
    ...partial,
  };
}

describe('invertAssignments', () => {
  test('groups assignments by user and counts distinct projects', () => {
    const data = invertAssignments(
      [
        raw({}),
        raw({ projectKey: 'BBB', projectName: 'Beta', roleName: 'Administrator' }),
        raw({ projectKey: 'AAA', projectName: 'Alpha', roleName: 'Administrator' }),
      ],
      meta,
    );
    expect(data.users).toHaveLength(1);
    const alice = data.users[0];
    expect(alice.accountId).toBe('u1');
    expect(alice.assignments).toHaveLength(3);
    expect(alice.areaCount).toBe(2); // AAA + BBB distinct
  });

  test('keeps users separate and sorts them by displayName', () => {
    const data = invertAssignments(
      [raw({ accountId: 'u2', displayName: 'Zoe' }), raw({ accountId: 'u1', displayName: 'Alice' })],
      meta,
    );
    expect(data.users.map((u) => u.displayName)).toEqual(['Alice', 'Zoe']);
  });

  test('preserves group access path', () => {
    const data = invertAssignments(
      [raw({ via: { kind: 'group', groupName: 'devs' } })],
      meta,
    );
    expect(data.users[0].assignments[0].via).toEqual({ kind: 'group', groupName: 'devs' });
  });

  test('passes through meta', () => {
    const data = invertAssignments([], meta);
    expect(data.generatedAt).toBe(meta.generatedAt);
    expect(data.baseUrl).toBe(meta.baseUrl);
    expect(data.users).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- invert`
Expected: FAIL (`invertAssignments` missing).

- [ ] **Step 4: Implement `src/invert.ts`**

```ts
import type { AuditData, AuditUser, RawAssignment } from './auditTypes';

export function invertAssignments(
  raws: RawAssignment[],
  meta: { generatedAt: string; baseUrl: string },
): AuditData {
  const byUser = new Map<string, AuditUser>();

  for (const r of raws) {
    let user = byUser.get(r.accountId);
    if (!user) {
      user = {
        accountId: r.accountId,
        displayName: r.displayName,
        emailAddress: r.emailAddress,
        assignments: [],
        areaCount: 0,
      };
      byUser.set(r.accountId, user);
    }
    // Prefer a non-null email if a later record has one.
    if (user.emailAddress === null && r.emailAddress !== null) {
      user.emailAddress = r.emailAddress;
    }
    user.assignments.push({
      projectKey: r.projectKey,
      projectName: r.projectName,
      roleName: r.roleName,
      via: r.via,
    });
  }

  for (const user of byUser.values()) {
    user.areaCount = new Set(user.assignments.map((a) => a.projectKey)).size;
    user.assignments.sort(
      (a, b) => a.projectName.localeCompare(b.projectName) || a.roleName.localeCompare(b.roleName),
    );
  }

  const users = [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { generatedAt: meta.generatedAt, baseUrl: meta.baseUrl, users };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- invert`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/auditTypes.ts src/invert.ts src/invert.test.ts
git commit -m "feat: add audit data model and invert logic"
```

---

### Task 5: Fetch orchestration (projects → roles → actors, group + user resolution, caching)

**Files:**
- Create: `src/fetchAudit.ts`
- Test: `src/fetchAudit.test.ts`

**Interfaces:**
- Consumes: `JiraClient`, `fetchAllPages` from `./jiraClient`; `invertAssignments` from `./invert`; types from `./auditTypes`.
- Produces:
  - `interface AuditResult { data: AuditData; warnings: string[] }`
  - `function buildAudit(client: JiraClient, baseUrl: string, opts?: { now?: () => Date }): Promise<AuditResult>`

**Jira response shapes used:**
- `GET /rest/api/3/project/search?startAt=&maxResults=50` → `PageBean<{ id: string; key: string; name: string }>`
- `GET /rest/api/3/project/{key}/role` → `Record<string, string>` (roleName → absolute role URL)
- `GET {roleUrl}` → `{ actors?: Array<{ type: string; displayName?: string; actorUser?: { accountId: string }; actorGroup?: { name?: string; displayName?: string; groupId: string } }> }`
- `GET /rest/api/3/group/member?groupId=&startAt=` → `PageBean<{ accountId: string; displayName: string; emailAddress?: string | null }>`
- `GET /rest/api/3/user?accountId=` → `{ accountId: string; displayName: string; emailAddress?: string | null }`

- [ ] **Step 1: Write the failing tests `src/fetchAudit.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest';
import { buildAudit } from './fetchAudit';
import type { JiraClient } from './jiraClient';

// Router-style mock client keyed by URL/path substring.
function mockClient(routes: Record<string, unknown>): JiraClient {
  return {
    getJson: vi.fn(async (p: string) => {
      const key = Object.keys(routes).find((k) => p.includes(k));
      if (!key) throw new Error(`no route for ${p}`);
      return routes[key];
    }),
  };
}

const now = () => new Date('2026-07-29T10:00:00Z');

describe('buildAudit', () => {
  test('resolves direct user actors and enriches email via user lookup', async () => {
    const client = mockClient({
      '/project/search': { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/role/10': {
        actors: [{ type: 'atlassian-user-role-actor', displayName: 'Alice', actorUser: { accountId: 'u1' } }],
      },
      '/user?accountId=u1': { accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@acme.com' },
    });

    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(warnings).toEqual([]);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].emailAddress).toBe('alice@acme.com');
    expect(data.users[0].assignments[0]).toMatchObject({
      projectKey: 'AAA',
      roleName: 'Member',
      via: { kind: 'direct' },
    });
  });

  test('expands group actors into members and caches group lookups', async () => {
    const client = mockClient({
      '/project/search': {
        values: [
          { id: '1', key: 'AAA', name: 'Alpha' },
          { id: '2', key: 'BBB', name: 'Beta' },
        ],
        isLast: true,
      },
      '/project/AAA/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/AAA/role/10' },
      '/project/BBB/role': { Member: 'https://acme.atlassian.net/rest/api/3/project/BBB/role/10' },
      '/project/AAA/role/10': {
        actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
      },
      '/project/BBB/role/10': {
        actors: [{ type: 'atlassian-group-role-actor', actorGroup: { name: 'devs', displayName: 'devs', groupId: 'g1' } }],
      },
      '/group/member?groupId=g1': {
        values: [{ accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@acme.com' }],
        isLast: true,
      },
    });

    const { data } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.users).toHaveLength(1);
    expect(data.users[0].areaCount).toBe(2);
    expect(data.users[0].assignments[0].via).toEqual({ kind: 'group', groupName: 'devs' });
    // group members fetched once despite two projects (cache)
    const calls = (client.getJson as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls.filter((c) => c.includes('/group/member?groupId=g1'))).toHaveLength(1);
  });

  test('collects a warning and continues when a project role listing fails', async () => {
    const client: JiraClient = {
      getJson: vi.fn(async (p: string) => {
        if (p.includes('/project/search')) return { values: [{ id: '1', key: 'AAA', name: 'Alpha' }], isLast: true };
        if (p.includes('/project/AAA/role')) throw new Error('boom 403');
        throw new Error(`no route for ${p}`);
      }),
    };
    const { data, warnings } = await buildAudit(client, 'https://acme.atlassian.net', { now });
    expect(data.users).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AAA/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- fetchAudit`
Expected: FAIL (`buildAudit` missing).

- [ ] **Step 3: Implement `src/fetchAudit.ts`**

```ts
import type { AuditData, RawAssignment } from './auditTypes';
import { invertAssignments } from './invert';
import { fetchAllPages, type JiraClient } from './jiraClient';

interface Project {
  id: string;
  key: string;
  name: string;
}

interface RoleActor {
  type: string;
  displayName?: string;
  actorUser?: { accountId: string };
  actorGroup?: { name?: string; displayName?: string; groupId: string };
}

interface RoleDetail {
  actors?: RoleActor[];
}

interface GroupMember {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
}

interface UserDetail {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
}

export interface AuditResult {
  data: AuditData;
  warnings: string[];
}

export async function buildAudit(
  client: JiraClient,
  baseUrl: string,
  opts: { now?: () => Date } = {},
): Promise<AuditResult> {
  const now = opts.now ?? (() => new Date());
  const warnings: string[] = [];
  const raws: RawAssignment[] = [];

  const groupCache = new Map<string, GroupMember[]>();
  const userCache = new Map<string, UserDetail>();

  async function resolveGroup(groupId: string): Promise<GroupMember[]> {
    const cached = groupCache.get(groupId);
    if (cached) return cached;
    const members = await fetchAllPages<GroupMember>(
      client,
      (startAt) => `/rest/api/3/group/member?groupId=${encodeURIComponent(groupId)}&startAt=${startAt}`,
    );
    groupCache.set(groupId, members);
    return members;
  }

  async function resolveUser(accountId: string, fallbackName: string): Promise<UserDetail> {
    const cached = userCache.get(accountId);
    if (cached) return cached;
    let detail: UserDetail;
    try {
      detail = await client.getJson<UserDetail>(`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`);
    } catch (err) {
      warnings.push(`User ${accountId}: ${(err as Error).message}`);
      detail = { accountId, displayName: fallbackName, emailAddress: null };
    }
    userCache.set(accountId, detail);
    return detail;
  }

  const projects = await fetchAllPages<Project>(
    client,
    (startAt) => `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`,
  );

  for (const project of projects) {
    let roleMap: Record<string, string>;
    try {
      roleMap = await client.getJson<Record<string, string>>(`/rest/api/3/project/${project.key}/role`);
    } catch (err) {
      warnings.push(`Project ${project.key} roles: ${(err as Error).message}`);
      continue;
    }

    for (const [roleName, roleUrl] of Object.entries(roleMap)) {
      let roleDetail: RoleDetail;
      try {
        roleDetail = await client.getJson<RoleDetail>(roleUrl);
      } catch (err) {
        warnings.push(`Project ${project.key} role ${roleName}: ${(err as Error).message}`);
        continue;
      }

      for (const actor of roleDetail.actors ?? []) {
        if (actor.type === 'atlassian-user-role-actor' && actor.actorUser) {
          const user = await resolveUser(actor.actorUser.accountId, actor.displayName ?? actor.actorUser.accountId);
          raws.push({
            projectKey: project.key,
            projectName: project.name,
            roleName,
            accountId: user.accountId,
            displayName: user.displayName,
            emailAddress: user.emailAddress ?? null,
            via: { kind: 'direct' },
          });
        } else if (actor.type === 'atlassian-group-role-actor' && actor.actorGroup) {
          const groupName = actor.actorGroup.displayName ?? actor.actorGroup.name ?? actor.actorGroup.groupId;
          const members = await resolveGroup(actor.actorGroup.groupId);
          for (const member of members) {
            raws.push({
              projectKey: project.key,
              projectName: project.name,
              roleName,
              accountId: member.accountId,
              displayName: member.displayName,
              emailAddress: member.emailAddress ?? null,
              via: { kind: 'group', groupName },
            });
          }
        }
      }
    }
  }

  const data = invertAssignments(raws, {
    generatedAt: now().toISOString(),
    baseUrl,
  });
  return { data, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- fetchAudit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fetchAudit.ts src/fetchAudit.test.ts
git commit -m "feat: add fetch orchestration with group/user resolution and caching"
```

---

### Task 6: HTML renderer (single-file report)

**Files:**
- Create: `src/render.ts`
- Test: `src/render.test.ts`

**Interfaces:**
- Consumes: `AuditData` from `./auditTypes`.
- Produces:
  - `function renderHtml(data: AuditData): string` — returns a complete HTML document with the `AuditData` embedded as JSON in a `<script id="audit-data" type="application/json">` block and vanilla JS that renders an overview table (Name, E-Mail, Anzahl Bereiche) and a per-user detail view.

- [ ] **Step 1: Write the failing tests `src/render.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { renderHtml } from './render';
import type { AuditData } from './auditTypes';

const data: AuditData = {
  generatedAt: '2026-07-29T10:00:00Z',
  baseUrl: 'https://acme.atlassian.net',
  users: [
    {
      accountId: 'u1',
      displayName: 'Alice',
      emailAddress: 'alice@acme.com',
      areaCount: 2,
      assignments: [
        { projectKey: 'AAA', projectName: 'Alpha', roleName: 'Member', via: { kind: 'direct' } },
        { projectKey: 'BBB', projectName: 'Beta', roleName: 'Administrator', via: { kind: 'group', groupName: 'devs' } },
      ],
    },
  ],
};

describe('renderHtml', () => {
  test('produces a full HTML document', () => {
    const html = renderHtml(data);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('</html>');
  });

  test('embeds audit data as parseable JSON', () => {
    const html = renderHtml(data);
    const match = html.match(/<script id="audit-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.users[0].displayName).toBe('Alice');
  });

  test('escapes the closing script sequence to prevent breakout', () => {
    const evil: AuditData = {
      ...data,
      users: [{ ...data.users[0], displayName: 'x</script><script>alert(1)</script>' }],
    };
    const html = renderHtml(evil);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- render`
Expected: FAIL (`renderHtml` missing).

- [ ] **Step 3: Implement `src/render.ts`**

```ts
import type { AuditData } from './auditTypes';

function embedJson(data: AuditData): string {
  // Escape "<" so "</script>" inside strings cannot close the tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function renderHtml(data: AuditData): string {
  const json = embedJson(data);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jira Rollen-/Bereichs-Report</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 1.5rem; }
  h1 { font-size: 1.3rem; }
  .meta { color: #888; font-size: .85rem; margin-bottom: 1rem; }
  input[type=search] { padding: .4rem .6rem; width: 100%; max-width: 320px; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #8884; }
  th { cursor: pointer; user-select: none; }
  tbody tr.clickable:hover { background: #8882; cursor: pointer; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .via-group { color: #b26a00; }
  .back { display: inline-block; margin-bottom: 1rem; cursor: pointer; color: #06c; }
  .hidden { display: none; }
  code { background: #8882; padding: 0 .3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>Jira Rollen-/Bereichs-Report</h1>
<div class="meta" id="meta"></div>

<section id="overview">
  <input type="search" id="filter" placeholder="Nach Name oder E-Mail filtern…">
  <table>
    <thead><tr>
      <th data-sort="displayName">Name</th>
      <th data-sort="emailAddress">E-Mail</th>
      <th data-sort="areaCount" class="num">Anzahl Bereiche</th>
    </tr></thead>
    <tbody id="overview-body"></tbody>
  </table>
</section>

<section id="detail" class="hidden">
  <span class="back" id="back">&larr; Zurück zur Übersicht</span>
  <h2 id="detail-name"></h2>
  <div class="meta" id="detail-sub"></div>
  <table>
    <thead><tr><th>Projekt</th><th>Key</th><th>Rolle</th><th>Zugriffsweg</th></tr></thead>
    <tbody id="detail-body"></tbody>
  </table>
</section>

<script id="audit-data" type="application/json">${json}</script>
<script>
(function () {
  const data = JSON.parse(document.getElementById('audit-data').textContent);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  document.getElementById('meta').textContent =
    'Erzeugt: ' + data.generatedAt + ' · ' + data.baseUrl + ' · ' + data.users.length + ' Benutzer';

  let sortKey = 'displayName';
  let sortDir = 1;
  let filter = '';

  function viaLabel(via) {
    return via.kind === 'group'
      ? '<span class="via-group">über Gruppe ' + esc(via.groupName) + '</span>'
      : 'direkt';
  }

  function renderOverview() {
    const rows = data.users
      .filter((u) => {
        const hay = (u.displayName + ' ' + (u.emailAddress || '')).toLowerCase();
        return hay.includes(filter);
      })
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * sortDir;
      });
    document.getElementById('overview-body').innerHTML = rows
      .map((u) =>
        '<tr class="clickable" data-id="' + esc(u.accountId) + '">' +
        '<td>' + esc(u.displayName) + '</td>' +
        '<td>' + (u.emailAddress ? esc(u.emailAddress) : '—') + '</td>' +
        '<td class="num">' + u.areaCount + '</td></tr>')
      .join('');
  }

  function showDetail(accountId) {
    const u = data.users.find((x) => x.accountId === accountId);
    if (!u) return;
    document.getElementById('detail-name').textContent = u.displayName;
    document.getElementById('detail-sub').textContent =
      (u.emailAddress || '—') + ' · ' + u.areaCount + ' Bereiche';
    document.getElementById('detail-body').innerHTML = u.assignments
      .map((a) =>
        '<tr><td>' + esc(a.projectName) + '</td><td><code>' + esc(a.projectKey) + '</code></td>' +
        '<td>' + esc(a.roleName) + '</td><td>' + viaLabel(a.via) + '</td></tr>')
      .join('');
    document.getElementById('overview').classList.add('hidden');
    document.getElementById('detail').classList.remove('hidden');
  }

  function showOverview() {
    document.getElementById('detail').classList.add('hidden');
    document.getElementById('overview').classList.remove('hidden');
  }

  document.getElementById('overview-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) showDetail(tr.getAttribute('data-id'));
  });
  document.getElementById('back').addEventListener('click', showOverview);
  document.getElementById('filter').addEventListener('input', (e) => {
    filter = e.target.value.toLowerCase();
    renderOverview();
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (key === sortKey) sortDir *= -1; else { sortKey = key; sortDir = 1; }
      renderOverview();
    });
  });

  renderOverview();
})();
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- render`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "feat: add single-file html report renderer"
```

---

### Task 7: CLI entry point + README

**Files:**
- Create: `src/main.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `loadConfig`, `createJiraClient`, `buildAudit`, `renderHtml`.
- Produces: `npm start` writes `jira-role-audit.html` and prints progress + warnings. No exported API.

- [ ] **Step 1: Implement `src/main.ts`**

```ts
import { writeFile } from 'node:fs/promises';
import { loadConfig } from './config';
import { createJiraClient } from './jiraClient';
import { buildAudit } from './fetchAudit';
import { renderHtml } from './render';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = createJiraClient(config);

  console.log(`Fetching Jira audit data from ${config.baseUrl} …`);
  const { data, warnings } = await buildAudit(client, config.baseUrl);

  const outPath = process.env.OUTPUT_FILE ?? 'jira-role-audit.html';
  await writeFile(outPath, renderHtml(data), 'utf8');

  console.log(`Wrote ${outPath} — ${data.users.length} users across their Bereiche.`);
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error(`Failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Verify the full suite still passes**

Run: `npm test`
Expected: PASS (all tests from Tasks 2–6, 16 total).

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Create `README.md`**

````markdown
# Jira Role/Area Audit Report

Generates a single self-contained HTML report showing which Jira Cloud users hold
which project roles in which projects ("Bereiche"). Group role members are resolved
into individual users.

## Requirements

- Node ≥ 18
- A Jira Cloud **service user** with an API token. The user needs *Administer Jira*
  (or at least Browse permission on every project you want audited) — missing
  permissions mean missing Bereiche in the report.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the three values
```

`.env`:

- `JIRA_BASE_URL` — e.g. `https://your-org.atlassian.net`
- `JIRA_EMAIL` — the service user's email
- `JIRA_API_TOKEN` — from https://id.atlassian.com/manage-profile/security/api-tokens

## Run

```bash
npm start
```

Writes `jira-role-audit.html` (override with `OUTPUT_FILE=path npm start`). Open it in
a browser: overview table (Name, E-Mail, Anzahl Bereiche) with search/sort, click a
row for the per-user detail view (Projekt, Key, Rolle, Zugriffsweg).

## Test

```bash
npm test
```
````

- [ ] **Step 5: Commit**

```bash
git add src/main.ts README.md
git commit -m "feat: add cli entry point and readme"
```

---

## Self-Review

**Spec coverage:**
- Static single-file HTML report → Task 6. ✓
- Overview (Name, E-Mail, Anzahl Bereiche) → Task 6 overview table. ✓
- Detail view (Projekt, Rolle, Zugriffsweg) → Task 6 detail view. ✓
- Bereich = Jira project, roles = project roles → Task 5. ✓
- Group actors resolved to member users → Task 5 `resolveGroup`. ✓
- Access path direct vs. group recorded → `AccessVia` (Task 4), populated in Task 5. ✓
- Service-user Basic auth, `.env` config → Tasks 1 (`.env.example`), 2 (`loadConfig`). ✓
- Pagination → Task 3 `fetchAllPages`, used in Task 5. ✓
- 429 retry with backoff / Retry-After → Task 3. ✓
- Group-resolution cache → Task 5 `groupCache`. ✓
- Error tolerance (one project/role failure doesn't abort) → Task 5 try/catch + warnings. ✓
- Email may be null → `emailAddress: string | null`, rendered as `—` (Tasks 4, 6). ✓
- Unit tests for pagination, invert, group resolution, 429 → Tasks 3, 4, 5. ✓
- Out of scope items (no server, no Confluence, no permission schemes) → respected. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `RawAssignment`/`Assignment`/`AuditUser`/`AuditData` used identically across Tasks 4–6; `JiraClient.getJson`, `fetchAllPages`, `createJiraClient`, `buildAudit`, `renderHtml`, `loadConfig` signatures match between producer and consumer tasks.
