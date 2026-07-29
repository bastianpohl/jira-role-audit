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
 * @property {Assignment[]} assignments
 * @property {number} areaCount
 *
 * @typedef {object} AuditData
 * @property {string} generatedAt
 * @property {string} baseUrl
 * @property {AuditUser[]} users
 */

/**
 * Invert per-(project, role, user) records into a user-centric view.
 * @param {RawAssignment[]} raws
 * @param {{ generatedAt: string, baseUrl: string }} meta
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
