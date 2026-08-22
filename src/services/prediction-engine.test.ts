import { describe, expect, it } from 'vitest';

import { backtestPredictions, predictNextPicks } from './prediction-engine.js';

describe('predictNextPicks', () => {
  it('returns up to three ranked predictions and position probabilities', () => {
    const result = predictNextPicks('manager-1', [
      { playerId: 'wr-1', position: 'WR', rank: 8 },
      { playerId: 'rb-1', position: 'RB', rank: 12 },
      { playerId: 'qb-1', position: 'QB', rank: 30 },
      { playerId: 'te-1', position: 'TE', rank: 40 },
    ]);

    expect(result.managerId).toBe('manager-1');
    expect(result.topPredictions).toHaveLength(3);
    expect(result.topPredictions[0].playerId).toBe('wr-1');
    expect(result.positionProbabilities.WR).toBeGreaterThan(result.positionProbabilities.TE);
  });

  it('uses manager position bias when ranking equal candidates', () => {
    const result = predictNextPicks('manager-1', [
      { playerId: 'wr-1', position: 'WR', rank: 10 },
      { playerId: 'rb-1', position: 'RB', rank: 10 },
    ], {
      managerId: 'manager-1',
      positionBias: {
        RB: { avgRound: 1, avgReach: 0, pickRate: 0.8 },
        WR: { avgRound: 1, avgReach: 0, pickRate: 0.2 },
      },
      positionalRunPatterns: [],
      averageReach: 0,
      confidence: 1,
      lastComputedAt: new Date().toISOString(),
    });

    expect(result.topPredictions[0].playerId).toBe('rb-1');
  });
});

describe('backtestPredictions', () => {
  it('computes hit rates and calibration metrics from historical picks', () => {
    const result = backtestPredictions([
      { managerId: 'manager-1', playerId: 'rb-1', position: 'RB', overallPick: 1 },
      { managerId: 'manager-2', playerId: 'wr-1', position: 'WR', overallPick: 2 },
      { managerId: 'manager-3', playerId: 'qb-1', position: 'QB', overallPick: 3 },
      { managerId: 'manager-4', playerId: 'te-1', position: 'TE', overallPick: 4 },
    ]);

    expect(result).toEqual({
      totalEvaluated: 3,
      topOneHitRate: 1,
      topThreeHitRate: 1,
      positionAccuracy: 1,
      averageActualPickProbability: expect.any(Number),
    });
    expect(result.averageActualPickProbability).toBeGreaterThan(0);
  });

  it('requires at least two picks to run a backtest', () => {
    expect(() => backtestPredictions([
      { managerId: 'manager-1', playerId: 'rb-1', position: 'RB', overallPick: 1 },
    ])).toThrow('at least two');
  });
});
