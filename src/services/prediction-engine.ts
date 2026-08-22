import type { ManagerTendencyProfile } from '../../draft-models.js';
import type { Position } from '../../validators.js';
import { assertArray, assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface PredictionCandidate {
  playerId: string;
  position: Position;
  rank: number;
}

export interface PlayerPrediction {
  playerId: string;
  probability: number;
}

export interface PredictionResult {
  managerId: string;
  topPredictions: PlayerPrediction[];
  positionProbabilities: Record<Position, number>;
}

export interface HistoricalPredictionPick {
  managerId: string;
  playerId: string;
  position: Position;
  overallPick: number;
  rank?: number;
}

export interface PredictionBacktestResult {
  totalEvaluated: number;
  topOneHitRate: number;
  topThreeHitRate: number;
  positionAccuracy: number;
  averageActualPickProbability: number;
}

const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

/**
 * Predict the next picks for a manager from available players and historical tendencies.
 *
 * @param managerId - Manager expected to pick next.
 * @param candidates - Available players with rank and position.
 * @param tendencyProfile - Optional historical manager profile.
 * @returns Top-three player predictions and position probabilities.
 */
export function predictNextPicks(
  managerId: string,
  candidates: PredictionCandidate[],
  tendencyProfile?: ManagerTendencyProfile,
): PredictionResult {
  assertNonEmptyString(managerId, 'managerId');
  assertArray(candidates, 'candidates');
  if (tendencyProfile !== undefined) {
    assertObject(tendencyProfile, 'tendencyProfile');
  }

  const scoredCandidates = candidates.map((candidate) => {
    assertObject(candidate, 'candidate');
    assertNonEmptyString(candidate.playerId, 'candidate.playerId');
    assertNumberInRange(candidate.rank, 'candidate.rank', 1, 1000);
    if (!positions.includes(candidate.position)) {
      throw new TypeError(`candidate.position must be one of: ${positions.join(', ')}.`);
    }
    const positionBias = tendencyProfile?.positionBias[candidate.position]?.pickRate ?? 1 / positions.length;
    return {
      candidate,
      score: (1 / candidate.rank) * (0.5 + positionBias),
    };
  }).sort((left, right) => right.score - left.score);

  const totalScore = scoredCandidates.reduce((sum, entry) => sum + entry.score, 0);
  const positionScores = Object.fromEntries(positions.map((position) => [position, 0])) as Record<Position, number>;
  for (const entry of scoredCandidates) {
    positionScores[entry.candidate.position] += entry.score;
  }

  const positionProbabilities = Object.fromEntries(
    positions.map((position) => [
      position,
      totalScore === 0 ? 0 : Number((positionScores[position] / totalScore).toFixed(4)),
    ]),
  ) as Record<Position, number>;

  return {
    managerId: managerId.trim(),
    topPredictions: scoredCandidates.slice(0, 3).map(({ candidate, score }) => ({
      playerId: candidate.playerId,
      probability: totalScore === 0 ? 0 : Number((score / totalScore).toFixed(4)),
    })),
    positionProbabilities,
  };
}

/**
 * Backtest prediction accuracy against historical draft selections.
 *
 * @param picks - Ordered historical picks from a completed draft.
 * @param tendencyProfiles - Manager tendency profiles keyed by manager ID.
 * @returns Aggregated hit rates and probability calibration metrics.
 */
export function backtestPredictions(
  picks: HistoricalPredictionPick[],
  tendencyProfiles: Partial<Record<string, ManagerTendencyProfile>> = {},
): PredictionBacktestResult {
  assertArray(picks, 'picks');
  assertObject(tendencyProfiles, 'tendencyProfiles');

  if (picks.length < 2) {
    throw new TypeError('picks must include at least two rows for backtesting.');
  }

  let topOneHits = 0;
  let topThreeHits = 0;
  let positionHits = 0;
  let probabilitySum = 0;
  let totalEvaluated = 0;

  for (let index = 0; index < picks.length - 1; index += 1) {
    const actualPick = picks[index];
    assertObject(actualPick, `picks[${index}]`);
    assertNonEmptyString(actualPick.managerId, `picks[${index}].managerId`);
    assertNonEmptyString(actualPick.playerId, `picks[${index}].playerId`);
    assertNumberInRange(actualPick.overallPick, `picks[${index}].overallPick`, 1, 600);
    if (!positions.includes(actualPick.position)) {
      throw new TypeError(`picks[${index}].position must be one of: ${positions.join(', ')}.`);
    }

    const candidateWindow = picks.slice(index).map((pick, candidateIndex) => {
      assertObject(pick, `candidateWindow[${candidateIndex}]`);
      assertNonEmptyString(pick.playerId, `candidateWindow[${candidateIndex}].playerId`);
      assertNumberInRange(
        pick.rank ?? pick.overallPick,
        `candidateWindow[${candidateIndex}].rank`,
        1,
        1000,
      );
      if (!positions.includes(pick.position)) {
        throw new TypeError(`candidateWindow[${candidateIndex}].position must be one of: ${positions.join(', ')}.`);
      }
      return {
        playerId: pick.playerId,
        position: pick.position,
        rank: pick.rank ?? pick.overallPick,
      };
    });

    const prediction = predictNextPicks(
      actualPick.managerId,
      candidateWindow,
      tendencyProfiles[actualPick.managerId],
    );

    totalEvaluated += 1;
    const topPrediction = prediction.topPredictions[0];
    if (topPrediction && topPrediction.playerId === actualPick.playerId) {
      topOneHits += 1;
    }
    if (prediction.topPredictions.some((entry) => entry.playerId === actualPick.playerId)) {
      topThreeHits += 1;
    }

    const likelyPosition = positions.reduce((best, position) => (
      prediction.positionProbabilities[position] > prediction.positionProbabilities[best] ? position : best
    ), positions[0]);
    if (likelyPosition === actualPick.position) {
      positionHits += 1;
    }

    const actualPrediction = prediction.topPredictions.find((entry) => entry.playerId === actualPick.playerId);
    probabilitySum += actualPrediction?.probability ?? 0;
  }

  return {
    totalEvaluated,
    topOneHitRate: Number((topOneHits / totalEvaluated).toFixed(4)),
    topThreeHitRate: Number((topThreeHits / totalEvaluated).toFixed(4)),
    positionAccuracy: Number((positionHits / totalEvaluated).toFixed(4)),
    averageActualPickProbability: Number((probabilitySum / totalEvaluated).toFixed(4)),
  };
}
