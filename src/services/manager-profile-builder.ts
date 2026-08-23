import { assertArray, assertObject, type Position } from '../../validators.js';
import { buildMatchKey } from './player-pool.js';
import { resolveOwner } from './owner-registry.js';

export const DRAFTABLE_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

/**
 * Prior strength for shrinking a manager's overall reach toward the league average.
 *
 * A manager with 25 ADP-matched picks lands halfway between his own number and the
 * league's. B-League's 2025 arrivals, with twelve picks each, are pulled most of the
 * way to the league mean rather than being modeled on a single draft.
 */
const OVERALL_REACH_PRIOR = 25;

/**
 * Prior strength for per-position reach, shrunk toward the manager's own overall reach.
 *
 * Positional samples are small by construction — four tight ends across four drafts —
 * so the prior has to be small too, and the right thing to fall back on is how that
 * manager behaves generally, not how the league behaves. Shrinking a +21.7 tight end
 * habit toward the league mean would erase the strongest signal in the data.
 */
const POSITION_REACH_PRIOR = 4;

/**
 * Prior strength for a manager's position-by-round mix, shrunk toward the league's.
 *
 * One observation per round per season means four or five data points, so the prior
 * stays small enough to let a genuine habit show through.
 */
const ROUND_MIX_PRIOR = 3;

/**
 * Prior strength for the reported confidence weight.
 *
 * Tuned so a manager with four full drafts reads around 0.8 and a single-season
 * newcomer reads around 0.5, which is how much the survival simulation should trust them.
 */
const CONFIDENCE_PRIOR = 12;

export interface ProfilePick {
  leagueId: string;
  season: number;
  teamName: string;
  round: number;
  overallPick: number;
  playerName: string;
  playerTeam: string;
  position: Position;
}

export interface PositionReach {
  mean: number;
  sampleSize: number;
}

export interface ManagerTell {
  label: string;
  position: Position;
  value: number;
  sampleSize: number;
}

export interface ManagerProfile {
  ownerId: string;
  displayName: string;
  leagueId: string;
  teamNames: string[];
  seasons: number[];
  crossLeague: boolean;
  pickCount: number;
  adpMatchedCount: number;
  confidence: number;
  overallReach: number;
  reachByPosition: Partial<Record<Position, PositionReach>>;
  positionShare: Partial<Record<Position, number>>;
  positionByRound: Record<number, Partial<Record<Position, number>>>;
  firstPositionRound: Partial<Record<Position, number>>;
  earlyRoundShape: Partial<Record<Position, number>>;
  tells: ManagerTell[];
}

export interface LeagueProfile {
  leagueId: string;
  seasons: number[];
  pickCount: number;
  rounds: number;
  positionShare: Partial<Record<Position, number>>;
  positionByRound: Record<number, Partial<Record<Position, number>>>;
  meanReach: number;
}

export interface ManagerProfileSet {
  generatedAt: string;
  leagues: Record<string, LeagueProfile>;
  managers: ManagerProfile[];
}

export type SeasonAdpIndex = Record<number, Map<string, number>>;

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function shrink(observed: number, prior: number, sampleSize: number, priorStrength: number): number {
  const weight = sampleSize / (sampleSize + priorStrength);
  return observed * weight + prior * (1 - weight);
}

function toShare(counts: Partial<Record<Position, number>>, total: number): Partial<Record<Position, number>> {
  const share: Partial<Record<Position, number>> = {};
  if (total === 0) {
    return share;
  }
  for (const position of DRAFTABLE_POSITIONS) {
    const count = counts[position] ?? 0;
    if (count > 0) {
      share[position] = round4(count / total);
    }
  }
  return share;
}

function buildTells(profile: Omit<ManagerProfile, 'tells'>): ManagerTell[] {
  const tells: ManagerTell[] = [];

  for (const position of DRAFTABLE_POSITIONS) {
    if (position === 'K' || position === 'DST') {
      continue;
    }
    const reach = profile.reachByPosition[position];
    if (!reach || reach.sampleSize < 3) {
      continue;
    }
    if (Math.abs(reach.mean) < 6) {
      continue;
    }
    tells.push({
      label: reach.mean > 0
        ? `Takes ${position} early, ${round2(reach.mean)} picks ahead of ADP`
        : `Waits on ${position}, ${round2(Math.abs(reach.mean))} picks behind ADP`,
      position,
      value: round2(reach.mean),
      sampleSize: reach.sampleSize,
    });
  }

  const firstQb = profile.firstPositionRound.QB;
  if (typeof firstQb === 'number') {
    tells.push({
      label: `First QB around round ${round2(firstQb)}`,
      position: 'QB',
      value: round2(firstQb),
      sampleSize: profile.seasons.length,
    });
  }

  return tells.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
}

