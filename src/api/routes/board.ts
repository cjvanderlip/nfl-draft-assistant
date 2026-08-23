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
import { isUserTeam, resolveOwner } from '../../services/owner-registry.js';
import { searchPlayers, toDomainPosition, type PlayerPool, type PlayerPoolEntry } from '../../services/player-pool.js';
import {
  loadAdpFreshness,
  loadManagerProfiles,
  loadPlayerPool,
  type AdpFreshness,
  type DataStoreOptions,
} from '../../services/draft-data-store.js';
import {
  clearBoardSnapshot,
  loadBoardSnapshot,
  saveBoardSnapshot,
} from '../../services/board-persistence.js';
import {
  evaluateRosterRequirements,
  type RosterRequirementStatus,
} from '../../services/roster-requirements.js';
import type { ManagerProfile } from '../../services/manager-profile-builder.js';

export interface BoardSetupRequest {
  leagueId: string;
  season: number;
  teamCount?: number;
  rounds?: number;
  draftSlot: number;
  draftOrder: string[];
  /** Replace an in-progress board instead of refusing to. */
  force?: boolean;
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
  requirements: RosterRequirementStatus;
  setup: BoardSetupAudit;
  adp?: AdpFreshness;
}

/**
 * What the board could and could not verify about the setup it was handed.
 *
 * Both of these are silent-failure modes: an unrecognised team name models a
 * league-mate as a stranger, and a slot pointing at somebody else's team makes
 * every number on the screen describe the wrong manager. Neither is detectable by
 * looking at a working board, so both are reported on every response.
 */
export interface BoardSetupAudit {
  /** Team names in the draft order with no historical profile behind them. */
  unprofiledTeams: string[];
  /** True when the team at your draft slot is one of yours. */
  slotMatchesYourTeam: boolean;
  warnings: string[];
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
  setup: BoardSetupAudit;
  adp?: AdpFreshness;
  dataDirectory?: string;
}

let activeSession: BoardSession | undefined;

/**
 * Clear the in-memory board. Used between drafts and by tests.
 */
export function resetBoardSession(): void {
  activeSession = undefined;
}

/**
 * Check a proposed draft order against the profiles and the user's own teams.
 *
 * @param draftOrder - Team names in slot order.
 * @param draftSlot - The user's one-based slot.
 * @param profiles - Profiles available for this league.
 * @returns Everything suspicious about the setup, or an empty audit.
 */
