import { describe, expect, it } from 'vitest';

import { scoreRosterFromPayload } from './roster.js';

describe('scoreRosterFromPayload', () => {
  it('returns strategy-aware roster recommendations', () => {
    const result = scoreRosterFromPayload({
      strategyProfile: 'BALANCED',
      starters: { RB: 2, WR: 2, QB: 1 },
      draftedPlayers: [{ playerId: 'rb-a', position: 'RB' }],
      candidates: [
        { playerId: 'wr-1', position: 'WR', compositeScore: 0.8 },
        { playerId: 'rb-1', position: 'RB', compositeScore: 0.4 },
      ],
    });

    expect(result.strategyProfile).toBe('BALANCED');
    expect(result.slotsRemaining).toMatchObject({ RB: 1, WR: 2, QB: 1 });
    expect(result.recommendations[0].strategyFit).toBe('ON_STRATEGY');
  });
});
