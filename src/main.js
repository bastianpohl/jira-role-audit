import { writeFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { fetchAccessToken, resolveCloudId, apiBaseUrlFor, basicAuthHeader } from './auth.js';
import { createJiraClient } from './jiraClient.js';
import { buildAudit } from './fetchAudit.js';
import { renderHtml } from './render.js';

/**
 * Authenticate per the configured mode and return a ready Jira client.
 * @param {import('./config.js').Config} config
 * @returns {Promise<import('./jiraClient.js').JiraClient>}
 */
async function createAuthenticatedClient(config) {
  if (config.auth === 'basic') {
    console.log(`Authenticating as ${config.email} (API token) …`);
    // API tokens do not expire, so no refresh callback: a 401 here can only mean
    // the token is wrong or revoked, and failing fast is the right answer.
    return createJiraClient({
      apiBaseUrl: config.baseUrl,
      authHeader: basicAuthHeader(config.email, config.apiToken),
    });
  }

  console.log('Authenticating service account (OAuth 2.0 client credentials) …');
  const accessToken = await fetchAccessToken(config);
  const cloudId = await resolveCloudId(config, accessToken);

  return createJiraClient(
    { apiBaseUrl: apiBaseUrlFor(cloudId), authHeader: `Bearer ${accessToken}` },
    // Audits of large sites can outlive the 60-minute token; re-mint it on demand.
    { refreshAuthHeader: async () => `Bearer ${await fetchAccessToken(config)}` },
  );
}

async function main() {
  const config = loadConfig();

  const client = await createAuthenticatedClient(config);

  console.log(`Fetching Jira audit data from ${config.baseUrl} …`);
  const { data, warnings } = await buildAudit(client, config.baseUrl);

  const outPath = process.env.OUTPUT_FILE ?? 'jira-role-audit.html';
  await writeFile(outPath, renderHtml(data), 'utf8');

  console.log(`Wrote ${outPath} — ${data.users.length} users across their Bereiche.`);
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
});
