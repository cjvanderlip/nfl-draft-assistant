import { assertArray, assertNonEmptyString, assertObject, type Position } from '../../validators.js';

export interface AdpSourceEntry {
  name: string;
  position: string;
  team: string;
  adp: number;
  bye?: number;
  stdev?: number;
  times_drafted?: number;
}

export interface SleeperSourceEntry {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  injury_status?: string | null;
  bye_week?: number | string | null;
}

export interface PlayerPoolEntry {
  playerId: string;
  matchKey: string;
  fullName: string;
  /**
   * Extra strings this player answers to when typed into the pick box.
   *
   * Team defenses need these: the ADP feed calls them "Philadelphia Defense"
   * while the CBS draft room shows "Eagles DST | PHI", so the nickname you
   * actually read off the screen has to resolve.
   */
  searchAliases: string[];
  position: Position;
  team: string;
  adp: number;
  adpStdev?: number;
  timesDrafted?: number;
  byeWeek?: number;
  sleeperId?: string;
  injuryStatus?: string;
}

export interface PlayerPool {
  season: number;
  players: PlayerPoolEntry[];
  byMatchKey: Map<string, PlayerPoolEntry>;
  unresolvedSleeperMatches: string[];
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Team nickname and city aliases, keyed by canonical abbreviation. */
const TEAM_NICKNAMES: Record<string, string[]> = {
  ARI: ['cardinals', 'arizona'],
  ATL: ['falcons', 'atlanta'],
  BAL: ['ravens', 'baltimore'],
  BUF: ['bills', 'buffalo'],
  CAR: ['panthers', 'carolina'],
  CHI: ['bears', 'chicago'],
  CIN: ['bengals', 'cincinnati'],
  CLE: ['browns', 'cleveland'],
  DAL: ['cowboys', 'dallas'],
  DEN: ['broncos', 'denver'],
  DET: ['lions', 'detroit'],
  GB: ['packers', 'green bay'],
  HOU: ['texans', 'houston'],
  IND: ['colts', 'indianapolis'],
  JAX: ['jaguars', 'jags', 'jacksonville'],
  KC: ['chiefs', 'kansas city'],
  LV: ['raiders', 'las vegas'],
  LAC: ['chargers', 'la chargers', 'los angeles chargers'],
  LAR: ['rams', 'la rams', 'los angeles rams'],
  MIA: ['dolphins', 'miami'],
  MIN: ['vikings', 'minnesota'],
  NE: ['patriots', 'pats', 'new england'],
  NO: ['saints', 'new orleans'],
  NYG: ['giants', 'ny giants', 'new york giants'],
  NYJ: ['jets', 'ny jets', 'new york jets'],
  PHI: ['eagles', 'philadelphia'],
  PIT: ['steelers', 'pittsburgh'],
  SEA: ['seahawks', 'seattle'],
  SF: ['niners', 'forty niners', 'san francisco'],
  TB: ['buccaneers', 'bucs', 'tampa bay', 'tampa'],
  TEN: ['titans', 'tennessee'],
  WAS: ['commanders', 'washington'],
};

const TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX',
  WSH: 'WAS',
  LVR: 'LV',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
  ARZ: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
};

/**
 * Normalize a player name for cross-source matching.
 *
 * Lowercases, strips punctuation and generational suffixes, and collapses whitespace
 * so that "Brian Thomas Jr." and "Brian Thomas" resolve to the same key.
 *
 * @param name - Raw player name from any source.
 * @returns Normalized comparison key.
 */
export function normalizePlayerName(name: string): string {
  assertNonEmptyString(name, 'name');
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((part) => part.length > 0 && !NAME_SUFFIXES.has(part))
    .join(' ')
    .trim();
}

/**
 * Normalize an NFL team abbreviation to a single canonical form.
 *
 * @param team - Raw team abbreviation from any source.
 * @returns Canonical uppercase abbreviation.
 */
