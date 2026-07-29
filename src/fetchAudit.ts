import type { AuditData, RawAssignment } from './auditTypes';
import { invertAssignments } from './invert';
import { fetchAllPages, type JiraClient } from './jiraClient';

interface Project {
  id: string;
  key: string;
  name: string;
}

interface RoleActor {
  type: string;
  displayName?: string;
  actorUser?: { accountId: string };
  actorGroup?: { name?: string; displayName?: string; groupId: string };
}

interface RoleDetail {
  actors?: RoleActor[];
}

interface GroupMember {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
}

interface UserDetail {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
}

export interface AuditResult {
  data: AuditData;
  warnings: string[];
}

export async function buildAudit(
  client: JiraClient,
  baseUrl: string,
  opts: { now?: () => Date } = {},
): Promise<AuditResult> {
  const now = opts.now ?? (() => new Date());
  const warnings: string[] = [];
  const raws: RawAssignment[] = [];

  const groupCache = new Map<string, GroupMember[]>();
  const userCache = new Map<string, UserDetail>();

  async function resolveGroup(groupId: string): Promise<GroupMember[]> {
    const cached = groupCache.get(groupId);
    if (cached) return cached;
    const members = await fetchAllPages<GroupMember>(
      client,
      (startAt) =>
        `/rest/api/3/group/member?groupId=${encodeURIComponent(groupId)}&startAt=${startAt}&includeInactiveUsers=true`,
    );
    groupCache.set(groupId, members);
    return members;
  }

  async function resolveUser(accountId: string, fallbackName: string): Promise<UserDetail> {
    const cached = userCache.get(accountId);
    if (cached) return cached;
    let detail: UserDetail;
    try {
      detail = await client.getJson<UserDetail>(`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`);
    } catch (err) {
      warnings.push(`User ${accountId}: ${(err as Error).message}`);
      detail = { accountId, displayName: fallbackName, emailAddress: null };
    }
    userCache.set(accountId, detail);
    return detail;
  }

  const projects = await fetchAllPages<Project>(
    client,
    (startAt) => `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`,
  );

  for (const project of projects) {
    let roleMap: Record<string, string>;
    try {
      roleMap = await client.getJson<Record<string, string>>(
        `/rest/api/3/project/${encodeURIComponent(project.key)}/role`,
      );
    } catch (err) {
      warnings.push(`Project ${project.key} roles: ${(err as Error).message}`);
      continue;
    }

    for (const [roleName, roleUrl] of Object.entries(roleMap)) {
      let roleDetail: RoleDetail;
      try {
        roleDetail = await client.getJson<RoleDetail>(roleUrl);
      } catch (err) {
        warnings.push(`Project ${project.key} role ${roleName}: ${(err as Error).message}`);
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
            warnings.push(`Project ${project.key} role ${roleName} group ${groupName}: ${(err as Error).message}`);
          } else {
            const actorLabel = actor.actorUser?.accountId ?? actor.displayName ?? 'unknown actor';
            warnings.push(`Project ${project.key} role ${roleName} actor ${actorLabel}: ${(err as Error).message}`);
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
