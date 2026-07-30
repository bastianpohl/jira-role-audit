import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { resolveOutputPath, validateOutputPath, describeWriteError } from './outputPath.js';
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
  // Accept both separators: on Windows the same path arrives as `out\report.txt`.
  const covered = outPath.endsWith('.html') || /^(\.[\\/])?out[\\/]/.test(outPath);
  if (covered) return;
  console.warn(
    `\nWARNING: ${outPath} matches neither *.html nor out/ in .gitignore. The report ` +
      'contains real names and e-mail addresses — make sure it does not get committed.',
  );
}

/**
 * A failure the user can fix from the message alone — no stack trace needed.
 * @param {string} message
 */
function userError(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    throw userError(err.message);
  }

  // Resolved before any API call: a bad OUTPUT_FILE should fail in a second, not
  // after a full audit has already been fetched.
  const outPath = resolveOutputPath(process.env.OUTPUT_FILE) || 'jira-role-audit.html';
  const pathProblem = validateOutputPath(outPath);
  if (pathProblem) throw userError(pathProblem);
  warnIfNotGitIgnored(outPath);

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

  let html;
  try {
    html = renderHtml(data);
  } catch (err) {
    // The whole report is built as one string. On a very large site that can hit
    // V8's string cap — ~512 MB on 64-bit, but only ~256 MB on a 32-bit Node,
    // which is still a normal install on Windows and does not exist on macOS.
    if (err instanceof RangeError) {
      throw userError(
        `The report is too large to build as a single HTML string (${data.users.length} users). ` +
          `Node ${process.version} (${process.arch}) — a 32-bit Node hits this far sooner, so install ` +
          'the 64-bit build, or narrow the run with JIRA_EXCLUDE_PROJECTS.',
      );
    }
    throw err;
  }

  try {
    // The docs point at out/, so create the folder rather than failing on ENOENT.
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(outPath, html, 'utf8');
  } catch (err) {
    throw userError(describeWriteError(err, outPath));
  }

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
  // Report enough to diagnose without a debugger: a bare message plus a silent
  // exit code is what makes a failure look like a crash.
  if (err instanceof Error) {
    console.error(`Failed: ${err.message}${err.code ? ` (${err.code})` : ''}`);
    if (!err.expected && err.stack) console.error(err.stack);
  } else {
    console.error('Failed with a non-Error value:', err);
  }
  process.exitCode = 1;
});

// An out-of-memory abort cannot be caught, but these two can, and they otherwise
// terminate the process with no explanation at all.
process.on('unhandledRejection', (reason) => {
  console.error('Failed: unhandled rejection —', reason);
  process.exitCode = 1;
});
process.on('uncaughtException', (err) => {
  console.error('Failed: uncaught exception —', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
