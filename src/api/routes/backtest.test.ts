import { describe, expect, it } from 'vitest';

import { runBacktestFromPayload } from './backtest.js';

describe('runBacktestFromPayload', () => {
  it('returns backtest metrics for valid payloads', () => {
    const result = runBacktestFromPayload({
      picks: [
        { managerId: 'm1', playerId: 'p1', position: 'RB', overallPick: 1 },
        { managerId: 'm2', playerId: 'p2', position: 'WR', overallPick: 2 },
        { managerId: 'm3', playerId: 'p3', position: 'QB', overallPick: 3 },
      ],
    });

    expect(result.totalEvaluated).toBe(2);
    expect(result.topThreeHitRate).toBe(1);
  });
});
