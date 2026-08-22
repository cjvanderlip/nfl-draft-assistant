import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryDraftRepository } from '../storage/repositories/draft-repository.js';
import { runSnapshotRetentionSweep, startSnapshotRetentionJob } from './snapshot-retention.js';

describe('runSnapshotRetentionSweep', () => {
  it('deletes stale snapshots and keeps the newest entries', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:00:00.000Z',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 1,
      },
    });
    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:01:00.000Z',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 1,
      },
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-1',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:00:00.000Z',
      weights: {
        contractYearBump: 0.2,
        targetShareVolatility: 0.1,
        olineUpgrade: 0.1,
        rzRegression: 0.1,
        gameScriptLeverage: 0.1,
      },
      candidates: [],
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-2',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:01:00.000Z',
      weights: {
        contractYearBump: 0.2,
        targetShareVolatility: 0.1,
        olineUpgrade: 0.1,
        rzRegression: 0.1,
        gameScriptLeverage: 0.1,
      },
      candidates: [],
    });
    await repository.saveStrategyRecommendation({
      id: 'strategy-1',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:00:00.000Z',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
    });
    await repository.saveStrategyRecommendation({
      id: 'strategy-2',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:01:00.000Z',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
    });

    const result = await runSnapshotRetentionSweep(repository, { draftSessionId: 'session-1', keepLatest: 1 });
    expect(result).toEqual({
      deletedPredictionBacktests: 1,
      deletedHeuristicScores: 1,
      deletedStrategyRecommendations: 1,
    });
  });
});

describe('startSnapshotRetentionJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on the configured cadence', async () => {
    vi.useFakeTimers();
    const repository = new InMemoryDraftRepository();
    let runs = 0;

    const controller = startSnapshotRetentionJob({
      repository,
      intervalSeconds: 1,
      keepLatest: 1,
      runOnStart: false,
      onRun: () => {
        runs += 1;
      },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);

    controller.stop();
    expect(controller.isRunning()).toBe(false);
  });
});
