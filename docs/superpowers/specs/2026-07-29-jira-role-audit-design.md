# Jira Cloud Rollen-/Bereichs-Report — Design

**Datum:** 2026-07-29
**Status:** Entwurf zur Review

## Ziel

Ein Tool, das transparent macht, **welche User mit welchen Rollen in welchen Bereichen (Jira-Projekten)** hinterlegt sind. Ausgabe ist ein **statischer, in sich geschlossener HTML-Report** mit zwei Ansichten:

1. **Übersicht** – alle User mit **Name, E-Mail, Anzahl Bereiche**.
2. **Detail** – pro User die Bereiche detailliert: **Projekt (Name + Key), Rolle(n), Zugriffsweg (direkt vs. über Gruppe)**.

## Fachliches Modell (Jira Cloud)

- Rollen hängen an **Projekten** (Project Roles: z.B. *Administrator*, *Member*, *Viewer*).
- Ein „Bereich" = ein **Jira-Projekt**.
- Mitglieder einer Rolle heißen **Actors** und können **User oder Gruppen** sein.
- Die Jira-API kann **nicht** „Rollen pro User" liefern. Man muss über alle Projekte iterieren
  → pro Projekt die Rollen → pro Rolle die Actors holen → und das Ergebnis **invertieren**.
- **Gruppen-Actors werden aufgelöst** in ihre Mitglieder-User, damit jeder tatsächliche User im
  Report erscheint. Der Zugriffsweg (direkt vs. über Gruppe X) wird pro Zuordnung festgehalten.

## Tech-Stack

- **Node.js** mit **TypeScript**, direkt ausgeführt über `tsx` (kein separater Build-Schritt).
- HTTP über die native `fetch`-API (Node ≥ 18).
- Templating: leichtes Template-Literal / kleine Render-Funktion — **kein** schweres Framework.
- **Auth:** Service-User + API-Token → HTTP Basic Auth (`email:token`, base64-kodiert).
- **Config:** `.env` mit `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, geladen via `dotenv`.
  - `.env.example` als Vorlage im Repo, echte `.env` in `.gitignore`.

## Jira Cloud REST API (v3)

| Zweck | Endpoint | Hinweise |
|-------|----------|----------|
| Alle Projekte | `GET /rest/api/3/project/search` | paginiert (`startAt`, `maxResults`, `isLast`) |
| Rollen eines Projekts | `GET /rest/api/3/project/{projectIdOrKey}/role` | Map: Rollenname → Rollen-URL (enthält Rollen-ID) |
| Actors einer Rolle | `GET /rest/api/3/project/{projectIdOrKey}/role/{id}` | `actors[]` mit `type` = `atlassian-user-role-actor` \| `atlassian-group-role-actor` |
| Gruppenmitglieder | `GET /rest/api/3/group/member?groupId={id}` | paginiert; liefert User (accountId, displayName, emailAddress) |

- Basis-URL: `https://<org>.atlassian.net`.
- **Berechtigung:** Der Service-User braucht *Administer Jira* (bzw. mindestens Browse-Rechte auf
  alle relevanten Projekte). Fehlende Rechte ⇒ fehlende Bereiche. Wird im README dokumentiert.
- **Privacy-Hinweis:** `emailAddress` kann je nach Account-Sichtbarkeit fehlen → im Report „—".

## Architektur / Module

Klar getrennte, einzeln testbare Einheiten:

- **`config`** – lädt & validiert `.env`, baut Basis-URL und Auth-Header. Fehlt etwas → klare Fehlermeldung.
- **`jiraClient`** – dünner HTTP-Wrapper: Basic-Auth, Pagination-Helper, **429-Retry mit Backoff**
  (`Retry-After` beachten), einheitliche Fehlerbehandlung. Kennt die konkreten Endpoints nicht.
- **`fetchAudit`** – Business-Logik: nutzt `jiraClient`, um Projekte → Rollen → Actors zu laden,
  Gruppen aufzulösen (mit **Cache**, jede Gruppe nur einmal abfragen) und die Daten zu **invertieren**.
  Liefert eine reine Datenstruktur `AuditData` (keine HTML-Kenntnis).
- **`render`** – nimmt `AuditData` und erzeugt den finalen HTML-String (Übersicht + Detail als
  eingebettetes JSON + kleines JS zum Umschalten). Kein Netzwerkzugriff.
- **`main`** – verdrahtet alles, schreibt die HTML-Datei, gibt Fortschritt/Fehler aus.

### Datenstruktur (Kern)

```ts
type AccessVia =
  | { kind: "direct" }
  | { kind: "group"; groupName: string };

interface Assignment {
  projectKey: string;
  projectName: string;
  roleName: string;
  via: AccessVia;
}

interface AuditUser {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  assignments: Assignment[];      // eine Zeile pro (Projekt, Rolle, Zugriffsweg)
  areaCount: number;              // Anzahl distinct Projekte
}

interface AuditData {
  generatedAt: string;
  baseUrl: string;
  users: AuditUser[];
}
```

## Report-Struktur (Single-File HTML)

- Eine `.html`-Datei mit eingebettetem `AuditData`-JSON und minimalem Vanilla-JS.
- **Übersicht:** sortier- und durchsuchbare Tabelle (Name, E-Mail, Anzahl Bereiche). Klick auf
  Zeile → Detail.
- **Detail:** pro User Tabelle der Zuordnungen (Projekt, Rolle, Zugriffsweg), plus Zurück-Link.
- Funktioniert offline per Doppelklick; nichts wird nachgeladen.

## Best Practices / Robustheit

- Konsequente **Pagination** (Projekte, Gruppenmitglieder).
- **Rate-Limiting:** Retry mit exponentiellem Backoff bei HTTP 429, `Retry-After` respektieren.
- **Fehlertoleranz:** Ein fehlgeschlagenes Projekt/Rolle bricht den Report nicht ab, sondern wird
  gesammelt und am Ende als Warnung ausgegeben.
- **Gruppen-Cache:** identische Gruppen werden nur einmal aufgelöst.
- Secrets nie ins Repo; `.env` in `.gitignore`, `.env.example` als Doku.

## Tests (TDD)

Unit-Tests gegen **gemockte** API-Responses für die risikoreiche Logik:

- **Pagination-Helper** (mehrseitige Antworten, `isLast`/`startAt`).
- **Invertierung** (Projekt→Rolle→User ⇒ User→Assignments, distinct-Bereichszählung).
- **Gruppenauflösung** (Gruppen-Actor ⇒ Mitglieder, Cache verhindert Doppelabfrage,
  User in mehreren Rollen/Projekten).
- **429-Retry**-Verhalten des `jiraClient`.

## Nicht im Scope (YAGNI)

- Keine Live-/Server-App, kein Auto-Refresh — bewusst statischer Report.
- Keine Confluence-Spaces.
- Keine globalen Permission-Schemes/Permission-Auflösung — nur Project-Role-Zuordnungen.
