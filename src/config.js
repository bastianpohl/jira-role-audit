import 'dotenv/config';

/**
 * @typedef {object} Config
 * @property {string} baseUrl      Jira site URL, trailing slashes stripped.
 * @property {string} clientId     OAuth 2.0 client id of the service account.
 * @property {string} clientSecret OAuth 2.0 client secret of the service account.
 * @property {string|null} cloudId Optional override; resolved from baseUrl when null.
 */

/**
 * Load and validate the Jira service-account config from the environment.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const baseUrlRaw = env.JIRA_BASE_URL;
  const clientId = env.JIRA_CLIENT_ID;
  const clientSecret = env.JIRA_CLIENT_SECRET;

  const missing = [];
  if (!baseUrlRaw) missing.push('JIRA_BASE_URL');
  if (!clientId) missing.push('JIRA_CLIENT_ID');
  if (!clientSecret) missing.push('JIRA_CLIENT_SECRET');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    baseUrl: baseUrlRaw.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    cloudId: env.JIRA_CLOUD_ID || null,
  };
}
