import { invertAssignments } from './invert.js';
import { fetchAllPages } from './jiraClient.js';

/**
 * @typedef {object} AuditResult
 * @property {import('./invert.js').AuditData} data
 * @property {string[]} warnings
 */

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
 * @param {{ now?: () => Date }} [opts]
 * @returns {Promise<AuditResult>}
 */
export async function buildAudit(client, baseUrl, opts = {}) {
  const now = opts.now ?? (() => new Date());
  const warnings = [];
  const raws = [];

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
      warnings.push(`Project ${project.key} roles: ${err.message}`);
      continue;
    }

    for (const [roleName, roleUrl] of Object.entries(roleMap)) {
      const roleId = roleIdFromUrl(roleUrl);
      if (!roleId) {
        warnings.push(`Project ${project.key} role ${roleName}: could not parse role id from ${roleUrl}`);
        continue;
      }

      let roleDetail;
      try {
        roleDetail = await client.getJson(
          `/rest/api/3/project/${encodeURIComponent(project.key)}/role/${roleId}`,
        );
      } catch (err) {
        warnings.push(`Project ${project.key} role ${roleName}: ${err.message}`);
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
          }
        } catch (err) {
          if (actor.actorGroup) {
            const groupName = actor.actorGroup.displayName ?? actor.actorGroup.name ?? actor.actorGroup.groupId;
            warnings.push(`Project ${project.key} role ${roleName} group ${groupName}: ${err.message}`);
          } else {
            const actorLabel = actor.actorUser?.accountId ?? actor.displayName ?? 'unknown actor';
            warnings.push(`Project ${project.key} role ${roleName} actor ${actorLabel}: ${err.message}`);
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
