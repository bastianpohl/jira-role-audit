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

/**
 * The report lists real names and e-mail addresses, so it must never be committed.
 * .gitignore covers `*.html` and `out/`; anything else is the user's own path and
 * worth flagging out loud rather than trusting.
 * @param {string} outPath
 */
function warnIfNotGitIgnored(outPath) {
  const covered = outPath.endsWith('.html') || /^(\.\/)?out\//.test(outPath);
  if (covered) return;
  console.warn(
    `\nWARNING: ${outPath} matches neither *.html nor out/ in .gitignore. The report ` +
      'contains real names and e-mail addresses — make sure it does not get committed.',
  );
}

async function main() {
  const config = loadConfig();

  const client = await createAuthenticatedClient(config);

  const identity = config.auth === 'basic' ? config.email : 'service account (OAuth)';

  if (config.excludeProjects.length > 0) {
    console.log(`Excluding ${config.excludeProjects.length} project(s): ${config.excludeProjects.join(', ')}`);
  }

  console.log(`Fetching Jira audit data from ${config.baseUrl} …`);
  const { data, warnings } = await buildAudit(client, config.baseUrl, {
    identity,
    excludeProjects: config.excludeProjects,
  });

  const outPath = process.env.OUTPUT_FILE ?? 'jira-role-audit.html';
  warnIfNotGitIgnored(outPath);
  await writeFile(outPath, renderHtml(data), 'utf8');

  console.log(`Wrote ${outPath} — ${data.users.length} users across their Bereiche.`);

  const { coverage } = data;
  if (coverage && !coverage.noKnownGaps) {
    // Stated as a headline, not buried under the warning list: an audit that is
    // quietly partial is worse than one that admits it.
    console.warn(
      `\nINCOMPLETE: ${coverage.projectsAudited} of ${coverage.projectsVisible} visible projects ` +
        `were read fully (${coverage.skippedProjects.length} skipped, ` +
        `${coverage.partialProjects.length} partial). The report says so too.`,
    );
  }

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
});
