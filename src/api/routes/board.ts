import { assertArray, assertInteger, assertNonEmptyString, assertObject, type Position } from '../../../validators.js';
import {
  createDraftBoard,
  recordOffPoolPick,
  recordPick,
  resolveAvailablePlayer,
  rosterFor,
  teamOnTheClock,
  undoLastPick,
  upcomingTurns,
  type BoardPick,
  type DraftBoard,
} from '../../services/draft-board.js';
import { simulateSurvival, type SurvivalResult } from '../../services/survival-engine.js';
import { resolveOwner } from '../../services/owner-registry.js';
import { searchPlayers, toDomainPosition, type PlayerPool, type PlayerPoolEntry } from '../../services/player-pool.js';
import { loadManagerProfiles, loadPlayerPool, type DataStoreOptions } from '../../services/draft-data-store.js';
import type { ManagerProfile } from '../../services/manager-profile-builder.js';

export interface BoardSetupRequest {
  leagueId: string;
  season: number;
  teamCount?: number;
  rounds?: number;
  draftSlot: number;
  draftOrder: string[];
}

export interface BoardStateResponse {
  leagueId: string;
  season: number;
  teamCount: number;
  rounds: number;
  draftSlot: number;
  yourTeam: string;
  onTheClock: { overallPick: number; round: number; teamName: string; isYou: boolean } | null;
  nextPick?: number;
  followingPick?: number;
  picksUntilNext: number;
  picksBetweenTurns: number;
  yourRoster: Partial<Record<Position, number>>;
  yourPicks: BoardPick[];
  recentPicks: BoardPick[];
  pickCount: number;
  availableCount: number;
  survival: SurvivalResult;
  discipline: DisciplineWarning[];
}

export interface DisciplineWarning {
  position: Position;
  message: string;
  reachVsAdp: number;
}

interface BoardSession {
  board: DraftBoard;
  profiles: ManagerProfile[];
  pool: PlayerPool;
}

let activeSession: BoardSession | undefined;

/**
 * Clear the in-memory board. Used between drafts and by tests.
 */
export function resetBoardSession(): void {
  activeSession = undefined;
}

function requireSession(): BoardSession {
  if (!activeSession) {
    throw new TypeError('No draft board is active. Start one with POST /draft/board.');
  }
  return activeSession;
}

/**
 * Start a draft board for one league from cached ADP and generated profiles.
 *
 * @param request - League shape, draft slot, and draft order in slot order.
 * @param options - Data directory overrides for tests.
 * @returns The initial board state.
 */
export async function startBoard(request: unknown, options?: DataStoreOptions): Promise<BoardStateResponse> {
  assertObject(request, 'payload');
  const body = request as Partial<BoardSetupRequest>;
  assertNonEmptyString(body.leagueId, 'leagueId');
  assertInteger(body.season, 'season', 2000);
  assertArray(body.draftOrder, 'draftOrder');
  assertInteger(body.draftSlot, 'draftSlot', 1);

  const teamCount = body.teamCount ?? body.draftOrder.length;
  const rounds = body.rounds ?? 13;

  const [pool, profileSet] = await Promise.all([
    loadPlayerPool(body.season, options),
    loadManagerProfiles(options),
  ]);

  // The pool always contains 32 synthesized team defenses, so emptiness is not
  // the right test — check that real ADP was actually loaded for this season.
  const rankedPlayers = pool.players.filter((player) => player.position !== 'DST').length;
  if (rankedPlayers === 0) {
    throw new TypeError(`No ADP data on disk for ${body.season}. Run "npm run data:fetch" first.`);
  }
  if (!profileSet) {
    throw new TypeError('No manager profiles on disk. Run "npm run profiles:build" first.');
  }

  const leagueId = body.leagueId.trim().toUpperCase();
  const profiles = profileSet.managers.filter((manager) => manager.leagueId === leagueId);
  if (profiles.length === 0) {
    throw new TypeError(`No manager profiles found for league ${leagueId}.`);
  }

  const board = createDraftBoard({
    leagueId,
    season: body.season,
    teamCount,
    rounds,
    draftSlot: body.draftSlot,
    draftOrder: body.draftOrder as string[],
    pool,
    profiles,
  });

  activeSession = { board, profiles, pool };
  return buildBoardState();
}

