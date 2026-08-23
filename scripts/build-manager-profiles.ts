import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildManagerProfiles } from '../src/services/manager-profile-builder.js';
import { loadHistoricalPicks, loadSeasonAdpIndex } from '../src/services/draft-data-store.js';

/**
 * Generate the manager profile set from historical drafts and cached ADP.
 *
 * @param options - Directories and ADP feed settings.
 * @returns Output path and headline counts.
 */
export async function buildProfilesToDisk(options: {
  dataDirectory?: string;
  historicalDirectory?: string;
  format?: string;
  teams?: number;
} = {}): Promise<{ outputFile: string; managers: number; picks: number; matched: number }> {
  const picks = await loadHistoricalPicks(options);
  if (picks.length === 0) {
    throw new Error('No historical picks found. Check the historical-draft-data directory.');
  }

  const seasons = [...new Set(picks.map((pick) => pick.season))].sort((left, right) => left - right);
  const adpBySeason = await loadSeasonAdpIndex(seasons, options);
  const profiles = buildManagerProfiles({ picks, adpBySeason });

  const dataDirectory = options.dataDirectory ?? join(process.cwd(), 'data');
  await mkdir(dataDirectory, { recursive: true });
  const outputFile = join(dataDirectory, 'manager-profiles.json');
  await writeFile(outputFile, JSON.stringify(profiles, null, 2), 'utf8');

  const matched = profiles.managers.reduce((sum, manager) => sum + manager.adpMatchedCount, 0);
  return { outputFile, managers: profiles.managers.length, picks: picks.length, matched };
}

const isDirectInvocation = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-manager-profiles.js');
if (isDirectInvocation) {
  const [historicalDirectory, dataDirectory] = process.argv.slice(2);
  buildProfilesToDisk({
    historicalDirectory,
    dataDirectory,
    format: process.env.ADP_FORMAT,
    teams: process.env.LEAGUE_TEAMS ? Number(process.env.LEAGUE_TEAMS) : undefined,
  })
    .then((result) => {
      console.log(`Wrote ${result.managers} manager profiles to ${result.outputFile}.`);
      console.log(`Historical picks: ${result.picks}. Joined to ADP: ${result.matched} (${((100 * result.matched) / result.picks).toFixed(1)}%).`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown failure.';
      console.error(`Profile build failed: ${message}`);
      process.exitCode = 1;
    });
}
