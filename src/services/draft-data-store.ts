import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { assertNonEmptyString, type Position } from '../../validators.js';
import { importHistoricalDraftCsv } from './historical-draft-importer.js';
import { buildMatchKey, buildPlayerPool, toDomainPosition, type AdpSourceEntry, type PlayerPool, type SleeperSourceEntry } from './player-pool.js';
import type { ManagerProfileSet, ProfilePick, SeasonAdpIndex } from './manager-profile-builder.js';

export interface DataStoreOptions {
  dataDirectory?: string;
  historicalDirectory?: string;
  format?: string;
  teams?: number;
}

const DEFAULT_FORMAT = 'ppr';
const DEFAULT_TEAMS = 12;

function dataDir(options: DataStoreOptions | undefined): string {
  return options?.dataDirectory ?? join(process.cwd(), 'data');
}

function adpFileName(format: string, teams: number, season: number): string {
  return `adp-${format}-${teams}-${season}.json`;
}

/**
 * Derive a stable league identifier and season from a historical export filename.
 *
 * The exports are named like `2025_Pre-season_A-LeagueDraft.csv`; duplicate
 * downloads carrying a ` (1)` suffix are reported so callers can ignore them.
 *
 * @param fileName - Historical CSV filename.
 * @returns League id, season, and duplicate flag, or undefined when unparseable.
 */
export function parseHistoricalFileName(fileName: string): {
  leagueId: string;
  season: number;
  duplicate: boolean;
} | undefined {
  assertNonEmptyString(fileName, 'fileName');
  const match = /^(\d{4})_.*?([AB])-LeagueDraft(\s*\(\d+\))?\.csv$/i.exec(fileName);
  if (!match) {
    return undefined;
  }
  return {
    leagueId: `${match[2].toUpperCase()}-LEAGUE`,
    season: Number(match[1]),
    duplicate: match[3] !== undefined,
  };
}

/**
 * Read one cached ADP file from disk.
 *
 * @param season - Season to load.
 * @param options - Data directory, scoring format, and league size.
 * @returns ADP entries, or an empty array when the file is absent.
 */
export async function loadAdpEntries(season: number, options?: DataStoreOptions): Promise<AdpSourceEntry[]> {
  const file = join(
    dataDir(options),
    'adp',
    adpFileName(options?.format ?? DEFAULT_FORMAT, options?.teams ?? DEFAULT_TEAMS, season),
  );
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { players?: AdpSourceEntry[] };
    return Array.isArray(parsed.players) ? parsed.players : [];
  } catch {
    return [];
  }
}

export interface AdpFreshness {
  format: string;
  teams: number;
  /** Last day of drafts the feed averaged, as reported by the source. */
  sampledThrough?: string;
  /** Whole days between `sampledThrough` and now. */
  ageInDays?: number;
  /** Number of real drafts behind the averages. */
  draftsSampled?: number;
  stale: boolean;
}

/** Days after which late-August ADP has moved enough to be worth re-downloading. */
const STALE_AFTER_DAYS = 3;

/**
 * Report how old the cached ADP for a season is.
 *
 * Fantasy Football Calculator stamps every response with the window of real drafts
 * it averaged. That window, not the file's modification time, is what actually
 * dates the numbers — a re-download that returns the same week of drafts is no
 * fresher than the file it replaced.
 *
 * @param season - Season to inspect.
 * @param options - Data directory, scoring format, and league size.
 * @param now - Clock, injectable for tests.
 * @returns Freshness summary, or undefined when the file is absent.
 */
export async function loadAdpFreshness(
  season: number,
  options?: DataStoreOptions,
  now: () => Date = () => new Date(),
): Promise<AdpFreshness | undefined> {
  const format = options?.format ?? DEFAULT_FORMAT;
  const teams = options?.teams ?? DEFAULT_TEAMS;
  const file = join(dataDir(options), 'adp', adpFileName(format, teams, season));
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      meta?: { end_date?: string; total_drafts?: number };
    };
    const sampledThrough = parsed.meta?.end_date;
    let ageInDays: number | undefined;
    if (typeof sampledThrough === 'string') {
      const sampled = Date.parse(`${sampledThrough}T00:00:00Z`);
      if (Number.isFinite(sampled)) {
        ageInDays = Math.max(0, Math.floor((now().getTime() - sampled) / 86_400_000));
      }
    }
    return {
      format,
      teams,
      sampledThrough,
      ageInDays,
      draftsSampled: parsed.meta?.total_drafts,
      stale: ageInDays !== undefined && ageInDays > STALE_AFTER_DAYS,
    };
  } catch {
    return undefined;
  }
}

