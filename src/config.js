import 'dotenv/config';

/**
 * @typedef {object} Config
 * @property {string} baseUrl    Jira base URL, trailing slashes stripped.
 * @property {string} email      Service user email.
 * @property {string} apiToken   API token.
 * @property {string} authHeader Ready-to-use `Basic <base64>` header value.
 */

/**
 * Load and validate the Jira config from the environment.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const baseUrlRaw = env.JIRA_BASE_URL;
  const email = env.JIRA_EMAIL;
  const apiToken = env.JIRA_API_TOKEN;

  const missing = [];
  if (!baseUrlRaw) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!apiToken) missing.push('JIRA_API_TOKEN');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const baseUrl = baseUrlRaw.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  return { baseUrl, email, apiToken, authHeader };
}
