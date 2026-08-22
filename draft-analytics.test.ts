import { describe, expect, it } from 'vitest';

import { DraftPick } from './draft-models.js';
import { averagePickByTeam, summarizeDraftSession } from './draft-analytics.js';

describe('averagePickByTeam', () => {
  it('returns average overall picks per team in sort order', () => {
    const picks = [
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 12, managerId: 'm1', playerId: 'p1' }),
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 20, managerId: 'm2', playerId: 'p2' }),
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 2, overallPick: 33, managerId: 'm3', playerId: 'p3' }),
    ];

    const summary = averagePickByTeam(picks, {
      p1: 'BUF',
      p2: 'BUF',
      p3: 'KC',
    });

    expect(summary).toEqual([
      { team: 'BUF', averagePick: 16, totalPicks: 2 },
      { team: 'KC', averagePick: 33, totalPicks: 1 },
    ]);
  });

  it('ignores player IDs not present in the team map', () => {
    const picks = [
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 5, managerId: 'm1', playerId: 'p1' }),
    ];

    expect(averagePickByTeam(picks, {})).toEqual([]);
  });
});

describe('summarizeDraftSession', () => {
  it('returns a draft session summary payload', () => {
    expect(summarizeDraftSession({
      leagueId: 'league-1',
      status: 'LIVE',
      totalPicks: 12,
      strategyProfile: 'BALANCED',
      currentPick: 14,
    })).toEqual({
      leagueId: 'league-1',
      status: 'LIVE',
      currentPick: 14,
      totalPicks: 12,
      strategyProfile: 'BALANCED',
    });
  });

  it('throws for invalid status values', () => {
    expect(() => summarizeDraftSession({
      leagueId: 'league-1',
      status: 'INVALID' as never,
      totalPicks: 1,
      strategyProfile: 'BALANCED',
    })).toThrow(TypeError);
  });
});
