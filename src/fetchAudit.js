import { invertAssignments } from './invert.js';
import { fetchAllPages } from './jiraClient.js';

/**
 * @typedef {object} AuditResult
 * @property {import('./invert.js').AuditData} data
 * @property {string[]} warnings
 */

/**
 * Record that a project could not be read completely.
 * Kept structured (rather than only as a warning string) so the report can state
 * plainly that it is incomplete instead of leaving it to stderr.
 * @param {Map<string, import('./invert.js').ProjectGap>} into
 * @param {{ key: string, name: string }} project
 * @param {string} reason
 */
function noteGap(into, project, reason) {
  const existing = into.get(project.key);
  if (existing) {
    existing.reasons.push(reason);
    return;
  }
  into.set(project.key, { key: project.key, name: project.name, reasons: [reason] });
}

/**
 * Jira returns role URLs pointing at the site (…atlassian.net/…/role/10), which an
 * OAuth bearer token cannot call — those requests must go through the api.atlassian.com
 * gateway. Extract the role id so we can build a relative path the client resolves
 * against the gateway base URL.
 * @param {string} roleUrl
 * @returns {string|null}
 */
function roleIdFromUrl(roleUrl) {
  const match = /\/role\/(\d+)\/?$/.exec(String(roleUrl ?? ''));
  return match ? match[1] : null;
}

/**
 * Fetch projects -> roles -> actors from Jira, resolve group/user actors
 * (with caching, warn-and-continue on failures), and invert to a user view.
 * @param {import('./jiraClient.js').JiraClient} client
 * @param {string} baseUrl
 * @param {{ now?: () => Date, identity?: string|null }} [opts]
 * @returns {Promise<AuditResult>}
 */
export async function buildAudit(client, baseUrl, opts = {}) {
  const now = opts.now ?? (() => new Date());
  const warnings = [];
  const raws = [];
  /** Projects whose role list could not be read at all. @type {Map<string, any>} */
  const skipped = new Map();
  /** Projects read, but with at least one role or actor missing. @type {Map<string, any>} */
  const partial = new Map();

  const groupCache = new Map();
  const userCache = new Map();

  async function resolveGroup(groupId) {
    const cached = groupCache.get(groupId);
    if (cached) return cached;
    const members = await fetchAllPages(
      client,
      (startAt) =>
        `/rest/api/3/group/member?groupId=${encodeURIComponent(groupId)}&startAt=${startAt}&includeInactiveUsers=true`,
    );
    groupCache.set(groupId, members);
    return members;
  }

  async function resolveUser(accountId, fallbackName) {
    const cached = userCache.get(accountId);
    if (cached) return cached;
    let detail;
    try {
      detail = await client.getJson(`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`);
    } catch (err) {
      if (err.fatal) throw err;
      warnings.push(`User ${accountId}: ${err.message}`);
      detail = { accountId, displayName: fallbackName, emailAddress: null };
    }
    userCache.set(accountId, detail);
    return detail;
  }

  const projects = await fetchAllPages(
    client,
    (startAt) => `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`,
  );

  for (const project of projects) {
    let roleMap;
    try {
      roleMap = await client.getJson(`/rest/api/3/project/${encodeURIComponent(project.key)}/role`);
    } catch (err) {
      if (err.fatal) throw err;
      warnings.push(`Project ${project.key} roles: ${err.message}`);
      noteGap(skipped, project, `role list unreadable: ${err.message}`);
      continue;
    }

    for (const [roleName, roleUrl] of Object.entries(roleMap)) {
      const roleId = roleIdFromUrl(roleUrl);
      if (!roleId) {
        warnings.push(`Project ${project.key} role ${roleName}: could not parse role id from ${roleUrl}`);
        noteGap(partial, project, `role ${roleName}: unparseable role id`);
        continue;
      }

      let roleDetail;
      try {
        roleDetail = await client.getJson(
          `/rest/api/3/project/${encodeURIComponent(project.key)}/role/${roleId}`,
        );
      } catch (err) {
        if (err.fatal) throw err;
        warnings.push(`Project ${project.key} role ${roleName}: ${err.message}`);
        noteGap(partial, project, `role ${roleName}: ${err.message}`);
        continue;
      }

      for (const actor of roleDetail.actors ?? []) {
        try {
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
          } else {
            warnings.push(`Project ${project.key} role ${roleName}: unhandled actor type ${actor.type}`);
            // An actor we cannot interpret is an assignment missing from the report.
            noteGap(partial, project, `role ${roleName}: unhandled actor type ${actor.type}`);
          }
        } catch (err) {
          if (err.fatal) throw err;
          if (actor.actorGroup) {
            const groupName = actor.actorGroup.displayName ?? actor.actorGroup.name ?? actor.actorGroup.groupId;
            warnings.push(`Project ${project.key} role ${roleName} group ${groupName}: ${err.message}`);
            noteGap(partial, project, `role ${roleName}, group ${groupName}: ${err.message}`);
          } else {
            const actorLabel = actor.actorUser?.accountId ?? actor.displayName ?? 'unknown actor';
            warnings.push(`Project ${project.key} role ${roleName} actor ${actorLabel}: ${err.message}`);
            noteGap(partial, project, `role ${roleName}, actor ${actorLabel}: ${err.message}`);
          }
        }
      }
    }
  }

  const skippedProjects = [...skipped.values()];
  const partialProjects = [...partial.values()];

  const data = invertAssignments(raws, {
    generatedAt: now().toISOString(),
    baseUrl,
    identity: opts.identity ?? null,
    coverage: {
      projectsVisible: projects.length,
      projectsAudited: projects.length - skippedProjects.length,
      skippedProjects,
      partialProjects,
      warningCount: warnings.length,
      // Only covers gaps we can *see*. Projects the account cannot browse never
      // appear in /project/search at all, so they can never be counted here —
      // which is exactly why the report always states whose view it reflects.
      noKnownGaps: skippedProjects.length === 0 && partialProjects.length === 0,
    },
  });
  return { data, warnings };
}
