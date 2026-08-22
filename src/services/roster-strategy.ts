import { assertArray, assertNonEmptyString, assertNumberInRange, assertObject, assertPosition, assertStrategyProfile, type Position, type StrategyProfile } from '../../validators.js';

export interface StrategyCandidate {
  playerId: string;
  position: Position;
  compositeScore: number;
}

export interface DraftedPlayer {
  playerId: string;
  position: Position;
}

export interface RosterRecommendation {
  playerId: string;
  position: Position;
  strategyFit: 'ON_STRATEGY' | 'OFF_STRATEGY' | 'CONSTRAINED';
  score: number;
  reason: string;
}

export interface StrategyRosterEvaluation {
  strategyProfile: StrategyProfile;
  slotsRemaining: Partial<Record<Position, number>>;
  priorityPositions: Position[];
  recommendations: RosterRecommendation[];
}

/**
 * Evaluate roster state for a strategy and produce strategy-aware pick recommendations.
 *
 * @param strategyProfile - Selected strategy profile.
 * @param starters - Required starter slots by position.
 * @param draftedPlayers - Current roster selections.
 * @param candidates - Candidate players scored by recommendation engines.
 * @param maxPerPosition - Optional hard caps by position.
 * @returns Remaining slots, priority positions, and ranked recommendations.
 */
export function buildStrategyAwareRecommendations({
  strategyProfile,
  starters,
  draftedPlayers,
  candidates,
  maxPerPosition = {},
}: {
  strategyProfile: StrategyProfile;
  starters: Partial<Record<Position, number>>;
  draftedPlayers: DraftedPlayer[];
  candidates: StrategyCandidate[];
  maxPerPosition?: Partial<Record<Position, number>>;
}): StrategyRosterEvaluation {
  assertStrategyProfile(strategyProfile, 'strategyProfile');
  assertObject(starters, 'starters');
  assertArray(draftedPlayers, 'draftedPlayers');
  assertArray(candidates, 'candidates');
  assertObject(maxPerPosition, 'maxPerPosition');

  const strategyPriorities: Record<StrategyProfile, Position[]> = {
    HERO_RB: ['RB', 'WR', 'TE', 'QB', 'K', 'DST'],
    ZERO_RB: ['WR', 'TE', 'QB', 'RB', 'K', 'DST'],
    BALANCED: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
    ANCHOR_WR: ['WR', 'RB', 'TE', 'QB', 'K', 'DST'],
    LATE_QB: ['RB', 'WR', 'TE', 'QB', 'K', 'DST'],
  };

  const draftedCounts: Partial<Record<Position, number>> = {};
  for (const draftedPlayer of draftedPlayers) {
    assertObject(draftedPlayer, 'draftedPlayer');
    assertNonEmptyString(draftedPlayer.playerId, 'draftedPlayer.playerId');
    assertPosition(draftedPlayer.position, 'draftedPlayer.position');
    draftedCounts[draftedPlayer.position] = (draftedCounts[draftedPlayer.position] ?? 0) + 1;
  }

  const slotsRemaining: Partial<Record<Position, number>> = {};
  for (const [position, total] of Object.entries(starters)) {
    assertPosition(position, `starters.${position}`);
    assertNumberInRange(total, `starters.${position}`, 0, 20);
    slotsRemaining[position] = Math.max(0, total - (draftedCounts[position] ?? 0));
  }

  for (const [position, cap] of Object.entries(maxPerPosition)) {
    if (cap === undefined) {
      continue;
    }
    assertPosition(position, `maxPerPosition.${position}`);
    assertNumberInRange(cap, `maxPerPosition.${position}`, 0, 20);
  }

  const recommendations: RosterRecommendation[] = candidates.map((candidate, index) => {
    assertObject(candidate, `candidates[${index}]`);
    assertNonEmptyString(candidate.playerId, `candidates[${index}].playerId`);
    assertPosition(candidate.position, `candidates[${index}].position`);
    assertNumberInRange(candidate.compositeScore, `candidates[${index}].compositeScore`, -200, 200);

    const draftedAtPosition = draftedCounts[candidate.position] ?? 0;
    const maxAllowed = maxPerPosition[candidate.position];
    if (maxAllowed !== undefined && draftedAtPosition >= maxAllowed) {
      return {
        playerId: candidate.playerId,
        position: candidate.position,
        strategyFit: 'CONSTRAINED' as const,
        score: Number((candidate.compositeScore - 5).toFixed(4)),
        reason: `${candidate.position} is already at the configured roster cap.`,
      };
    }

    const priorityIndex = strategyPriorities[strategyProfile].indexOf(candidate.position);
    const remainingAtPosition = slotsRemaining[candidate.position] ?? 0;
    const priorityBoost = priorityIndex < 0 ? -0.3 : Math.max(0, (3 - priorityIndex) * 0.1);
    const slotBoost = remainingAtPosition > 0 ? 0.4 : 0;
    const strategyFit: RosterRecommendation['strategyFit'] = priorityIndex <= 1 || remainingAtPosition > 0
      ? 'ON_STRATEGY'
      : 'OFF_STRATEGY';

    return {
      playerId: candidate.playerId,
      position: candidate.position,
      strategyFit,
      score: Number((candidate.compositeScore + priorityBoost + slotBoost).toFixed(4)),
      reason: strategyFit === 'ON_STRATEGY'
        ? `${candidate.position} supports ${strategyProfile} and current roster needs.`
        : `${candidate.position} is currently lower priority for ${strategyProfile}.`,
    };
  }).sort((left, right) => right.score - left.score);

  return {
    strategyProfile,
    slotsRemaining: { ...slotsRemaining },
    priorityPositions: [...strategyPriorities[strategyProfile]],
    recommendations,
  };
}
