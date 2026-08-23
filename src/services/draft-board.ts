import { assertArray, assertInteger, assertNonEmptyString, assertObject, type Position } from '../../validators.js';
import { searchPlayers, type PlayerPool, type PlayerPoolEntry } from './player-pool.js';
import { resolveOwner } from './owner-registry.js';
import { REALISTIC_ROSTER_LIMITS } from '../config/league.js';
import type { ManagerProfile } from './manager-profile-builder.js';

export interface BoardPick {
  overallPick: number;
  round: number;
  slot: number;
  teamName: string;
  ownerId: string;
  playerId: string;
  matchKey: string;
  fullName: string;
  position: Position;
  team: string;
  adp: number;
  reachDelta: number;
  recordedAt: string;
  /**
   * True when the drafted player was not in the ADP pool and was recorded as a
   * placeholder. The board stays in sync, which matters far more than knowing
   * exactly who a deep-bench flier was.
   */
  offPool?: boolean;
}

export interface DraftBoardOptions {
  leagueId: string;
  season: number;
  teamCount: number;
  rounds: number;
  draftSlot: number;
  draftOrder: string[];
  pool: PlayerPool;
  profiles: ManagerProfile[];
  rosterLimits?: Partial<Record<Position, number>>;
  now?: () => Date;
}

export interface DraftBoard {
  leagueId: string;
  season: number;
  teamCount: number;
  rounds: number;
  draftSlot: number;
  draftOrder: string[];
  pool: PlayerPool;
  profilesByOwnerId: Map<string, ManagerProfile>;
  rosterLimits: Partial<Record<Position, number>>;
  picks: BoardPick[];
  available: Map<string, PlayerPoolEntry>;
  now: () => Date;
}

export const DEFAULT_ROSTER_LIMITS: Partial<Record<Position, number>> = REALISTIC_ROSTER_LIMITS;

/**
 * Convert an overall pick number into its round and snake slot.
 *
 * @param overallPick - One-based overall pick number.
 * @param teamCount - Number of teams in the league.
 * @returns Round and one-based draft slot on the clock.
 */
export function locatePick(overallPick: number, teamCount: number): { round: number; slot: number } {
  assertInteger(overallPick, 'overallPick', 1);
  assertInteger(teamCount, 'teamCount', 2);
  const round = Math.ceil(overallPick / teamCount);
  const indexInRound = overallPick - (round - 1) * teamCount;
  const slot = round % 2 === 1 ? indexInRound : teamCount - indexInRound + 1;
  return { round, slot };
}

/**
 * List the overall pick numbers belonging to one draft slot.
 *
 * @param slot - One-based draft slot.
 * @param teamCount - Number of teams in the league.
 * @param rounds - Number of rounds in the draft.
 * @returns Ascending overall pick numbers for that slot.
 */
export function pickNumbersForSlot(slot: number, teamCount: number, rounds: number): number[] {
  assertInteger(slot, 'slot', 1);
  assertInteger(teamCount, 'teamCount', 2);
  assertInteger(rounds, 'rounds', 1);
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const indexInRound = round % 2 === 1 ? slot : teamCount - slot + 1;
    picks.push((round - 1) * teamCount + indexInRound);
  }
  return picks;
}

/**
 * Create an empty live draft board for one league.
 *
 * @param options - League shape, draft order, player pool, and manager profiles.
 * @returns Board ready to accept picks.
 */
export function createDraftBoard(options: DraftBoardOptions): DraftBoard {
  assertObject(options, 'options');
  assertNonEmptyString(options.leagueId, 'options.leagueId');
  assertInteger(options.teamCount, 'options.teamCount', 2);
  assertInteger(options.rounds, 'options.rounds', 1);
  assertInteger(options.draftSlot, 'options.draftSlot', 1);
  assertArray(options.draftOrder, 'options.draftOrder');
  assertObject(options.pool, 'options.pool');
  assertArray(options.profiles, 'options.profiles');

  if (options.draftOrder.length !== options.teamCount) {
    throw new TypeError(`options.draftOrder must contain exactly ${options.teamCount} team names.`);
  }
  if (options.draftSlot > options.teamCount) {
    throw new TypeError('options.draftSlot must not exceed options.teamCount.');
  }

  const profilesByOwnerId = new Map<string, ManagerProfile>();
  for (const profile of options.profiles) {
    profilesByOwnerId.set(profile.ownerId, profile);
  }

  const available = new Map<string, PlayerPoolEntry>();
  for (const player of options.pool.players) {
    available.set(player.matchKey, player);
  }

  return {
    leagueId: options.leagueId.trim(),
    season: options.season,
    teamCount: options.teamCount,
    rounds: options.rounds,
    draftSlot: options.draftSlot,
    draftOrder: options.draftOrder.map((name) => name.trim()),
    pool: options.pool,
    profilesByOwnerId,
    rosterLimits: { ...DEFAULT_ROSTER_LIMITS, ...options.rosterLimits },
    picks: [],
    available,
    now: options.now ?? (() => new Date()),
  };
}

/**
 * Report the team on the clock for a given overall pick.
 *
 * @param board - Live draft board.
 * @param overallPick - One-based overall pick number.
 * @returns Team name, owner id, round and slot for that pick.
 */
export function teamOnTheClock(board: DraftBoard, overallPick: number): {
  teamName: string;
  ownerId: string;
  round: number;
  slot: number;
} {
  const { round, slot } = locatePick(overallPick, board.teamCount);
  const teamName = board.draftOrder[slot - 1];
  return { teamName, ownerId: resolveOwner(teamName).ownerId, round, slot };
}

