import { describe, expect, it } from 'vitest';

import { buildHeuristicWeights, scoreCandidatesWithHeuristics } from './heuristic-scorer.js';

describe('buildHeuristicWeights', () => {
  it('merges overrides into defaults', () => {
    const weights = buildHeuristicWeights({
      contractYearBump: 0.2,
      targetShareVolatility: 0.1,
      olineUpgrade: 0.05,
      rzRegression: 0.15,
      gameScriptLeverage: 0.08,
    }, {
      contractYearBump: 0.4,
    });

    expect(weights.contractYearBump).toBe(0.4);
    expect(weights.rzRegression).toBe(0.15);
  });
});

describe('scoreCandidatesWithHeuristics', () => {
  it('scores and reranks players using configurable heuristic weights', () => {
    const scored = scoreCandidatesWithHeuristics([
      {
        playerId: 'player-1',
        baseRank: 10,
        signals: {
          contractYear: 0.8,
          targetShareVolatility: 0.2,
          olineUpgrade: 0.3,
          rzRegression: 0.2,
          gameScriptLeverage: 0.1,
        },
      },
      {
        playerId: 'player-2',
        baseRank: 8,
        signals: {
          contractYear: 0.1,
          targetShareVolatility: 0.1,
          olineUpgrade: 0.1,
          rzRegression: 0.1,
          gameScriptLeverage: 0.1,
        },
      },
    ], {
      contractYearBump: 0.6,
      targetShareVolatility: 0.1,
      olineUpgrade: 0.1,
      rzRegression: 0.1,
      gameScriptLeverage: 0.1,
    });

    expect(scored[0].playerId).toBe('player-1');
    expect(scored[0].adjustedRank).toBe(1);
    expect(scored[1].adjustedRank).toBe(2);
    expect(scored[0].weightedContributions.contractYear).toBe(0.48);
  });

  it('rejects out-of-range signal values', () => {
    expect(() => scoreCandidatesWithHeuristics([{
      playerId: 'player-1',
      baseRank: 10,
      signals: {
        contractYear: 2,
        targetShareVolatility: 0,
        olineUpgrade: 0,
        rzRegression: 0,
        gameScriptLeverage: 0,
      },
    }], {
      contractYearBump: 1,
      targetShareVolatility: 1,
      olineUpgrade: 1,
      rzRegression: 1,
      gameScriptLeverage: 1,
    })).toThrow('contractYear');
  });
});