export function auditSetup(
  draftOrder: string[],
  draftSlot: number,
  profiles: ManagerProfile[],
): BoardSetupAudit {
  const profiledOwnerIds = new Set(profiles.map((profile) => profile.ownerId));
  const unprofiledTeams = draftOrder.filter((teamName) => teamName.trim().length > 0
    && !profiledOwnerIds.has(resolveOwner(teamName).ownerId));

  const teamAtYourSlot = draftOrder[draftSlot - 1];
  const slotMatchesYourTeam = typeof teamAtYourSlot === 'string' && isUserTeam(teamAtYourSlot);

  const warnings: string[] = [];
  if (unprofiledTeams.length > 0) {
    warnings.push(`No draft history for ${unprofiledTeams.map((name) => `"${name}"`).join(', ')}. Check the spelling — an unrecognised team is simulated as a league-average stranger, with none of its own tendencies.`);
  }
  if (!slotMatchesYourTeam) {
    warnings.push(`Slot ${draftSlot} is "${teamAtYourSlot ?? '(empty)'}", which is not one of your teams. Every survival number, your roster, and the discipline warnings would describe that manager instead of you.`);
  }

  return { unprofiledTeams, slotMatchesYourTeam, warnings };
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

  // A draft in progress is not recoverable from anywhere else, so replacing one
  // has to be asked for rather than assumed. Without this an accidental refresh
  // followed by "Start draft" silently discards every pick recorded so far.
  if (activeSession && activeSession.board.picks.length > 0 && body.force !== true) {
    throw new TypeError(`A draft with ${activeSession.board.picks.length} picks is already in progress. Send force:true to discard it and start over.`);
  }

  const teamCount = body.teamCount ?? body.draftOrder.length;
  const rounds = body.rounds ?? 13;

  const [pool, profileSet, adp] = await Promise.all([
    loadPlayerPool(body.season, options),
    loadManagerProfiles(options),
    loadAdpFreshness(body.season, options),
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

  activeSession = {
    board,
    profiles,
    pool,
    setup: auditSetup(board.draftOrder, board.draftSlot, profiles),
    adp,
    dataDirectory: options?.dataDirectory,
  };
  await saveBoardSnapshot(board, options?.dataDirectory);
  return buildBoardState();
}

/**
 * Rebuild the live board from the snapshot left by a previous run.
 *
 * The snapshot stores only the shape of the draft and the sequence of match keys;
 * the pool and profiles are reloaded from disk and the picks replayed, so a
 * restored board is built the same way a live one is rather than deserialized into
 * a shape the rest of the code has never seen.
 *
 * @param options - Data directory overrides for tests.
 * @returns The restored state, or undefined when there is no usable snapshot.
 */
export async function restoreBoard(options?: DataStoreOptions): Promise<BoardStateResponse | undefined> {
  const snapshot = await loadBoardSnapshot(options?.dataDirectory);
  if (!snapshot) {
    return undefined;
  }

  const [pool, profileSet] = await Promise.all([
    loadPlayerPool(snapshot.season, options),
    loadManagerProfiles(options),
  ]);
  if (!profileSet) {
    return undefined;
  }
  const profiles = profileSet.managers.filter((manager) => manager.leagueId === snapshot.leagueId);
  if (profiles.length === 0) {
    return undefined;
  }

  const board = createDraftBoard({
    leagueId: snapshot.leagueId,
    season: snapshot.season,
    teamCount: snapshot.teamCount,
    rounds: snapshot.rounds,
    draftSlot: snapshot.draftSlot,
    draftOrder: snapshot.draftOrder,
    pool,
    profiles,
  });

  for (const persisted of snapshot.picks) {
    if (persisted.offPool) {
      recordOffPoolPick(board, persisted.label ?? 'Unknown pick', persisted.position);
      continue;
    }
    const player = board.available.get(persisted.matchKey);
    if (!player) {
      // The cached ADP changed under the snapshot. Keeping the slot filled matters
      // more than the name in it, because every later pick hangs off the count.
      recordOffPoolPick(board, persisted.matchKey, undefined);
      continue;
    }
    recordPick(board, player);
  }

  activeSession = {
    board,
    profiles,
    pool,
    setup: auditSetup(board.draftOrder, board.draftSlot, profiles),
    adp: await loadAdpFreshness(snapshot.season, options),
    dataDirectory: options?.dataDirectory,
  };
  return buildBoardState();
}

/**
 * Describe a resumable draft without loading it.
 *
 * @param options - Data directory overrides for tests.
 * @returns A summary of the saved board, or undefined when there is none.
 */
export async function describeSavedBoard(options?: DataStoreOptions): Promise<{
  leagueId: string;
  season: number;
  pickCount: number;
  savedAt: string;
} | undefined> {
  const snapshot = await loadBoardSnapshot(options?.dataDirectory);
  if (!snapshot) {
    return undefined;
  }
  return {
    leagueId: snapshot.leagueId,
    season: snapshot.season,
    pickCount: snapshot.picks.length,
    savedAt: snapshot.savedAt,
  };
}

/**
 * Discard the saved snapshot so a finished draft is not offered for resume.
 *
 * @param options - Data directory overrides for tests.
 */
export async function discardSavedBoard(options?: DataStoreOptions): Promise<void> {
  await clearBoardSnapshot(options?.dataDirectory);
}

/**
 * Persist the live board after a change, without making callers wait for the disk.
 *
 * Draft-day latency is the whole product; a pick must land the moment it is typed.
 * The snapshot is therefore written in the background and its failures are logged
 * rather than propagated.
 */
function persistInBackground(): void {
  if (!activeSession) {
    return;
  }
  void saveBoardSnapshot(activeSession.board, activeSession.dataDirectory);
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
  const session = requireSession();
  const { board } = session;
  const yourTeam = board.draftOrder[board.draftSlot - 1];
  const yourOwnerId = resolveOwner(yourTeam).ownerId;
  const nextOverall = board.picks.length + 1;
  const totalPicks = board.teamCount * board.rounds;

  const survival = simulateSurvival({ board, samples });
  const turns = upcomingTurns(board, board.draftSlot);

  const clock = nextOverall <= totalPicks ? teamOnTheClock(board, nextOverall) : undefined;
  const yourRoster = rosterFor(board, yourOwnerId);

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
    yourRoster,
    yourPicks: board.picks.filter((pick) => pick.ownerId === yourOwnerId),
    recentPicks: board.picks.slice(-8).reverse(),
    pickCount: board.picks.length,
    availableCount: board.available.size,
    survival,
    discipline: buildDiscipline(board, survival),
    requirements: evaluateRosterRequirements(board, yourRoster),
    setup: session.setup,
    adp: session.adp,
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
  const body = payload as { query?: unknown; matchKey?: unknown; offPool?: unknown; position?: unknown };

  if (body.offPool === true) {
    assertNonEmptyString(body.query, 'query');
    // The position matters for the caller's own mandatory-slot tracking: an
    // unlisted kicker recorded as the default would leave the board still
    // reporting a kicker as needed.
    const position = toDomainPosition(typeof body.position === 'string' ? body.position : undefined);
    const pick = recordOffPoolPick(board, body.query, position);
    persistInBackground();
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
  persistInBackground();
  return { pick, state: buildBoardState() };
}

/**
 * Undo the most recent pick.
 *
 * @returns The updated board state and the undone pick.
 */
export function undoPick(): { state: BoardStateResponse; undone?: BoardPick } {
  const { board } = requireSession();
  const undone = undoLastPick(board);
  persistInBackground();
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

  persistInBackground();
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
