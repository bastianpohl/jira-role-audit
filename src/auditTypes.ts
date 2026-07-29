export type AccessVia = { kind: 'direct' } | { kind: 'group'; groupName: string };

export interface RawAssignment {
  projectKey: string;
  projectName: string;
  roleName: string;
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  via: AccessVia;
}

export interface Assignment {
  projectKey: string;
  projectName: string;
  roleName: string;
  via: AccessVia;
}

export interface AuditUser {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  assignments: Assignment[];
  areaCount: number;
}

export interface AuditData {
  generatedAt: string;
  baseUrl: string;
  users: AuditUser[];
}
