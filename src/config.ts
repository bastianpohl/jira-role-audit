import 'dotenv/config';

export interface Config {
  baseUrl: string;
  email: string;
  apiToken: string;
  authHeader: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrlRaw = env.JIRA_BASE_URL;
  const email = env.JIRA_EMAIL;
  const apiToken = env.JIRA_API_TOKEN;

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!apiToken) missing.push('JIRA_API_TOKEN');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const baseUrl = baseUrlRaw!.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  return { baseUrl, email: email!, apiToken: apiToken!, authHeader };
}
