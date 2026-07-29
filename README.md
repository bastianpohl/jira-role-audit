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
   your account **→ Create OAuth 2.0 credential**. Grant it the Jira scopes
   `read:jira-work` and `read:jira-user`, and give the account access to the Jira site.
   Copy the client id and secret — the secret is shown only once.
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

### How authentication works

The tool exchanges the client credentials for an access token at
`https://auth.atlassian.com/oauth/token` (`grant_type=client_credentials`), resolves the
site's `cloudId`, and calls the Jira REST API through the gateway at
`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` with a bearer token. Tokens
are valid for 60 minutes — one token is fetched per run.

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