function buildDiscipline(board: DraftBoard, survival: SurvivalResult): DisciplineWarning[] {
  const yourOwnerId = resolveOwner(board.draftOrder[board.draftSlot - 1]).ownerId;
  const yourProfile = board.profilesByOwnerId.get(yourOwnerId);
  if (!yourProfile) {
    return [];
  }

  const warnings: DisciplineWarning[] = [];
  for (const [position, reach] of Object.entries(yourProfile.reachByPosition)) {
    if (!reach || reach.mean < 6 || reach.sampleSize < 3) {
      continue;
    }
    const stillAvailable = survival.players.some((player) => player.position === position
      && player.survivalProbability >= 0.6);
    warnings.push({
      position: position as Position,
      reachVsAdp: reach.mean,
      message: stillAvailable
        ? `You historically take ${position} ${reach.mean} picks ahead of ADP. There is still ${position} value that survives your next turn.`
        : `You historically take ${position} ${reach.mean} picks ahead of ADP. Check the survival column before reaching again.`,
    });
  }
  return warnings;
}

/**
 * Build the full board state, including a fresh survival simulation.
 *
 * @param samples - Number of Monte Carlo samples to run.
 * @returns Current board state.
 */
export function buildBoardState(samples = 600): BoardStateResponse {
  const { board } = requireSession();
  const yourTeam = board.draftOrder[board.draftSlot - 1];
  const yourOwnerId = resolveOwner(yourTeam).ownerId;
  const nextOverall = board.picks.length + 1;
  const totalPicks = board.teamCount * board.rounds;

  const survival = simulateSurvival({ board, samples });
  const turns = upcomingTurns(board, board.draftSlot);

  const clock = nextOverall <= totalPicks ? teamOnTheClock(board, nextOverall) : undefined;

  return {
    leagueId: board.leagueId,
    season: board.season,
    teamCount: board.teamCount,
    rounds: board.rounds,
    draftSlot: board.draftSlot,
    yourTeam,
    onTheClock: clock
      ? {
        overallPick: nextOverall,
        round: clock.round,
        teamName: clock.teamName,
        isYou: clock.ownerId === yourOwnerId,
      }
      : null,
    nextPick: turns.nextPick,
    followingPick: turns.followingPick,
    picksUntilNext: turns.picksUntilNext,
    picksBetweenTurns: turns.picksBetweenTurns,
    yourRoster: rosterFor(board, yourOwnerId),
    yourPicks: board.picks.filter((pick) => pick.ownerId === yourOwnerId),
    recentPicks: board.picks.slice(-8).reverse(),
    pickCount: board.picks.length,
    availableCount: board.available.size,
    survival,
    discipline: buildDiscipline(board, survival),
  };
}

/**
 * Record the next pick from a typed player query or an exact match key.
 *
 * @param payload - `{ query }` or `{ matchKey }`.
 * @returns The updated board state, or ambiguous candidates when the query is unclear.
 */
export function submitPick(payload: unknown): { state?: BoardStateResponse; candidates?: PlayerPoolEntry[]; pick?: BoardPick } {
  assertObject(payload, 'payload');
  const { board } = requireSession();
  const body = payload as { query?: unknown; matchKey?: unknown; offPool?: unknown };

  if (body.offPool === true) {
    assertNonEmptyString(body.query, 'query');
    const pick = recordOffPoolPick(board, body.query);
    return { pick, state: buildBoardState() };
  }

  let player: PlayerPoolEntry | undefined;
  if (typeof body.matchKey === 'string' && body.matchKey.trim().length > 0) {
    player = board.available.get(body.matchKey.trim());
    if (!player) {
      throw new TypeError('That player is not available.');
    }
  } else {
    assertNonEmptyString(body.query, 'query');
    const resolved = resolveAvailablePlayer(board, body.query);
    if (!resolved.player) {
      if (resolved.candidates.length === 0) {
        throw new TypeError(`No available player matches "${body.query}". Send offPool:true to record it as a placeholder and keep the board in sync.`);
      }
      return { candidates: resolved.candidates };
    }
    player = resolved.player;
  }

  const pick = recordPick(board, player);
  return { pick, state: buildBoardState() };
}

