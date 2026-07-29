import { writeFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createJiraClient } from './jiraClient.js';
import { buildAudit } from './fetchAudit.js';
import { renderHtml } from './render.js';

async function main() {
  const config = loadConfig();
  const client = createJiraClient(config);

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