/**
 * Resolve a typed query to exactly one available player.
 *
 * @param board - Live draft board.
 * @param query - Partial player name or team abbreviation.
 * @returns The single match, or the ambiguous candidates when more than one fits.
 */
export function resolveAvailablePlayer(board: DraftBoard, query: string): {
  player?: PlayerPoolEntry;
  candidates: PlayerPoolEntry[];
} {
  assertObject(board, 'board');
  assertNonEmptyString(query, 'query');

  const availablePool: PlayerPool = {
    ...board.pool,
    players: [...board.available.values()].sort((left, right) => left.adp - right.adp),
  };
  const candidates = searchPlayers(availablePool, query, 8);
  if (candidates.length === 0) {
    return { candidates: [] };
  }

  const exact = candidates.filter((candidate) => candidate.fullName.toLowerCase() === query.trim().toLowerCase());
  if (exact.length === 1) {
    return { player: exact[0], candidates };
  }
  if (candidates.length === 1) {
    return { player: candidates[0], candidates };
  }
  return { candidates };
}

/**
 * Record the next pick on the board.
 *
 * The team is derived from the snake order, so callers only supply the player.
 *
 * @param board - Live draft board.
 * @param player - Player selected with this pick.
 * @returns The recorded pick.
 */
export function recordPick(board: DraftBoard, player: PlayerPoolEntry): BoardPick {
  assertObject(board, 'board');
  assertObject(player, 'player');

  if (board.picks.length >= board.teamCount * board.rounds) {
    throw new TypeError('The draft is already complete.');
  }
  if (!board.available.has(player.matchKey)) {
    throw new TypeError(`${player.fullName} has already been drafted.`);
  }

  const overallPick = board.picks.length + 1;
  const { teamName, ownerId, round, slot } = teamOnTheClock(board, overallPick);

  const pick: BoardPick = {
    overallPick,
    round,
    slot,
    teamName,
    ownerId,
    playerId: player.playerId,
    matchKey: player.matchKey,
    fullName: player.fullName,
    position: player.position,
    team: player.team,
    adp: player.adp,
    reachDelta: Number((player.adp - overallPick).toFixed(2)),
    recordedAt: board.now().toISOString(),
  };

  board.available.delete(player.matchKey);
  board.picks.push(pick);
  return pick;
}

/**
 * Record a pick for a player who is not in the ADP pool.
 *
 * Deep bench fliers and unlisted kickers fall outside the top few hundred by ADP.
 * Refusing them would stall the board and desync every pick that follows, so they
 * are recorded as placeholders that consume the slot and nothing else.
 *
 * @param board - Live draft board.
 * @param label - Whatever was typed, kept for the pick log.
 * @param position - Optional position, when it can be inferred.
 * @returns The recorded placeholder pick.
 */
export function recordOffPoolPick(board: DraftBoard, label: string, position: Position = 'RB'): BoardPick {
  assertObject(board, 'board');
  assertNonEmptyString(label, 'label');
  if (board.picks.length >= board.teamCount * board.rounds) {
    throw new TypeError('The draft is already complete.');
  }

  const overallPick = board.picks.length + 1;
  const { teamName, ownerId, round, slot } = teamOnTheClock(board, overallPick);
  const pick: BoardPick = {
    overallPick,
    round,
    slot,
    teamName,
    ownerId,
    playerId: `off-pool-${overallPick}`,
    matchKey: `OFFPOOL:${overallPick}`,
    fullName: label.trim(),
    position,
    team: 'FA',
    adp: 0,
    reachDelta: 0,
    recordedAt: board.now().toISOString(),
    offPool: true,
  };
  board.picks.push(pick);
  return pick;
}

/**
 * Remove the most recent pick and return the player to the available pool.
 *
 * @param board - Live draft board.
 * @returns The undone pick, or undefined when the board is empty.
 */
export function undoLastPick(board: DraftBoard): BoardPick | undefined {
  assertObject(board, 'board');
  const pick = board.picks.pop();
  if (!pick) {
    return undefined;
  }
  const player = board.pool.byMatchKey.get(pick.matchKey);
  if (player) {
    board.available.set(player.matchKey, player);
  }
  return pick;
}

/**
 * Count a team's roster by position.
 *
 * @param board - Live draft board.
 * @param ownerId - Owner whose roster to count.
 * @returns Position counts for that owner.
 */
export function rosterFor(board: DraftBoard, ownerId: string): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {};
  for (const pick of board.picks) {
    if (pick.ownerId === ownerId) {
      counts[pick.position] = (counts[pick.position] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Report the picks remaining before a slot's next two turns.
 *
 * @param board - Live draft board.
 * @param slot - Draft slot to look ahead for.
 * @returns The next two pick numbers for that slot and how many picks intervene.
 */
export function upcomingTurns(board: DraftBoard, slot: number): {
  nextPick?: number;
  followingPick?: number;
  picksUntilNext: number;
  picksBetweenTurns: number;
} {
  const nextOverall = board.picks.length + 1;
  const slotPicks = pickNumbersForSlot(slot, board.teamCount, board.rounds)
    .filter((pickNumber) => pickNumber >= nextOverall);

  const nextPick = slotPicks[0];
  const followingPick = slotPicks[1];
  return {
    nextPick,
    followingPick,
    picksUntilNext: nextPick === undefined ? 0 : nextPick - nextOverall,
    picksBetweenTurns: nextPick === undefined || followingPick === undefined
      ? 0
      : followingPick - nextPick - 1,
  };
}
