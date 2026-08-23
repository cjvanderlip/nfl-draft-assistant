import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LEAGUE_TEAM_COUNT, resolveScoringFormat } from '../src/config/league.js';

const FFC_BASE_URL = 'https://fantasyfootballcalculator.com/api/v1/adp';
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

const SUPPORTED_FORMATS = new Set(['ppr', 'half-ppr', 'standard', '2qb', 'dynasty']);

interface FetchOptions {
  format: string;
  teams: number;
  currentSeason: number;
  historicalSeasons: number[];
  dataDirectory: string;
  skipSleeper: boolean;
}

function parseArgs(argv: string[]): FetchOptions {
  const format = resolveScoringFormat(process.env.ADP_FORMAT ?? argv[0]);
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new TypeError(`ADP format must be one of: ${[...SUPPORTED_FORMATS].join(', ')}.`);
  }
  const teams = Number(process.env.LEAGUE_TEAMS ?? argv[1] ?? LEAGUE_TEAM_COUNT);
  if (!Number.isInteger(teams) || teams < 4 || teams > 20) {
    throw new TypeError('LEAGUE_TEAMS must be an integer between 4 and 20.');
  }
  const currentSeason = Number(process.env.SEASON ?? argv[2] ?? new Date().getFullYear());
  return {
    format,
    teams,
    currentSeason,
    historicalSeasons: [2022, 2023, 2024, 2025].filter((season) => season < currentSeason),
    dataDirectory: process.env.DATA_DIR ?? join(process.cwd(), 'data'),
    skipSleeper: process.env.SKIP_SLEEPER === 'true',
  };
}

async function fetchJson(url: string, description: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${description} failed with HTTP ${response.status}.`);
  }
  return response.json();
}

/**
 * Download the ADP and player metadata the draft board needs, to local disk.
 *
 * A live draft is the wrong moment to discover an upstream is rate limiting, so
 * everything is cached to `data/` ahead of time and read from there on draft day.
 *
 * @param options - Format, league size, seasons, and output directory.
 * @returns Summary counts per downloaded file.
 */
export async function fetchDraftData(options: FetchOptions): Promise<Array<{ file: string; records: number }>> {
  const adpDirectory = join(options.dataDirectory, 'adp');
  await mkdir(adpDirectory, { recursive: true });

  const written: Array<{ file: string; records: number }> = [];
  const seasons = [options.currentSeason, ...options.historicalSeasons];

  for (const season of seasons) {
    const url = `${FFC_BASE_URL}/${options.format}?teams=${options.teams}&year=${season}`;
    try {
      const payload = await fetchJson(url, `ADP download for ${season}`) as { players?: unknown[] };
      const players = Array.isArray(payload.players) ? payload.players : [];
      if (players.length === 0) {
        console.warn(`No ADP rows returned for ${season}; skipping.`);
        continue;
      }
      const file = join(adpDirectory, `adp-${options.format}-${options.teams}-${season}.json`);
      await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
      written.push({ file, records: players.length });
      console.log(`ADP ${season}: ${players.length} players -> ${file}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown ADP failure.';
      console.warn(`Skipping ADP for ${season}: ${message}`);
    }
  }

  if (!options.skipSleeper) {
    const players = await fetchJson(SLEEPER_PLAYERS_URL, 'Sleeper player download') as Record<string, unknown>;
    const file = join(options.dataDirectory, 'sleeper-players.json');
    await writeFile(file, JSON.stringify(players), 'utf8');
    const count = Object.keys(players).length;
    written.push({ file, records: count });
    console.log(`Sleeper: ${count} players -> ${file}`);
  }

  return written;
}

const isDirectInvocation = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/fetch-draft-data.js');
if (isDirectInvocation) {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Fetching ${options.format} ADP for ${options.teams}-team leagues, season ${options.currentSeason}.`);
  fetchDraftData(options)
    .then((written) => {
      console.log(`\nDone. ${written.length} files written to ${options.dataDirectory}.`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown failure.';
      console.error(`Draft data download failed: ${message}`);
      process.exitCode = 1;
    });
}
