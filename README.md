# Jira Role/Area Audit Report

Generates a single self-contained HTML report showing which Jira Cloud users hold
which project roles in which projects ("Bereiche"). Group role members are resolved
into individual users.

Plain Node.js (JavaScript, ES modules) — no build step, run directly with `node`.

## Requirements

- Node ≥ 18 (uses the built-in global `fetch`)
- An Atlassian **service account** with an OAuth 2.0 credential (client id + secret).
  The account needs access to every project you want audited — missing permissions
  mean missing Bereiche in the report.

## Setup

1. In [admin.atlassian.com](https://admin.atlassian.com): **Directory → Service accounts →**
   your account **→ Create OAuth 2.0 credential**. Grant the scopes listed under
   [Scopes and permissions](#scopes-and-permissions), and give the account access to
   the Jira site. Copy the client id and secret — the secret is shown only once.
2. Install and configure:

```bash
npm install
cp .env.example .env   # then fill in the values
```

`.env`:

- `JIRA_BASE_URL` — e.g. `https://your-org.atlassian.net`
- `JIRA_CLIENT_ID` — the service account's OAuth 2.0 client id
- `JIRA_CLIENT_SECRET` — the matching client secret
- `JIRA_CLOUD_ID` — *optional*; resolved automatically from `JIRA_BASE_URL` when unset

## Scopes and permissions

Grant the credential these **granular** Jira scopes:

| Scope | Needed for |
| --- | --- |
| `read:project:jira` | project list and role detail |
| `read:project-role:jira` | project roles and their actors |
| `read:project-category:jira` | project list and role detail |
| `read:project.property:jira`, `read:project-version:jira`, `read:project.component:jira` | project search response |
| `read:issue-type:jira`, `read:issue-type-hierarchy:jira` | project search response |
| `read:user:jira` | user detail (name, e-mail) |
| `read:group:jira` | expanding group role members |
| `read:avatar:jira`, `read:application-role:jira` | embedded in user/project payloads |

Granular rather than classic on purpose: with classic scopes, `GET /group/member` —
which this tool needs to expand group-based role membership — requires
`manage:jira-configuration`, a broad *configuration management* scope. The granular
equivalent is just `read:group:jira`, so the credential stays read-only. (Atlassian
otherwise recommends classic scopes; this is one of the endpoints where granular is
the better trade.)

**Scopes are only one of three layers.** A request succeeds only if product access,
Jira permissions *and* credential scope all allow it. The API requires:

- `GET /project/{key}/role` — *Administer Projects* for **every** project on the site,
  or *Administer Jira* (global)
- `GET /group/member`, `GET /user` — *Browse users and groups*, or *Administer Jira*
- `GET /project/search` — returns **only** projects the account can browse

So without *Administer Jira*, the report is **silently incomplete**: invisible projects
are simply absent rather than reported as an error, and role calls that are refused show
up only as warnings on stderr. Grant the service account *Administer Jira* and check the
warning count at the end of each run.

### How authentication works

The tool exchanges the client credentials for an access token at
`https://auth.atlassian.com/oauth/token` (`grant_type=client_credentials`), resolves the
site's `cloudId`, and calls the Jira REST API through the gateway at
`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` with a bearer token.

Tokens are valid for 60 minutes, which a large audit can outlast, so a `401` triggers one
token refresh and a retry of the failed request. If the retry still returns `401` the
credential itself is at fault and the run aborts rather than reporting partial data.

## Run

```bash
npm start          # or: node src/main.js
```

Writes `jira-role-audit.html` (override with `OUTPUT_FILE=path npm start`). Open it in
a browser: overview table (Name, E-Mail, Anzahl Bereiche) with search/sort, click a
row for the per-user detail view (Projekt, Key, Rolle, Zugriffsweg).

## Test

```bash
npm test
```
