import { describe, expect, it } from 'vitest';

import { DraftPick } from './draft-models.js';
import { buildDraftRecommendations, buildDraftSessionSnapshot } from './draft-service.js';

describe('buildDraftRecommendations', () => {
  it('marks RB-heavy strategy picks as on-strategy', () => {
    const picks = [
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' }),
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 2, managerId: 'm2', playerId: 'p2' }),
    ];

    const recommendations = buildDraftRecommendations(
      picks,
      {
        p1: { team: 'BUF', position: 'RB' },
        p2: { team: 'KC', position: 'WR' },
      },
      'HERO_RB',
      2,
    );

    expect(recommendations[0]).toMatchObject({
      playerId: 'p1',
      strategyFit: 'ON_STRATEGY',
      position: 'RB',
    });
    expect(recommendations[1]).toMatchObject({
      playerId: 'p2',
      strategyFit: 'OFF_STRATEGY',
      position: 'WR',
    });
  });

  it('ignores picks beyond the 5-pick window', () => {
    const picks = [
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 4, overallPick: 30, managerId: 'm1', playerId: 'p1' }),
    ];

    const recommendations = buildDraftRecommendations(
      picks,
      { p1: { team: 'BUF', position: 'RB' } },
      'HERO_RB',
      2,
    );

    expect(recommendations).toEqual([]);
  });
});

describe('buildDraftSessionSnapshot', () => {
  it('summarizes the current league state', () => {
    const picks = [
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' }),
      new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 2, managerId: 'm2', playerId: 'p2' }),
    ];

    expect(buildDraftSessionSnapshot({
      leagueId: 'league-1',
      status: 'LIVE',
      currentPick: 3,
      strategyProfile: 'BALANCED',
      picks,
    })).toEqual({
      leagueId: 'league-1',
      status: 'LIVE',
      currentPick: 3,
      strategyProfile: 'BALANCED',
      totalPicks: 2,
      averagePickPosition: 1.5,
    });
  });

  it('throws for invalid input status values', () => {
    expect(() => buildDraftSessionSnapshot({
      leagueId: 'league-1',
      status: 'INVALID' as never,
      currentPick: 3,
      strategyProfile: 'BALANCED',
      picks: [],
    })).toThrow(TypeError);
  });
});