interface LeagueAccumulator {
  seasons: Set<number>;
  pickCount: number;
  maxRound: number;
  positionCounts: Partial<Record<Position, number>>;
  positionByRound: Map<number, Partial<Record<Position, number>>>;
  reaches: number[];
}

interface ManagerAccumulator {
  ownerId: string;
  displayName: string;
  leagueId: string;
  crossLeague: boolean;
  teamNames: Set<string>;
  seasons: Set<number>;
  pickCount: number;
  positionCounts: Partial<Record<Position, number>>;
  positionByRound: Map<number, Partial<Record<Position, number>>>;
  reaches: number[];
  reachByPosition: Map<Position, number[]>;
  firstRoundBySeasonPosition: Map<string, number>;
  earlyRoundCounts: Partial<Record<Position, number>>;
}

/**
 * Build league-level and per-owner draft tendency profiles from historical picks.
 *
 * Every pick is joined to that season's market ADP so that "reach" measures the
 * gap between where a manager took a player and where the field took him. Managers
 * are keyed by owner, so a human drafting in both leagues contributes to one profile
 * per league but is recognisable across them.
 *
 * @param options - Historical picks and per-season ADP lookups.
 * @returns Profile set covering every league and owner present in the picks.
 */
export function buildManagerProfiles(options: {
  picks: ProfilePick[];
  adpBySeason: SeasonAdpIndex;
  now?: () => Date;
}): ManagerProfileSet {
  assertObject(options, 'options');
  assertArray(options.picks, 'options.picks');
  assertObject(options.adpBySeason, 'options.adpBySeason');

  const leagueAccumulators = new Map<string, LeagueAccumulator>();
  const managerAccumulators = new Map<string, ManagerAccumulator>();

  for (const pick of options.picks) {
    assertObject(pick, 'pick');
    const owner = resolveOwner(pick.teamName);
    const managerKey = `${pick.leagueId}::${owner.ownerId}`;

    const league: LeagueAccumulator = leagueAccumulators.get(pick.leagueId) ?? {
      seasons: new Set<number>(),
      pickCount: 0,
      maxRound: 0,
      positionCounts: {},
      positionByRound: new Map(),
      reaches: [],
    };
    const manager: ManagerAccumulator = managerAccumulators.get(managerKey) ?? {
      ownerId: owner.ownerId,
      displayName: owner.displayName,
      leagueId: pick.leagueId,
      crossLeague: owner.crossLeague,
      teamNames: new Set<string>(),
      seasons: new Set<number>(),
      pickCount: 0,
      positionCounts: {},
      positionByRound: new Map(),
      reaches: [],
      reachByPosition: new Map(),
      firstRoundBySeasonPosition: new Map(),
      earlyRoundCounts: {},
    };

    league.seasons.add(pick.season);
    league.pickCount += 1;
    league.maxRound = Math.max(league.maxRound, pick.round);
    league.positionCounts[pick.position] = (league.positionCounts[pick.position] ?? 0) + 1;
    const leagueRound: Partial<Record<Position, number>> = league.positionByRound.get(pick.round) ?? {};
    leagueRound[pick.position] = (leagueRound[pick.position] ?? 0) + 1;
    league.positionByRound.set(pick.round, leagueRound);

    manager.teamNames.add(pick.teamName.trim());
    manager.seasons.add(pick.season);
    manager.pickCount += 1;
    manager.positionCounts[pick.position] = (manager.positionCounts[pick.position] ?? 0) + 1;
    const managerRound: Partial<Record<Position, number>> = manager.positionByRound.get(pick.round) ?? {};
    managerRound[pick.position] = (managerRound[pick.position] ?? 0) + 1;
    manager.positionByRound.set(pick.round, managerRound);

    if (pick.round <= 3) {
      manager.earlyRoundCounts[pick.position] = (manager.earlyRoundCounts[pick.position] ?? 0) + 1;
    }

    const seasonPositionKey = `${pick.season}::${pick.position}`;
    const existingFirst = manager.firstRoundBySeasonPosition.get(seasonPositionKey);
    if (existingFirst === undefined || pick.round < existingFirst) {
      manager.firstRoundBySeasonPosition.set(seasonPositionKey, pick.round);
    }

    const seasonAdp = options.adpBySeason[pick.season];
    const marketAdp = seasonAdp?.get(buildMatchKey(pick.position, pick.playerName, pick.playerTeam));
    if (typeof marketAdp === 'number' && Number.isFinite(marketAdp)) {
      const reachDelta = marketAdp - pick.overallPick;
      manager.reaches.push(reachDelta);
      league.reaches.push(reachDelta);
      const positionReaches: number[] = manager.reachByPosition.get(pick.position) ?? [];
      positionReaches.push(reachDelta);
      manager.reachByPosition.set(pick.position, positionReaches);
    }

    leagueAccumulators.set(pick.leagueId, league);
    managerAccumulators.set(managerKey, manager);
  }

  const leagues: Record<string, LeagueProfile> = {};
  for (const [leagueId, accumulator] of leagueAccumulators) {
    const positionByRound: Record<number, Partial<Record<Position, number>>> = {};
    for (const [roundNumber, counts] of accumulator.positionByRound) {
      const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
      positionByRound[roundNumber] = toShare(counts, total);
    }
    leagues[leagueId] = {
      leagueId,
      seasons: [...accumulator.seasons].sort((left, right) => left - right),
      pickCount: accumulator.pickCount,
      rounds: accumulator.maxRound,
      positionShare: toShare(accumulator.positionCounts, accumulator.pickCount),
      positionByRound,
      meanReach: round2(mean(accumulator.reaches)),
    };
  }

  const managers: ManagerProfile[] = [];
  for (const accumulator of managerAccumulators.values()) {
    const league = leagues[accumulator.leagueId];
    const adpMatchedCount = accumulator.reaches.length;
    const confidence = round2(adpMatchedCount / (adpMatchedCount + CONFIDENCE_PRIOR));

    const overallReach = shrink(mean(accumulator.reaches), league.meanReach, adpMatchedCount, OVERALL_REACH_PRIOR);

    const reachByPosition: Partial<Record<Position, PositionReach>> = {};
    for (const position of DRAFTABLE_POSITIONS) {
      const values = accumulator.reachByPosition.get(position);
      if (!values || values.length === 0) {
        continue;
      }
      reachByPosition[position] = {
        mean: round2(shrink(mean(values), overallReach, values.length, POSITION_REACH_PRIOR)),
        sampleSize: values.length,
      };
    }

    const positionByRound: Record<number, Partial<Record<Position, number>>> = {};
    for (let roundNumber = 1; roundNumber <= league.rounds; roundNumber += 1) {
      const counts: Partial<Record<Position, number>> = accumulator.positionByRound.get(roundNumber) ?? {};
      const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
      const leagueRound: Partial<Record<Position, number>> = league.positionByRound[roundNumber] ?? {};
      const blended: Partial<Record<Position, number>> = {};
      for (const position of DRAFTABLE_POSITIONS) {
        const observed = total === 0 ? 0 : (counts[position] ?? 0) / total;
        const prior = leagueRound[position] ?? 0;
        const value = round4(shrink(observed, prior, total, ROUND_MIX_PRIOR));
        if (value > 0.0001) {
          blended[position] = value;
        }
      }
      positionByRound[roundNumber] = blended;
    }

    const firstPositionRound: Partial<Record<Position, number>> = {};
    for (const position of DRAFTABLE_POSITIONS) {
      const rounds: number[] = [];
      for (const [key, roundNumber] of accumulator.firstRoundBySeasonPosition) {
        if (key.endsWith(`::${position}`)) {
          rounds.push(roundNumber);
        }
      }
      if (rounds.length > 0) {
        firstPositionRound[position] = round2(mean(rounds));
      }
    }

    const base: Omit<ManagerProfile, 'tells'> = {
      ownerId: accumulator.ownerId,
      displayName: accumulator.displayName,
      leagueId: accumulator.leagueId,
      teamNames: [...accumulator.teamNames].sort(),
      seasons: [...accumulator.seasons].sort((left, right) => left - right),
      crossLeague: accumulator.crossLeague,
      pickCount: accumulator.pickCount,
      adpMatchedCount,
      confidence,
      overallReach: round2(overallReach),
      reachByPosition,
      positionShare: toShare(accumulator.positionCounts, accumulator.pickCount),
      positionByRound,
      firstPositionRound,
      earlyRoundShape: accumulator.earlyRoundCounts,
    };

    managers.push({ ...base, tells: buildTells(base) });
  }

  managers.sort((left, right) => left.leagueId.localeCompare(right.leagueId)
    || right.overallReach - left.overallReach);

  const now = options.now?.() ?? new Date();
  return { generatedAt: now.toISOString(), leagues, managers };
}