export function normalizeTeam(team: string | null | undefined): string {
  if (typeof team !== 'string' || team.trim().length === 0) {
    return 'FA';
  }
  const upper = team.trim().toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

/**
 * Map a source-specific position label onto a domain position.
 *
 * Fantasy Football Calculator uses `DEF` and `PK`; the CBS draft exports use
 * `DST` and `K`. Both collapse onto the domain vocabulary.
 *
 * @param rawPosition - Position label from any source.
 * @returns Domain position, or undefined when the label is not draftable.
 */
export function toDomainPosition(rawPosition: string | null | undefined): Position | undefined {
  if (typeof rawPosition !== 'string') {
    return undefined;
  }
  const upper = rawPosition.trim().toUpperCase();
  if (upper === 'DEF' || upper === 'DST' || upper === 'D/ST') {
    return 'DST';
  }
  if (upper === 'PK' || upper === 'K') {
    return 'K';
  }
  if (upper === 'QB' || upper === 'RB' || upper === 'WR' || upper === 'TE') {
    return upper;
  }
  return undefined;
}

/**
 * Build the cross-source match key for a player.
 *
 * Team defenses are keyed by team abbreviation because sources disagree on the
 * name ("Seattle Defense" versus "Seahawks DST"). Everyone else is keyed by
 * position and normalized name.
 *
 * @param position - Domain position.
 * @param fullName - Player name.
 * @param team - Team abbreviation.
 * @returns Stable match key.
 */
export function buildMatchKey(position: Position, fullName: string, team: string): string {
  if (position === 'DST') {
    return `DST:${normalizeTeam(team)}`;
  }
  return `${position}:${normalizePlayerName(fullName)}`;
}

/**
 * Build the strings a player answers to in the pick box.
 *
 * @param position - Domain position.
 * @param fullName - Player name as the ADP feed spells it.
 * @param team - Canonical team abbreviation.
 * @returns Lowercase aliases, always including the normalized name.
 */
export function buildSearchAliases(position: Position, fullName: string, team: string): string[] {
  const aliases = new Set<string>();
  const normalized = normalizePlayerName(fullName);
  if (normalized.length > 0) {
    aliases.add(normalized);
  }
  if (position === 'DST') {
    aliases.add(team.toLowerCase());
    for (const nickname of TEAM_NICKNAMES[team] ?? []) {
      aliases.add(nickname);
    }
    // "Philadelphia Defense" should also answer to just "philadelphia".
    const withoutDefense = normalized.replace(/\s*(defense|dst|d st)$/, '').trim();
    if (withoutDefense.length > 0) {
      aliases.add(withoutDefense);
    }
  }
  return [...aliases];
}

function createPlayerId(position: Position, fullName: string, team: string): string {
  if (position === 'DST') {
    return `player-dst-${normalizeTeam(team).toLowerCase()}`;
  }
  return `player-${normalizePlayerName(fullName).replace(/\s+/g, '-')}`;
}

function readByeWeek(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 1 || numeric > 22) {
    return undefined;
  }
  return numeric;
}

/**
 * Merge an ADP feed with Sleeper player metadata into one draftable pool.
 *
 * ADP is the spine: a player without ADP is not going to be drafted in the first
 * thirteen rounds and is dropped. Sleeper contributes injury status and bye weeks
 * where the names resolve; unresolved names are reported rather than silently lost.
 *
 * @param options - Season, ADP entries, and optional Sleeper player records.
 * @returns The merged pool plus a list of ADP names Sleeper could not confirm.
 */
