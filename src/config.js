import 'dotenv/config';

/**
 * @typedef {object} Config
 * @property {'basic'|'oauth'} auth  Which credential the run authenticates with.
 * @property {string} baseUrl      Jira site URL, trailing slashes stripped.
 * @property {string} [email]      Atlassian account e-mail (auth === 'basic').
 * @property {string} [apiToken]   API token for that account (auth === 'basic').
 * @property {string} [clientId]     OAuth 2.0 client id of the service account (auth === 'oauth').
 * @property {string} [clientSecret] OAuth 2.0 client secret of the service account (auth === 'oauth').
 * @property {string|null} cloudId Optional override; resolved from baseUrl when null. OAuth only.
 */

/**
 * Decide which credential to use.
 *
 * JIRA_AUTH wins when set. Otherwise the mode is inferred from whichever
 * credential is present — but configuring *both* is an error rather than a
 * silent preference: the report's contents depend on the acting identity's
 * permissions, so guessing could quietly produce a different audit than intended.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ mode: 'basic'|'oauth', anyCredential: boolean }}
 */
function resolveAuthMode(env) {
  const anyBasic = Boolean(env.JIRA_EMAIL || env.JIRA_API_TOKEN);
  const anyOauth = Boolean(env.JIRA_CLIENT_ID || env.JIRA_CLIENT_SECRET);

  const requested = env.JIRA_AUTH?.trim().toLowerCase();
  if (requested) {
    if (requested !== 'basic' && requested !== 'oauth') {
      throw new Error(`JIRA_AUTH must be either "basic" or "oauth" (got "${env.JIRA_AUTH}").`);
    }
    return { mode: requested, anyCredential: anyBasic || anyOauth };
  }

  if (anyBasic && anyOauth) {
    throw new Error(
      'Both API token credentials (JIRA_EMAIL, JIRA_API_TOKEN) and service account OAuth ' +
        'credentials (JIRA_CLIENT_ID, JIRA_CLIENT_SECRET) are set. Set JIRA_AUTH=basic or ' +
        'JIRA_AUTH=oauth to state which identity should generate the report.',
    );
  }

  if (anyBasic) return { mode: 'basic', anyCredential: true };
  // Defaults to oauth so a completely empty environment reports the service
  // account vars as missing, with a hint about the API token alternative.
  return { mode: 'oauth', anyCredential: anyOauth };
}

/**
 * Load and validate the Jira config from the environment.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const { mode, anyCredential } = resolveAuthMode(env);

  const baseUrlRaw = env.JIRA_BASE_URL;
  const missing = [];
  if (!baseUrlRaw) missing.push('JIRA_BASE_URL');

  if (mode === 'basic') {
    if (!env.JIRA_EMAIL) missing.push('JIRA_EMAIL');
    if (!env.JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
  } else {
    if (!env.JIRA_CLIENT_ID) missing.push('JIRA_CLIENT_ID');
    if (!env.JIRA_CLIENT_SECRET) missing.push('JIRA_CLIENT_SECRET');
  }

  if (missing.length > 0) {
    const hint = anyCredential
      ? ''
      : ' (alternatively authenticate as your own user with JIRA_EMAIL + JIRA_API_TOKEN)';
    throw new Error(`Missing required env vars: ${missing.join(', ')}${hint}`);
  }

  const baseUrl = baseUrlRaw.replace(/\/+$/, '');

  if (mode === 'basic') {
    return {
      auth: 'basic',
      baseUrl,
      email: env.JIRA_EMAIL,
      apiToken: env.JIRA_API_TOKEN,
      cloudId: env.JIRA_CLOUD_ID || null,
    };
  }

  return {
    auth: 'oauth',
    baseUrl,
    clientId: env.JIRA_CLIENT_ID,
    clientSecret: env.JIRA_CLIENT_SECRET,
    cloudId: env.JIRA_CLOUD_ID || null,
  };
}
