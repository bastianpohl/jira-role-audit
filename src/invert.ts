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
