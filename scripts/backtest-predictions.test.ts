import { describe, expect, it } from 'vitest';

import { buildBacktestInput } from './backtest-predictions.js';

describe('buildBacktestInput', () => {
  it('builds ordered, position-aware picks for backtesting', () => {
    const picks = buildBacktestInput({
      sourceFile: '2025.csv',
      picks: [
        { managerId: 'm2', playerId: 'p2', overallPick: 2 },
        { managerId: 'm1', playerId: 'p1', overallPick: 1 },
      ],
      players: {
        p1: { position: 'RB' },
        p2: { position: 'WR' },
      },
    });

    expect(picks).toEqual([
      { managerId: 'm1', playerId: 'p1', position: 'RB', overallPick: 1 },
      { managerId: 'm2', playerId: 'p2', position: 'WR', overallPick: 2 },
    ]);
  });
});
