import { describe, expect, it } from 'vitest';

import { calculatePlayerExposure } from './exposure-service.js';

describe('calculatePlayerExposure', () => {
  it('aggregates shares, leagues, and concentration risk', () => {
    const result = calculatePlayerExposure([
      { userId: 'user-1', playerId: 'player-1', leagueId: 'league-b', season: 2025, rosterSlot: 'RB' },
      { userId: 'user-1', playerId: 'player-1', leagueId: 'league-a', season: 2025, rosterSlot: 'RB' },
      { userId: 'user-1', playerId: 'player-1', leagueId: 'league-a', season: 2024, rosterSlot: 'RB' },
    ], 3);

    expect(result).toEqual([{
      playerId: 'player-1',
      shareCount: 3,
      leagues: ['league-a', 'league-b'],
      diversificationRisk: 'HIGH',
    }]);
  });

  it('returns low risk for a single share', () => {
    expect(calculatePlayerExposure([
      { userId: 'user-1', playerId: 'player-1', leagueId: 'league-a', season: 2025, rosterSlot: 'WR' },
    ])).toMatchObject([{ playerId: 'player-1', shareCount: 1, diversificationRisk: 'LOW' }]);
  });
});
