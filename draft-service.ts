/**
 * Draft services for turning raw pick events into operational recommendations.
 */

import { DraftPick } from './draft-models.js';
import {
  assertArray,
  assertNonEmptyString,
  assertNumberInRange,
  assertObject,
  assertStrategyProfile,
  type StrategyProfile,
} from './validators.js';

export interface DraftRecommendation {
  playerId: string;
  team: string;
  position: string;
  overallPick: number;
  strategyFit: 'ON_STRATEGY' | 'OFF_STRATEGY';
  reason: string;
}

/**
 * Build draft recommendations based on a strategy profile and the current pick window.
 *
 * @param picks - Draft picks observed so far.
 * @param playerMetadata - Lookup of player IDs to team and position metadata.
 * @param strategyProfile - Strategy profile to evaluate against.
 * @param currentPick - Current draft pick number.
 * @returns Recommendations fitted to the selected draft strategy.
 *
 * @example
 * const recommendations = buildDraftRecommendations(
 *   [new DraftPick({ leagueId: 'l1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' })],
 *   { p1: { team: 'BUF', position: 'QB' } },
 *   'BALANCED',
 *   2,
 * );
 *
 * @example
 * const recommendations = buildDraftRecommendations([], {}, 'HERO_RB', 3);
 */
export function buildDraftRecommendations(
  picks: DraftPick[],
  playerMetadata: Record<string, { team: string; position: string }>,
  strategyProfile: StrategyProfile,
  currentPick: number,
): DraftRecommendation[] {
  assertArray(picks, 'picks');
  assertObject(playerMetadata, 'playerMetadata');
  assertStrategyProfile(strategyProfile, 'strategyProfile');
  assertNumberInRange(currentPick, 'currentPick', 1, 600);

  const positionBiasMap: Record<StrategyProfile, string[]> = {
    HERO_RB: ['RB'],
    ZERO_RB: ['WR', 'TE', 'QB'],
    BALANCED: ['RB', 'WR', 'QB'],
    ANCHOR_WR: ['WR'],
    LATE_QB: ['QB'],
  };

  const recommendations: DraftRecommendation[] = [];

  for (const pick of picks) {
    const player = playerMetadata[pick.playerId];
    if (!player) {
      continue;
    }

    const isOnStrategy = positionBiasMap[strategyProfile].includes(player.position);
    const relativeWindow = Math.abs(pick.overallPick - currentPick);

    if (relativeWindow > 5) {
      continue;
    }

    recommendations.push({
      playerId: pick.playerId,
      team: player.team,
      position: player.position,
      overallPick: pick.overallPick,
      strategyFit: isOnStrategy ? 'ON_STRATEGY' : 'OFF_STRATEGY',
      reason: isOnStrategy
        ? `${player.position} is aligned with the ${strategyProfile} profile.`
        : `${player.position} does not match the ${strategyProfile} profile and may be a value trap.`,
    });
  }

  return recommendations.sort((left, right) => left.overallPick - right.overallPick);
}

/**
 * Compose a draft session snapshot that can be rendered to a live board.
 *
 * @param leagueId - League identifier.
 * @param status - Current session status.
 * @param currentPick - Current pick number.
 * @param strategyProfile - Selected strategy profile.
 * @param picks - All picks already observed.
 * @returns A summary object for live draft UI rendering.
 */
export function buildDraftSessionSnapshot({
  leagueId,
  status,
  currentPick,
  strategyProfile,
  picks,
}: {
  leagueId: string;
  status: 'PRE_DRAFT' | 'LIVE' | 'COMPLETE';
  currentPick: number;
  strategyProfile: StrategyProfile;
  picks: DraftPick[];
}): {
  leagueId: string;
  status: 'PRE_DRAFT' | 'LIVE' | 'COMPLETE';
  currentPick: number;
  strategyProfile: StrategyProfile;
  totalPicks: number;
  averagePickPosition: number;
} {
  assertNonEmptyString(leagueId, 'leagueId');
  assertStrategyProfile(strategyProfile, 'strategyProfile');
  assertArray(picks, 'picks');
  assertNumberInRange(currentPick, 'currentPick', 1, 600);

  if (status !== 'PRE_DRAFT' && status !== 'LIVE' && status !== 'COMPLETE') {
    throw new TypeError('status must be PRE_DRAFT, LIVE, or COMPLETE.');
  }

  const totalPicks = picks.length;
  const averagePickPosition = totalPicks === 0
    ? 0
    : Number((picks.reduce((sum, pick) => sum + pick.overallPick, 0) / totalPicks).toFixed(2));

  return {
    leagueId,
    status,
    currentPick,
    strategyProfile,
    totalPicks,
    averagePickPosition,
  };
}
