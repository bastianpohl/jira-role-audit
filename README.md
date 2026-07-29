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