/**
 * Undo the most recent pick.
 *
 * @returns The updated board state and the undone pick.
 */
export function undoPick(): { state: BoardStateResponse; undone?: BoardPick } {
  requireSession();
  const { board } = requireSession();
  const undone = undoLastPick(board);
  return { undone, state: buildBoardState() };
}

/**
 * Extract player selections from pasted CBS draft-results text.
 *
 * Accepts both the CSV export and loose grid text; any line containing a
 * `Name POS | TEAM` descriptor is treated as a pick, in the order they appear.
 *
 * @param text - Raw pasted text.
 * @returns Ordered player descriptors.
 */
export function parseDraftResultsText(text: string): Array<{ name: string; position: Position; team: string }> {
  assertNonEmptyString(text, 'text');
  const picks: Array<{ name: string; position: Position; team: string }> = [];
  const pattern = /([A-Za-z.'\-\s]+?)\s+(QB|RB|WR|TE|K|DST|DEF|PK)\s*\|\s*([A-Za-z]{2,3})/g;

  for (const line of text.split(/\r?\n/)) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match !== null) {
      const position = toDomainPosition(match[2]);
      const name = match[1].replace(/^\d+[,.\s]+/, '').split(',').pop()?.trim();
      if (position && name && name.length > 1) {
        picks.push({ name, position, team: match[3].toUpperCase() });
      }
      match = pattern.exec(line);
    }
  }

  return picks;
}

/**
 * Replace the board's picks with a pasted draft-results dump.
 *
 * Used to resync after falling behind: the board is rewound and replayed so the
 * snake order and every roster stay consistent.
 *
 * @param payload - `{ text }` containing pasted draft results.
 * @returns Updated state plus any descriptors that could not be resolved.
 */
export function resyncFromText(payload: unknown): { state: BoardStateResponse; applied: number; unresolved: string[] } {
  assertObject(payload, 'payload');
  const body = payload as { text?: unknown };
  assertNonEmptyString(body.text, 'text');

  const { board } = requireSession();
  const parsed = parseDraftResultsText(body.text);

  while (board.picks.length > 0) {
    undoLastPick(board);
  }

  const unresolved: string[] = [];
  let applied = 0;
  for (const entry of parsed) {
    const key = entry.position === 'DST' ? `DST:${entry.team}` : undefined;
    const player = key
      ? board.available.get(key)
      : searchPlayers({ ...board.pool, players: [...board.available.values()] }, entry.name, 1)[0];
    if (!player) {
      // Record a placeholder rather than skipping, so every later pick still
      // lands on the team that actually made it.
      unresolved.push(`${entry.name} ${entry.position} | ${entry.team}`);
      recordOffPoolPick(board, `${entry.name} (${entry.position})`, entry.position);
      applied += 1;
      continue;
    }
    recordPick(board, player);
    applied += 1;
  }

  return { state: buildBoardState(), applied, unresolved };
}

/**
 * Search the available pool for the pick-entry autocomplete.
 *
 * @param query - Partial player name.
 * @param limit - Maximum suggestions.
 * @returns Ranked available players.
 */
export function suggestPlayers(query: string, limit = 8): PlayerPoolEntry[] {
  const { board } = requireSession();
  if (typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }
  return searchPlayers(
    { ...board.pool, players: [...board.available.values()].sort((left, right) => left.adp - right.adp) },
    query,
    limit,
  );
}

/**
 * Report whether a board is currently active.
 *
 * @returns True when a board has been started.
 */
export function hasActiveBoard(): boolean {
  return activeSession !== undefined;
}
