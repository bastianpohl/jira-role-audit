/**
 * Shared audit data model (documented as JSDoc typedefs — no runtime code).
 *
 * @typedef {{ kind: 'direct' } | { kind: 'group', groupName: string }} AccessVia
 *
 * @typedef {object} RawAssignment
 * @property {string} projectKey
 * @property {string} projectName
 * @property {string} roleName
 * @property {string} accountId
 * @property {string} displayName
 * @property {string|null} emailAddress
 * @property {boolean|null} [active]
 * @property {AccessVia} via
 *
 * @typedef {object} Assignment
 * @property {string} projectKey
 * @property {string} projectName
 * @property {string} roleName
 * @property {AccessVia} via
 *
 * @typedef {object} AuditUser
 * @property {string} accountId
 * @property {string} displayName
 * @property {string|null} emailAddress
 * @property {boolean|null} active  null when the status could not be determined.
 * @property {Assignment[]} assignments
 * @property {number} areaCount
 * @property {string[]} groups  Groups granting this user a role, sorted. Not the
 *   user's full group membership — only groups seen as role actors.
 * @property {string[]} roles  Distinct role names this user holds anywhere, sorted.
 *
 * @typedef {object} ProjectGap
 * @property {string} key
 * @property {string} name
 * @property {string[]} reasons
 *
 * @typedef {object} Coverage
 * @property {number} projectsVisible  Projects returned by /project/search.
 * @property {number} projectsAudited  Of those, the ones whose roles were readable.
 * @property {ProjectGap[]} skippedProjects  Role list unreadable — no data at all.
 * @property {ProjectGap[]} partialProjects  Some roles or actors missing.
 * @property {{ key: string, name: string }[]} [excludedProjects]  Left out on purpose.
 * @property {string[]} [unmatchedExclusions]  Configured exclusions that matched nothing.
 * @property {number} warningCount
 * @property {boolean} noKnownGaps  No *detectable* gaps; projects the account cannot
 *   browse are invisible to /project/search and therefore never counted.
 *
 * @typedef {object} AuditData
 * @property {string} generatedAt
 * @property {string} baseUrl
 * @property {string|null} [identity]  Which account's view this report reflects.
 * @property {Coverage} [coverage]
 * @property {AuditUser[]} users
 */

/**
 * Invert per-(project, role, user) records into a user-centric view.
 * @param {RawAssignment[]} raws
 * @param {{ generatedAt: string, baseUrl: string, identity?: string|null, coverage?: Coverage }} meta
 * @returns {AuditData}
 */
export function invertAssignments(raws, meta) {
  const byUser = new Map();

  for (const r of raws) {
    let user = byUser.get(r.accountId);
    if (!user) {
      user = {
        accountId: r.accountId,
        displayName: r.displayName,
        emailAddress: r.emailAddress,
        active: r.active ?? null,
        assignments: [],
        areaCount: 0,
        groups: [],
        roles: [],
      };
      byUser.set(r.accountId, user);
    }
    // Prefer a non-null email if a later record has one.
    if (user.emailAddress === null && r.emailAddress !== null) {
      user.emailAddress = r.emailAddress;
    }
    // Same for the status: the first record that actually knows it wins.
    if (user.active === null && (r.active ?? null) !== null) {
      user.active = r.active;
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
    user.groups = [
      ...new Set(
        user.assignments.filter((a) => a.via.kind === 'group').map((a) => a.via.groupName),
      ),
    ].sort((a, b) => a.localeCompare(b));
    user.roles = [...new Set(user.assignments.map((a) => a.roleName))].sort((a, b) =>
      a.localeCompare(b),
    );
    user.assignments.sort(
      (a, b) => a.projectName.localeCompare(b.projectName) || a.roleName.localeCompare(b.roleName),
    );
  }

  const users = [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    generatedAt: meta.generatedAt,
    baseUrl: meta.baseUrl,
    identity: meta.identity ?? null,
    coverage: meta.coverage ?? null,
    users,
  };
}
