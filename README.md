# Jira Role/Area Audit Report

Generates a single self-contained HTML report showing which Jira Cloud users hold
which project roles in which projects ("Bereiche"). Group role members are resolved
into individual users.

Plain Node.js (JavaScript, ES modules) — no build step, run directly with `node`.

## Requirements

- Node ≥ 18 (uses the built-in global `fetch`)
- Credentials for an account that can see every project you want audited —
  missing permissions mean missing Bereiche in the report. Either your own
  Atlassian account (API token) or a service account (OAuth); see below.

## Authentication

Two alternatives — pick one:

| | **A: API token** | **B: Service account OAuth** |
| --- | --- | --- |
| Identity | your own user | dedicated service account |
| Env vars | `JIRA_EMAIL`, `JIRA_API_TOKEN` | `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` |
| Endpoint | site URL directly | `api.atlassian.com` gateway (needs `cloudId`) |
| Scopes | none — carries your full permissions | 12 granular scopes, read-only |
| Expiry | token is long-lived | 60 min, refreshed automatically |
| Best for | one-off runs by an admin | unattended/scheduled runs |

**A is the quickest way to a complete report** if your own account is a Jira
admin — no scope wiring, no admin console. The trade-off is that an API token is
not scope-limited: it can do anything your user can, so treat it like a password
and don't park it on a shared machine. **B** is the better fit for anything
recurring, because the credential is read-only and revocable on its own.

Both are configured through `.env`. Setting both credential sets is an error
unless `JIRA_AUTH=basic|oauth` states which identity should generate the report —
the tool won't guess, since the acting identity determines what the report contains.

## Setup

```bash
npm install
cp .env.example .env   # then fill in ONE of the two credential blocks
```

For **A**, create the token at
[id.atlassian.com → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
and set `JIRA_EMAIL` + `JIRA_API_TOKEN`.

For **B**, go to [admin.atlassian.com](https://admin.atlassian.com): **Directory →
Service accounts →** your account **→ Create OAuth 2.0 credential**. Grant the scopes
listed under [Scopes and permissions](#scopes-and-permissions) and give the account
access to the Jira site. Copy the client id and secret — the secret is shown only once.

Other variables:

- `JIRA_BASE_URL` — e.g. `https://your-org.atlassian.net` (always required)
- `JIRA_CLOUD_ID` — *optional, OAuth only*; resolved from `JIRA_BASE_URL` when unset
- `JIRA_EXCLUDE_PROJECTS` — *optional*; project keys to leave out, e.g. `HR, LEGAL`

### Excluding projects

`JIRA_EXCLUDE_PROJECTS` takes comma- or space-separated project keys (case-insensitive)
and skips them entirely — their roles are never fetched. Exclusions are **named in the
report** in their own banner and left out of the project counts, so a narrowed report can
never be mistaken for a full one.

If a configured key matches no visible project, the run warns and the report says so.
That case is worth flagging: a mistyped key, or one the account cannot see, otherwise
looks exactly like a successful exclusion.

## Scopes and permissions

Scopes apply to **option B (OAuth) only** — an API token carries its user's
permissions and has no scopes. The *permission* requirements at the end of this
section apply to **both** options.

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
up only as warnings on stderr. Whichever option you pick, make sure the acting account
has *Administer Jira*, and check the warning count at the end of each run.

### How authentication works

**API token (Basic).** `Authorization: Basic base64(email:token)`, sent straight to
`https://your-org.atlassian.net/rest/api/3/...`. No `cloudId`, no gateway. The token
does not expire, so a `401` can only mean it is wrong or revoked and the run aborts
immediately.

**Service account (OAuth).** The client credentials are exchanged for an access token at
`https://auth.atlassian.com/oauth/token` (`grant_type=client_credentials`); the tool then
resolves the site's `cloudId` and calls the API through the gateway at
`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` with a bearer token. Those
tokens are valid for 60 minutes, which a large audit can outlast, so a `401` triggers one
token refresh and a retry of the failed request. If the retry still returns `401` the
credential itself is at fault and the run aborts rather than reporting partial data.

In both modes a `403` is treated as a per-project permission gap: it becomes a warning
and the audit continues, because a single inaccessible project should not void the run.

## Run

```bash
npm start          # or: node src/main.js
```

Writes `jira-role-audit.html` (override with `OUTPUT_FILE=path npm start`). Open it in
a browser:

- overview table (Name, E-Mail, Status, Anzahl Bereiche), sortable by clicking a header
- filters, all combining: name/e-mail search, a min/max range on **Anzahl Bereiche**,
  a **status** dropdown (aktiv / inaktiv / unbekannt), and **Gruppen** / **Rollen**
  buttons. Each opens a dialog with a checkbox per entry and *Alle* / *Keine*
  shortcuts; changes take effect on *Übernehmen* and are discarded on *Abbrechen*
  or Esc. The button carries a badge with the number of active entries.
  Selecting several entries in one dialog matches *any* of them, while the two
  filters combine with *and* — e.g. groups `devs`+`extern` with role
  `Administrator` finds admins coming in through either group
- below the table, how many entries are shown out of the total
- click a row for the per-user detail view (Projekt, Key, Rolle, Zugriffsweg), including
  the user's status and the groups granting them roles
- banners at the top state whose view the report reflects, and name any projects
  that could not be read fully

Two things to know about those two columns:

- **Status** comes from Jira's `active` flag. Inactive accounts that still hold roles are
  the point of showing it — they are exactly what an access review looks for. If a user
  lookup failed, the status reads *unbekannt* rather than defaulting to active.
- The **group** filter lists groups that grant a role, which is what the audit fetches.
  It is not a user's full group membership: a group that grants no project role never
  appears as a role actor and so cannot be listed here.

**The report contains real names and e-mail addresses.** `.gitignore` covers `*.html`
and `out/`; if `OUTPUT_FILE` points anywhere else, the run prints a warning, because
the file would not be ignored. Missing folders in the path are created.

### Windows notes

- On Windows, `set OUTPUT_FILE="C:\reports\audit.html"` keeps the quotes as part of the
  value, and `"` is an illegal filename character — the quotes are stripped for you.
- Names Windows rejects (`< > : " | ? *`, reserved device names like `NUL` or `CON`, and
  segments ending in a space or dot) are refused up front with an explanation, before the
  audit runs, rather than failing with a raw errno after it.
- If the write fails because the file is open in a browser tab or held by OneDrive or
  antivirus, the error says so instead of just `EPERM`.
- Use the **64-bit** Node build. The report is assembled as a single string, and a 32-bit
  Node caps strings at roughly half the size, which a large site can exceed.

## Test

```bash
npm test
```
