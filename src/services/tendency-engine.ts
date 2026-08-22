import { DraftPick, type ManagerTendencyProfile } from '../../draft-models.js';
import { assertArray, assertObject } from '../../validators.js';

export type TendencyPlayerMetadata = Record<string, { position: string }>;

/**
 * Compute manager tendency profiles from historical draft picks.
 *
 * @param picks - Historical picks to aggregate.
 * @param playerMetadata - Player position lookup keyed by player ID.
 * @returns One tendency profile per manager ID.
 */
export function computeManagerTendencies(
  picks: DraftPick[],
  playerMetadata: TendencyPlayerMetadata,
): ManagerTendencyProfile[] {
  assertArray(picks, 'picks');
  assertObject(playerMetadata, 'playerMetadata');

  const managerPicks = new Map<string, DraftPick[]>();
  for (const pick of picks) {
    const managerHistory = managerPicks.get(pick.managerId) ?? [];
    managerHistory.push(pick);
    managerPicks.set(pick.managerId, managerHistory);
  }

  const computedAt = new Date().toISOString();
  return [...managerPicks.entries()].map(([managerId, history]) => {
    const positionStats = new Map<string, { count: number; totalRound: number; totalReach: number; reachCount: number }>();
    for (const pick of history) {
      const position = playerMetadata[pick.playerId]?.position;
      if (!position) {
        continue;
      }
      const stats = positionStats.get(position) ?? { count: 0, totalRound: 0, totalReach: 0, reachCount: 0 };
      stats.count += 1;
      stats.totalRound += pick.round;
      if (pick.reachDelta !== undefined) {
        stats.totalReach += pick.reachDelta;
        stats.reachCount += 1;
      }
      positionStats.set(position, stats);
    }

    const positionBias: ManagerTendencyProfile['positionBias'] = {};
    for (const [position, stats] of positionStats) {
      positionBias[position as keyof ManagerTendencyProfile['positionBias']] = {
        avgRound: Number((stats.totalRound / stats.count).toFixed(2)),
        avgReach: stats.reachCount === 0 ? 0 : Number((stats.totalReach / stats.reachCount).toFixed(2)),
        pickRate: Number((stats.count / history.length).toFixed(4)),
      };
    }

    const reachValues = history.flatMap((pick) => pick.reachDelta === undefined ? [] : [pick.reachDelta]);
    return {
      managerId,
      positionBias,
      positionalRunPatterns: [],
      averageReach: reachValues.length === 0
        ? 0
        : Number((reachValues.reduce((sum, value) => sum + value, 0) / reachValues.length).toFixed(2)),
      confidence: Number(Math.min(1, history.length / 20).toFixed(2)),
      lastComputedAt: computedAt,
    };
  });
}
