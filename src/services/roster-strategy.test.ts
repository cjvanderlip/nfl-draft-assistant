import { describe, expect, it } from 'vitest';

import { buildStrategyAwareRecommendations } from './roster-strategy.js';

describe('buildStrategyAwareRecommendations', () => {
  it('prioritizes positions that fit strategy and remaining roster slots', () => {
    const result = buildStrategyAwareRecommendations({
      strategyProfile: 'HERO_RB',
      starters: { RB: 2, WR: 2, QB: 1, TE: 1 },
      draftedPlayers: [{ playerId: 'rb-a', position: 'RB' }],
      candidates: [
        { playerId: 'wr-1', position: 'WR', compositeScore: 0.6 },
        { playerId: 'rb-1', position: 'RB', compositeScore: 0.4 },
        { playerId: 'qb-1', position: 'QB', compositeScore: 0.8 },
      ],
    });

    expect(result.slotsRemaining).toMatchObject({ RB: 1, WR: 2, QB: 1, TE: 1 });
    expect(result.recommendations[0]).toMatchObject({
      playerId: 'wr-1',
      strategyFit: 'ON_STRATEGY',
    });
    expect(result.priorityPositions.slice(0, 2)).toEqual(['RB', 'WR']);
  });

  it('flags candidates that violate roster caps', () => {
    const result = buildStrategyAwareRecommendations({
      strategyProfile: 'BALANCED',
      starters: { WR: 2 },
      draftedPlayers: [
        { playerId: 'wr-a', position: 'WR' },
        { playerId: 'wr-b', position: 'WR' },
      ],
      maxPerPosition: { WR: 2 },
      candidates: [{ playerId: 'wr-1', position: 'WR', compositeScore: 1 }],
    });

    expect(result.recommendations[0]).toMatchObject({
      playerId: 'wr-1',
      strategyFit: 'CONSTRAINED',
    });
  });
});