export function buildPlayerPool(options: {
  season: number;
  adpEntries: AdpSourceEntry[];
  sleeperPlayers?: Record<string, SleeperSourceEntry>;
}): PlayerPool {
  assertObject(options, 'options');
  assertArray(options.adpEntries, 'options.adpEntries');

  const sleeperByKey = new Map<string, SleeperSourceEntry>();
  for (const entry of Object.values(options.sleeperPlayers ?? {})) {
    const position = toDomainPosition(entry.position);
    if (!position) {
      continue;
    }
    const fullName = entry.full_name ?? [entry.first_name, entry.last_name].filter(Boolean).join(' ');
    if (!fullName) {
      continue;
    }
    const key = buildMatchKey(position, fullName, normalizeTeam(entry.team));
    if (!sleeperByKey.has(key)) {
      sleeperByKey.set(key, entry);
    }
  }

  const players: PlayerPoolEntry[] = [];
  const byMatchKey = new Map<string, PlayerPoolEntry>();
  const unresolvedSleeperMatches: string[] = [];

  for (const entry of options.adpEntries) {
    assertObject(entry, 'adp entry');
    const position = toDomainPosition(entry.position);
    if (!position || typeof entry.adp !== 'number' || !Number.isFinite(entry.adp)) {
      continue;
    }
    const team = normalizeTeam(entry.team);
    const matchKey = buildMatchKey(position, entry.name, team);
    if (byMatchKey.has(matchKey)) {
      continue;
    }

    const sleeper = sleeperByKey.get(matchKey);
    if (!sleeper && position !== 'DST') {
      unresolvedSleeperMatches.push(`${entry.name} (${position}, ${team})`);
    }

    const player: PlayerPoolEntry = {
      playerId: createPlayerId(position, entry.name, team),
      matchKey,
      fullName: entry.name.trim(),
      searchAliases: buildSearchAliases(position, entry.name, team),
      position,
      team,
      adp: entry.adp,
      adpStdev: typeof entry.stdev === 'number' ? entry.stdev : undefined,
      timesDrafted: typeof entry.times_drafted === 'number' ? entry.times_drafted : undefined,
      byeWeek: readByeWeek(entry.bye) ?? readByeWeek(sleeper?.bye_week),
      sleeperId: sleeper?.player_id,
      injuryStatus: sleeper?.injury_status ?? undefined,
    };

    players.push(player);
    byMatchKey.set(matchKey, player);
  }

  // Every NFL defense is draftable in the last round, but the ADP feed only lists
  // the ones that get taken often enough to register. Fill in the rest at a deep
  // ADP so a round-13 pick can never fail to resolve.
  const deepestAdp = players.reduce((deepest, player) => Math.max(deepest, player.adp), 0);
  for (const team of Object.keys(TEAM_NICKNAMES)) {
    const matchKey = `DST:${team}`;
    if (byMatchKey.has(matchKey)) {
      continue;
    }
    const fullName = `${team} Defense`;
    const player: PlayerPoolEntry = {
      playerId: createPlayerId('DST', fullName, team),
      matchKey,
      fullName,
      searchAliases: buildSearchAliases('DST', fullName, team),
      position: 'DST',
      team,
      adp: Number((deepestAdp + 1).toFixed(1)),
      byeWeek: undefined,
    };
    players.push(player);
    byMatchKey.set(matchKey, player);
  }

  players.sort((left, right) => left.adp - right.adp);

  return {
    season: options.season,
    players,
    byMatchKey,
    unresolvedSleeperMatches,
  };
}

/**
 * Find pool players matching a free-text query, ranked for draft-room typing.
 *
 * Prefix matches on the full name outrank prefix matches on the surname, which
 * outrank loose substring matches; ties break on ADP so the likelier pick is first.
 *
 * @param pool - Player pool to search.
 * @param query - Partial name typed by the user.
 * @param limit - Maximum number of suggestions to return.
 * @returns Ranked candidate players.
 */
export function searchPlayers(pool: PlayerPool, query: string, limit = 8): PlayerPoolEntry[] {
  assertObject(pool, 'pool');
  if (typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  const needle = normalizePlayerName(query.trim().length > 0 ? query : 'x');
  if (needle.length === 0) {
    return [];
  }

  // Rank tiers, best first. Nickname matches sit below a real surname match so
  // that "brown" finds Chase Brown while "browns" finds the Cleveland defense.
  const EXACT = 0;
  const NAME_PREFIX = 1;
  const SURNAME_PREFIX = 2;
  const ALIAS_PREFIX = 3;
  const SUBSTRING = 4;

  const rawNeedle = query.trim().toLowerCase();
  const scored: Array<{ player: PlayerPoolEntry; rank: number }> = [];

  for (const player of pool.players) {
    const primary = normalizePlayerName(player.fullName);
    const aliases = player.searchAliases ?? [primary];
    let rank: number | undefined;
    const consider = (candidate: number): void => {
      rank = rank === undefined ? candidate : Math.min(rank, candidate);
    };

    for (const alias of aliases) {
      if (alias === needle || alias === rawNeedle) {
        consider(EXACT);
      }
    }

    if (rank !== EXACT) {
      if (primary.startsWith(needle)) {
        consider(NAME_PREFIX);
      }
      const surname = primary.split(' ').slice(1).join(' ');
      if (surname.length > 0 && surname.startsWith(needle)) {
        consider(SURNAME_PREFIX);
      }
      for (const alias of aliases) {
        if (alias !== primary && alias.startsWith(needle)) {
          consider(ALIAS_PREFIX);
        }
      }
      if (primary.includes(needle)) {
        consider(SUBSTRING);
      }
    }

    if (rank !== undefined) {
      scored.push({ player, rank });
    }
  }

  return scored
    .sort((left, right) => left.rank - right.rank || left.player.adp - right.player.adp)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.player);
}
