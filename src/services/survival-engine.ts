import { assertObject, type Position } from '../../validators.js';
import type { PlayerPoolEntry } from './player-pool.js';
import { locatePick, teamOnTheClock, type DraftBoard } from './draft-board.js';
import type { ManagerProfile } from './manager-profile-builder.js';

export type SurvivalVerdict = 'GONE_BY_YOUR_TURN' | 'RISKY' | 'CAN_WAIT' | 'SAFE';

export interface SurvivalPlayer {
  matchKey: string;
  playerId: string;
  fullName: string;
  position: Position;
  team: string;
  adp: number;
  byeWeek?: number;
  injuryStatus?: string;
  survivalProbability: number;
  rawSurvivalProbability: number;
  verdict: SurvivalVerdict;
  topThreat?: { teamName: string; probability: number };
}

export interface SurvivalThreat {
  overallPick: number;
  round: number;
  teamName: string;
  ownerId: string;
  confidence: number;
  seasons: number;
  positionOdds: Partial<Record<Position, number>>;
  tells: string[];
}

export interface SurvivalResult {
  fromPick: number;
  targetPick?: number;
  picksSimulated: number;
  samples: number;
  /**
   * True when you are on the clock and the window therefore starts after this
   * pick: the answer is "does he come back to me next turn if I spend this pick
   * on someone else", which is the only question worth asking on the clock.
   */
  assumesCurrentPickSpent: boolean;
  players: SurvivalPlayer[];
  threats: SurvivalThreat[];
  note?: string;
}

/**
 * Deterministic pseudo-random generator so simulations are reproducible in tests.
 *
 * @param seed - Integer seed.
 * @returns Function producing floats in [0, 1).
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Measured calibration anchors mapping raw simulation output to observed reality.
 *
 * Fitted by replaying five held-out drafts (A-League 2023/2024/2025 and B-League
 * 2024/2025) with profiles trained without the replayed season, then comparing each
 * probability bucket to what actually survived. The raw simulation is systematically
 * over-eager at the bottom of the board — it says a player is certainly gone about
 * 7% of the time when he actually survived 37% of the time — because simulated
 * managers converge on the same obvious pick more often than real ones do.
 *
 * Re-derive these with `npm run replay` if the league or scoring format changes.
 */
const CALIBRATION_ANCHORS: Array<[raw: number, actual: number]> = [
  [0.00, 0.30],
  [0.07, 0.37],
  [0.30, 0.41],
  [0.51, 0.56],
  [0.71, 0.72],
  [0.96, 0.94],
  [1.00, 0.98],
];

/**
 * Map a raw simulation probability onto the observed survival rate.
 *
 * @param raw - Fraction of simulations in which the player survived.
 * @returns Calibrated survival probability.
 */
export function calibrateSurvival(raw: number): number {
  const clamped = Math.max(0, Math.min(1, raw));
  for (let index = 1; index < CALIBRATION_ANCHORS.length; index += 1) {
    const [lowRaw, lowActual] = CALIBRATION_ANCHORS[index - 1];
    const [highRaw, highActual] = CALIBRATION_ANCHORS[index];
    if (clamped <= highRaw) {
      const span = highRaw - lowRaw;
      const position = span === 0 ? 0 : (clamped - lowRaw) / span;
      return lowActual + position * (highActual - lowActual);
    }
  }
  return CALIBRATION_ANCHORS[CALIBRATION_ANCHORS.length - 1][1];
}

/**
 * Convert a calibrated survival probability into a draft-room verdict.
 *
 * Thresholds sit inside the calibrated range (roughly 0.30 to 0.98) rather than
 * spanning a full 0-to-1 scale, because no player on a live board is ever a
 * certainty in either direction.
 *
 * @param probability - Calibrated survival probability.
 * @returns Verdict shown next to the player.
 */
function verdictFor(probability: number): SurvivalVerdict {
  if (probability >= 0.88) {
    return 'SAFE';
  }
  if (probability >= 0.7) {
    return 'CAN_WAIT';
  }
  if (probability >= 0.5) {
    return 'RISKY';
  }
  return 'GONE_BY_YOUR_TURN';
}

function effectiveAdp(player: PlayerPoolEntry, profile: ManagerProfile | undefined): number {
  if (!profile) {
    return player.adp;
  }
  const positionReach = profile.reachByPosition[player.position];
  const reach = positionReach?.mean ?? profile.overallReach;
  return player.adp - reach;
}