/**
 * Read the cached Sleeper player metadata.
 *
 * @param options - Data directory.
 * @returns Sleeper players keyed by id, or an empty object when absent.
 */
export async function loadSleeperPlayers(options?: DataStoreOptions): Promise<Record<string, SleeperSourceEntry>> {
  try {
    const raw = await readFile(join(dataDir(options), 'sleeper-players.json'), 'utf8');
    return JSON.parse(raw) as Record<string, SleeperSourceEntry>;
  } catch {
    return {};
  }
}

/**
 * Build the current-season player pool from cached files.
 *
 * @param season - Season to load.
 * @param options - Data directory, scoring format, and league size.
 * @returns Merged player pool.
 */
export async function loadPlayerPool(season: number, options?: DataStoreOptions): Promise<PlayerPool> {
  const [adpEntries, sleeperPlayers] = await Promise.all([
    loadAdpEntries(season, options),
    loadSleeperPlayers(options),
  ]);
  return buildPlayerPool({ season, adpEntries, sleeperPlayers });
}

/**
 * Build per-season ADP lookups keyed by the cross-source match key.
 *
 * @param seasons - Seasons to index.
 * @param options - Data directory, scoring format, and league size.
 * @returns Season-indexed ADP maps for historical joins.
 */
export async function loadSeasonAdpIndex(seasons: number[], options?: DataStoreOptions): Promise<SeasonAdpIndex> {
  const index: SeasonAdpIndex = {};
  for (const season of seasons) {
    const entries = await loadAdpEntries(season, options);
    const map = new Map<string, number>();
    for (const entry of entries) {
      const position = toDomainPosition(entry.position);
      if (!position || typeof entry.adp !== 'number') {
        continue;
      }
      map.set(buildMatchKey(position, entry.name, entry.team), entry.adp);
    }
    index[season] = map;
  }
  return index;
}

/**
 * Load every historical draft export as profile-ready picks.
 *
 * @param options - Historical CSV directory.
 * @returns Picks across all leagues and seasons, duplicates excluded.
 */
export async function loadHistoricalPicks(options?: DataStoreOptions): Promise<ProfilePick[]> {
  const directory = options?.historicalDirectory ?? join(process.cwd(), 'historical-draft-data');
  const fileNames = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith('.csv'));

  const picks: ProfilePick[] = [];
  for (const fileName of fileNames.sort()) {
    const parsed = parseHistoricalFileName(fileName);
    if (!parsed || parsed.duplicate) {
      continue;
    }
    const csvText = await readFile(join(directory, fileName), 'utf8');
    const imported = importHistoricalDraftCsv(csvText, parsed.leagueId, parsed.season);
    for (const pick of imported.picks) {
      const player = imported.players[pick.playerId];
      const manager = imported.managers[pick.managerId];
      const position = toDomainPosition(player?.position);
      if (!player || !manager || !position) {
        continue;
      }
      picks.push({
        leagueId: parsed.leagueId,
        season: parsed.season,
        teamName: manager,
        round: pick.round,
        overallPick: pick.overallPick,
        playerName: player.fullName,
        playerTeam: player.team,
        position: position as Position,
      });
    }
  }

  return picks;
}

/**
 * Read the generated manager profile set.
 *
 * @param options - Data directory.
 * @returns Profile set, or undefined when it has not been generated yet.
 */
export async function loadManagerProfiles(options?: DataStoreOptions): Promise<ManagerProfileSet | undefined> {
  try {
    const raw = await readFile(join(dataDir(options), 'manager-profiles.json'), 'utf8');
    return JSON.parse(raw) as ManagerProfileSet;
  } catch {
    return undefined;
  }
}
