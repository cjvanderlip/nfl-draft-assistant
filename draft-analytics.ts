/**
 * Analytics helpers for draft trend analysis and roster strategy summaries.
 */

import { DraftPick, type DraftStatus } from './draft-models.js';
import { assertArray, assertNonEmptyString, assertObject } from './validators.js';

export interface TeamAveragePickSummary {
  team: string;
  averagePick: number;
  totalPicks: number;
}

export interface DraftSessionSummary {
  leagueId: string;
  status: DraftStatus;
  currentPick?: number;
  totalPicks: number;
  strategyProfile: string;
}

/**
 * Build average overall pick by team using the provided map of player IDs to teams.
 *
 * @param picks - Draft picks being summarized.
 * @param playerTeams - Lookup from playerId to team abbreviation.
 * @returns Team-level average pick summaries sorted by average pick.
 *
 * @example
 * const summary = averagePickByTeam([
 *   new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' }),
 * ], { p1: 'BUF' });
 *
 * @example
 * const summary = averagePickByTeam([], {});
 */
export function averagePickByTeam(
  picks: DraftPick[],
  playerTeams: Record<string, string>,
): TeamAveragePickSummary[] {
  assertArray(picks, 'picks');
  assertObject(playerTeams, 'playerTeams');

  const totals = new Map<string, { totalPick: number; count: number }>();

  for (const pick of picks) {
    const team = playerTeams[pick.playerId];
    if (!team) {
      continue;
    }

    const existing = totals.get(team) ?? { totalPick: 0, count: 0 };
    existing.totalPick += pick.overallPick;
    existing.count += 1;
    totals.set(team, existing);
  }

  return Array.from(totals.entries())
    .map(([team, summary]) => ({
      team,
      averagePick: Number((summary.totalPick / summary.count).toFixed(2)),
      totalPicks: summary.count,
    }))
    .sort((left, right) => left.averagePick - right.averagePick);
}

/**
 * Summarize a draft session into an operational snapshot.
 *
 * @param leagueId - League identifier.
 * @param status - Draft status.
 * @param totalPicks - Number of picks already recorded.
 * @param strategyProfile - Selected strategy profile.
 * @param currentPick - Current pick number if the league is live.
 * @returns A session summary payload.
 */
export function summarizeDraftSession({
  leagueId,
  status,
  totalPicks,
  strategyProfile,
  currentPick,
}: {
  leagueId: string;
  status: DraftStatus;
  totalPicks: number;
  strategyProfile: string;
  currentPick?: number;
}): DraftSessionSummary {
  assertNonEmptyString(leagueId, 'leagueId');
  if (status !== 'PRE_DRAFT' && status !== 'LIVE' && status !== 'COMPLETE') {
    throw new TypeError('status must be PRE_DRAFT, LIVE, or COMPLETE.');
  }
  if (typeof totalPicks !== 'number' || Number.isNaN(totalPicks) || totalPicks < 0) {
    throw new TypeError('totalPicks must be a non-negative number.');
  }
  assertNonEmptyString(strategyProfile, 'strategyProfile');
  if (currentPick !== undefined && (!Number.isInteger(currentPick) || currentPick < 1)) {
    throw new TypeError('currentPick must be a positive integer when provided.');
  }

  return {
    leagueId,
    status,
    currentPick,
    totalPicks,
    strategyProfile,
  };
}
