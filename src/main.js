import { writeFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { fetchAccessToken, resolveCloudId, apiBaseUrlFor } from './auth.js';
import { createJiraClient } from './jiraClient.js';
import { buildAudit } from './fetchAudit.js';
import { renderHtml } from './render.js';

async function main() {
  const config = loadConfig();

  console.log('Authenticating service account (OAuth 2.0 client credentials) …');
  const accessToken = await fetchAccessToken(config);
  const cloudId = await resolveCloudId(config, accessToken);

  const client = createJiraClient(
    { apiBaseUrl: apiBaseUrlFor(cloudId), accessToken },
    // Audits of large sites can outlive the 60-minute token; re-mint it on demand.
    { refreshAccessToken: () => fetchAccessToken(config) },
  );

  console.log(`Fetching Jira audit data from ${config.baseUrl} (cloudId ${cloudId}) …`);
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
