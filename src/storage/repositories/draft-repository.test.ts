import { describe, expect, it } from 'vitest';

import { DraftPick, DraftSession } from '../../../draft-models.js';
import { InMemoryDraftRepository } from './draft-repository.js';

describe('InMemoryDraftRepository', () => {
  it('stores imported picks idempotently and returns them in draft order', async () => {
    const repository = new InMemoryDraftRepository();
    const firstPick = new DraftPick({
      id: 'pick-1',
      leagueId: 'league-1',
      season: 2025,
      round: 1,
      overallPick: 2,
      managerId: 'manager-1',
      playerId: 'player-1',
    });
    const secondPick = new DraftPick({
      id: 'pick-2',
      leagueId: 'league-1',
      season: 2025,
      round: 1,
      overallPick: 1,
      managerId: 'manager-2',
      playerId: 'player-2',
    });

    await repository.savePicks([firstPick, secondPick]);
    await repository.savePicks([firstPick]);

    expect(await repository.getPicksForLeague('league-1', 2025)).toEqual([secondPick, firstPick]);
  });

  it('replaces an existing session with the same ID', async () => {
    const repository = new InMemoryDraftRepository();
    const session = new DraftSession({
      id: 'session-1',
      leagueId: 'league-1',
      season: 2025,
      status: 'PRE_DRAFT',
      strategyProfile: 'BALANCED',
    });

    await repository.saveSession(session);
    session.status = 'LIVE';
    await repository.saveSession(session);

    expect(await repository.getLatestSession('league-1')).toBe(session);
    expect((await repository.getPicksForLeague('league-1')).length).toBe(0);
  });

  it('stores and retrieves scoring and backtest snapshots', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      createdAt: new Date().toISOString(),
      result: {
        totalEvaluated: 10,
        topOneHitRate: 0.2,
        topThreeHitRate: 0.6,
        positionAccuracy: 0.7,
        averageActualPickProbability: 0.33,
      },
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-1',
      draftSessionId: 'session-1',
      createdAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
    });

    expect(await repository.getPredictionBacktest('backtest-1')).toMatchObject({ id: 'backtest-1' });
    expect(await repository.getHeuristicScore('heuristic-1')).toMatchObject({ id: 'heuristic-1' });
    expect(await repository.getStrategyRecommendation('strategy-1')).toMatchObject({ id: 'strategy-1' });
  });

  it('lists snapshot pages in reverse chronological order with cursor pagination', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:00:00.000Z',
      result: {
        totalEvaluated: 2,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.5,
      },
    });
    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:01:00.000Z',
      result: {
        totalEvaluated: 3,
        topOneHitRate: 0.5,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.4,
      },
    });
    await repository.savePredictionBacktest({
      id: 'backtest-3',
      draftSessionId: 'session-2',
      createdAt: '2026-08-22T10:02:00.000Z',
      result: {
        totalEvaluated: 3,
        topOneHitRate: 0.5,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.4,
      },
    });

    const firstPage = await repository.listPredictionBacktests({ draftSessionId: 'session-1', limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].id).toBe('backtest-2');
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await repository.listPredictionBacktests({
      draftSessionId: 'session-1',
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).toBe('backtest-1');
    expect(secondPage.nextCursor).toBeNull();

    await repository.saveHeuristicScore({
      id: 'heuristic-1',
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
      createdAt: '2026-08-22T10:01:00.000Z',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
    });
    await expect(repository.listHeuristicScores({ draftSessionId: 'session-1' })).resolves.toMatchObject({
      items: [{ id: 'heuristic-1' }],
    });
    await expect(repository.listStrategyRecommendations({ draftSessionId: 'session-1' })).resolves.toMatchObject({
      items: [{ id: 'strategy-1' }],
    });
  });

  it('returns latest snapshots and applies retention cleanup', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-a',
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
      id: 'backtest-b',
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
      id: 'heuristic-a',
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
      id: 'heuristic-b',
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
      id: 'strategy-a',
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
      id: 'strategy-b',
      draftSessionId: 'session-1',
      createdAt: '2026-08-22T10:01:00.000Z',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
    });

    expect(await repository.getLatestPredictionBacktest('session-1')).toMatchObject({ id: 'backtest-b' });
    expect(await repository.getLatestHeuristicScore('session-1')).toMatchObject({ id: 'heuristic-b' });
    expect(await repository.getLatestStrategyRecommendation('session-1')).toMatchObject({ id: 'strategy-b' });
    expect(await repository.deleteStalePredictionBacktests({ draftSessionId: 'session-1', keepLatest: 1 })).toBe(1);
    expect(await repository.deleteStaleHeuristicScores({ draftSessionId: 'session-1', keepLatest: 1 })).toBe(1);
    expect(await repository.deleteStaleStrategyRecommendations({ draftSessionId: 'session-1', keepLatest: 1 })).toBe(1);
    expect(await repository.listPredictionBacktests({ draftSessionId: 'session-1' })).toMatchObject({
      items: [{ id: 'backtest-b' }],
    });
    expect(await repository.listHeuristicScores({ draftSessionId: 'session-1' })).toMatchObject({
      items: [{ id: 'heuristic-b' }],
    });
    expect(await repository.listStrategyRecommendations({ draftSessionId: 'session-1' })).toMatchObject({
      items: [{ id: 'strategy-b' }],
    });
  });

  it('stores and lists observability events with filtering and pagination', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'info',
      eventName: 'snapshot_created',
      details: { id: 'abc' },
      createdAt: '2026-08-22T10:00:00.000Z',
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: { reason: 'timeout' },
      createdAt: '2026-08-22T10:01:00.000Z',
    });

    const firstPage = await repository.listObservabilityEvents({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].id).toBe('evt-2');
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await repository.listObservabilityEvents({
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items[0].id).toBe('evt-1');
    expect(secondPage.nextCursor).toBeNull();

    await expect(repository.listObservabilityEvents({ level: 'error' })).resolves.toMatchObject({
      items: [{ id: 'evt-2' }],
    });
    await expect(repository.listObservabilityEvents({ eventName: 'snapshot_created' })).resolves.toMatchObject({
      items: [{ id: 'evt-1' }],
    });
    await expect(repository.getObservabilitySummary()).resolves.toMatchObject({
      totalEvents: 2,
      byLevel: { info: 1, error: 1 },
      byEventName: { snapshot_created: 1, snapshot_failed: 1 },
    });
    await expect(repository.getObservabilitySummary({
      sinceCreatedAt: '2026-08-22T10:00:30.000Z',
    })).resolves.toMatchObject({
      totalEvents: 1,
      byLevel: { info: 0, error: 1 },
      byEventName: { snapshot_failed: 1 },
    });
  });
});
