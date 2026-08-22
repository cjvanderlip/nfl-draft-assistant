import { describe, expect, it } from 'vitest';

import { scoreHeuristicsFromPayload } from './heuristics.js';

describe('scoreHeuristicsFromPayload', () => {
  it('scores candidates and returns effective weights', () => {
    const result = scoreHeuristicsFromPayload({
      candidates: [
        {
          playerId: 'p1',
          baseRank: 5,
          signals: {
            contractYear: 0.5,
            targetShareVolatility: 0.2,
            olineUpgrade: 0,
            rzRegression: 0.1,
            gameScriptLeverage: 0.1,
          },
        },
      ],
      weightOverrides: {
        contractYearBump: 0.7,
      },
    });

    expect(result.weights.contractYearBump).toBe(0.7);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].playerId).toBe('p1');
  });
});
