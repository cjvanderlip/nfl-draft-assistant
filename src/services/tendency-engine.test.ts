import { describe, expect, it } from 'vitest';

import { DraftPick } from '../../draft-models.js';
import { computeManagerTendencies } from './tendency-engine.js';

describe('computeManagerTendencies', () => {
  it('computes position rates, rounds, reach, and confidence', () => {
    const picks = [
      new DraftPick({ id: 'pick-1', leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'manager-1', playerId: 'rb-1', reachDelta: 4 }),
      new DraftPick({ id: 'pick-2', leagueId: 'league-1', season: 2025, round: 3, overallPick: 25, managerId: 'manager-1', playerId: 'rb-2', reachDelta: 2 }),
      new DraftPick({ id: 'pick-3', leagueId: 'league-1', season: 2025, round: 2, overallPick: 14, managerId: 'manager-1', playerId: 'wr-1' }),
    ];

    const [profile] = computeManagerTendencies(picks, {
      'rb-1': { position: 'RB' },
      'rb-2': { position: 'RB' },
      'wr-1': { position: 'WR' },
    });

    expect(profile).toMatchObject({
      managerId: 'manager-1',
      averageReach: 3,
      confidence: 0.15,
      positionBias: {
        RB: { avgRound: 2, avgReach: 3, pickRate: 0.6667 },
        WR: { avgRound: 2, avgReach: 0, pickRate: 0.3333 },
      },
    });
  });
});