/**
 * Estimate how likely each available player is to last until a slot's next turn.
 *
 * Every pick between now and the target is simulated: the manager on the clock scores
 * the available pool by ADP shifted by his own positional reach, weighted by how often
 * he takes that position in that round, and sampled with softmax noise. Repeating the
 * whole sequence many times turns those tendencies into a survival probability.
 *
 * @param options - Board, target pick, and simulation controls.
 * @returns Per-player survival probabilities and a read on the upcoming managers.
 */
export function simulateSurvival(options: {
  board: DraftBoard;
  slot?: number;
  samples?: number;
  candidateDepth?: number;
  simulationDepth?: number;
  temperature?: number;
  random?: () => number;
}): SurvivalResult {
  assertObject(options, 'options');
  assertObject(options.board, 'options.board');

  const board = options.board;
  const slot = options.slot ?? board.draftSlot;
  const samples = Math.max(1, Math.min(options.samples ?? 500, 5000));
  const candidateDepth = Math.max(10, Math.min(options.candidateDepth ?? 80, 300));
  const temperature = options.temperature ?? 10;
  const random = options.random ?? Math.random;

  const fromPick = board.picks.length + 1;
  const totalPicks = board.teamCount * board.rounds;

  const available = [...board.available.values()].sort((left, right) => left.adp - right.adp);

  // Opponents choose from a deeper pool than the one reported back. A manager who
  // reaches thirty picks ahead of ADP — and this league has one who does exactly
  // that at quarterback — has to be able to reach past the bottom of the displayed
  // board, or every pick he makes is forced onto a player the user is watching and
  // survival reads low across the whole list.
  const simulationDepth = Math.max(
    candidateDepth,
    Math.min(options.simulationDepth ?? candidateDepth * 2, 400),
  );
  const simulationPool = available.slice(0, simulationDepth);
  const candidates = simulationPool.slice(0, candidateDepth);

  const slotPicks: number[] = [];
  for (let overall = fromPick; overall <= totalPicks; overall += 1) {
    if (locatePick(overall, board.teamCount).slot === slot) {
      slotPicks.push(overall);
    }
  }

  // On the clock, the useful question is not "who is available" — you can see
  // that — but "who comes back to me next turn if I spend this pick elsewhere".
  const onTheClock = slotPicks[0] === fromPick;
  const targetPick = onTheClock ? slotPicks[1] : slotPicks[0];
  const startPick = onTheClock ? fromPick + 1 : fromPick;

  if (targetPick === undefined) {
    return {
      fromPick,
      targetPick,
      picksSimulated: 0,
      samples: 0,
      assumesCurrentPickSpent: onTheClock,
      players: candidates.map((player) => ({
        matchKey: player.matchKey,
        playerId: player.playerId,
        fullName: player.fullName,
        position: player.position,
        team: player.team,
        adp: player.adp,
        byeWeek: player.byeWeek,
        injuryStatus: player.injuryStatus,
        survivalProbability: 1,
        rawSurvivalProbability: 1,
        verdict: 'SAFE' as SurvivalVerdict,
      })),
      threats: [],
      note: onTheClock
        ? 'Last turn of the draft. Everything listed is available right now.'
        : 'No further picks remain for this slot.',
    };
  }

  const interveningPicks: number[] = [];
  for (let overall = startPick; overall < targetPick; overall += 1) {
    interveningPicks.push(overall);
  }

  const baseRosters = new Map<string, Partial<Record<Position, number>>>();
  for (const pick of board.picks) {
    const roster = baseRosters.get(pick.ownerId) ?? {};
    roster[pick.position] = (roster[pick.position] ?? 0) + 1;
    baseRosters.set(pick.ownerId, roster);
  }

  const survivedCount = new Map<string, number>();
  const threatCount = new Map<string, Map<string, number>>();
  const positionPicked = new Map<number, Partial<Record<Position, number>>>();
  for (const player of candidates) {
    survivedCount.set(player.matchKey, 0);
    threatCount.set(player.matchKey, new Map());
  }

  for (let sample = 0; sample < samples; sample += 1) {
    const taken = new Set<string>();
    const rosters = new Map<string, Partial<Record<Position, number>>>();
    for (const [ownerId, counts] of baseRosters) {
      rosters.set(ownerId, { ...counts });
    }

    for (const overall of interveningPicks) {
      const { teamName, ownerId, round } = teamOnTheClock(board, overall);
      const profile = board.profilesByOwnerId.get(ownerId);
      const roster = rosters.get(ownerId) ?? {};

      let bestEffective = Number.POSITIVE_INFINITY;
      const eligible: Array<{ player: PlayerPoolEntry; effective: number; roundWeight: number }> = [];
      for (const player of simulationPool) {
        if (taken.has(player.matchKey)) {
          continue;
        }
        const limit = board.rosterLimits[player.position];
        if (limit !== undefined && (roster[player.position] ?? 0) >= limit) {
          continue;
        }
        const effective = effectiveAdp(player, profile);
        const roundWeight = profile?.positionByRound[round]?.[player.position] ?? 0.05;
        eligible.push({ player, effective, roundWeight });
        if (effective < bestEffective) {
          bestEffective = effective;
        }
      }

      if (eligible.length === 0) {
        continue;
      }

      let totalWeight = 0;
      const weights: number[] = [];
      for (const entry of eligible) {
        const weight = Math.exp((bestEffective - entry.effective) / temperature)
          * Math.max(entry.roundWeight, 0.01);
        weights.push(weight);
        totalWeight += weight;
      }

      let threshold = random() * totalWeight;
      let chosenIndex = weights.length - 1;
      for (let index = 0; index < weights.length; index += 1) {
        threshold -= weights[index];
        if (threshold <= 0) {
          chosenIndex = index;
          break;
        }
      }

      const chosen = eligible[chosenIndex].player;
      taken.add(chosen.matchKey);
      roster[chosen.position] = (roster[chosen.position] ?? 0) + 1;
      rosters.set(ownerId, roster);

      const perPlayerThreats = threatCount.get(chosen.matchKey);
      if (perPlayerThreats) {
        perPlayerThreats.set(teamName, (perPlayerThreats.get(teamName) ?? 0) + 1);
      }
      const roundPositions = positionPicked.get(overall) ?? {};
      roundPositions[chosen.position] = (roundPositions[chosen.position] ?? 0) + 1;
      positionPicked.set(overall, roundPositions);
    }

    for (const player of candidates) {
      if (!taken.has(player.matchKey)) {
        survivedCount.set(player.matchKey, (survivedCount.get(player.matchKey) ?? 0) + 1);
      }
    }
  }

  const players: SurvivalPlayer[] = candidates.map((player) => {
    const rawProbability = (survivedCount.get(player.matchKey) ?? 0) / samples;
    const probability = calibrateSurvival(rawProbability);
    const threats = threatCount.get(player.matchKey);
    let topThreat: { teamName: string; probability: number } | undefined;
    if (threats) {
      for (const [teamName, count] of threats) {
        const threatProbability = count / samples;
        if (!topThreat || threatProbability > topThreat.probability) {
          topThreat = { teamName, probability: Number(threatProbability.toFixed(3)) };
        }
      }
    }
    return {
      matchKey: player.matchKey,
      playerId: player.playerId,
      fullName: player.fullName,
      position: player.position,
      team: player.team,
      adp: player.adp,
      byeWeek: player.byeWeek,
      injuryStatus: player.injuryStatus,
      survivalProbability: Number(probability.toFixed(3)),
      rawSurvivalProbability: Number(rawProbability.toFixed(3)),
      verdict: verdictFor(probability),
      topThreat: topThreat && topThreat.probability > 0.05 ? topThreat : undefined,
    };
  });

  const threats: SurvivalThreat[] = interveningPicks.map((overall) => {
    const { teamName, ownerId, round } = teamOnTheClock(board, overall);
    const profile = board.profilesByOwnerId.get(ownerId);
    const counts = positionPicked.get(overall) ?? {};
    const positionOdds: Partial<Record<Position, number>> = {};
    for (const [position, count] of Object.entries(counts)) {
      positionOdds[position as Position] = Number(((count ?? 0) / samples).toFixed(3));
    }
    return {
      overallPick: overall,
      round,
      teamName,
      ownerId,
      confidence: profile?.confidence ?? 0,
      seasons: profile?.seasons.length ?? 0,
      positionOdds,
      tells: (profile?.tells ?? []).slice(0, 2).map((tell) => tell.label),
    };
  });

  const notes: string[] = [];
  if (onTheClock) {
    notes.push(`Survival is to your next turn at pick ${targetPick}, assuming you spend this pick on someone else.`);
  }
  if (candidates.length === candidateDepth) {
    notes.push(`Covers the top ${candidateDepth} available players by ADP.`);
  }

  return {
    fromPick,
    targetPick,
    picksSimulated: interveningPicks.length,
    samples,
    assumesCurrentPickSpent: onTheClock,
    players: players.sort((left, right) => left.adp - right.adp),
    threats,
    note: notes.length > 0 ? notes.join(' ') : undefined,
  };
}
