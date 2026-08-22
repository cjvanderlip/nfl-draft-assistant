import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiServer } from './server.js';
import { createDependencyHealthTracker } from '../services/dependency-health.js';
import { InMemoryDraftRepository } from '../storage/repositories/draft-repository.js';

const activeServers: ReturnType<typeof createApiServer>[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  })));
  vi.useRealTimers();
});

describe('createApiServer', () => {
  it('serves dynamic dependency health from the tracker', async () => {
    const healthTracker = createDependencyHealthTracker();
    const server = createApiServer({ healthTracker });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const getHealth = async (): Promise<{ status: string; dependencies: Record<string, string> }> => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.json() as Promise<{ status: string; dependencies: Record<string, string> }>;
    };

    expect(await getHealth()).toMatchObject({
      status: 'degraded',
      dependencies: { database: 'unknown', provider: 'unknown' },
    });

    healthTracker.markSuccess('database');
    healthTracker.markSuccess('provider');
    expect(await getHealth()).toMatchObject({
      status: 'ok',
      dependencies: { database: 'ok', provider: 'ok' },
    });

    healthTracker.markFailure('provider');
    expect(await getHealth()).toMatchObject({
      status: 'degraded',
      dependencies: { database: 'ok', provider: 'degraded' },
    });
  });

  it('handles prediction backtest requests', async () => {
    const server = createApiServer();
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/predictions/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        picks: [
          { managerId: 'm1', playerId: 'p1', position: 'RB', overallPick: 1 },
          { managerId: 'm2', playerId: 'p2', position: 'WR', overallPick: 2 },
          { managerId: 'm3', playerId: 'p3', position: 'QB', overallPick: 3 },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalEvaluated: 2,
      topThreeHitRate: 1,
    });
  });

  it('handles heuristic scoring requests', async () => {
    const server = createApiServer();
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/heuristics/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          playerId: 'p1',
          baseRank: 4,
          signals: {
            contractYear: 0.5,
            targetShareVolatility: 0.1,
            olineUpgrade: 0.1,
            rzRegression: 0.1,
            gameScriptLeverage: 0.1,
          },
        }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weights: { contractYearBump: 0.2 },
      candidates: [{ playerId: 'p1', adjustedRank: 1 }],
    });
  });

  it('handles strategy-aware roster recommendation requests', async () => {
    const server = createApiServer();
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/roster/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        strategyProfile: 'HERO_RB',
        starters: { RB: 2, WR: 2 },
        draftedPlayers: [{ playerId: 'rb-a', position: 'RB' }],
        candidates: [{ playerId: 'wr-1', position: 'WR', compositeScore: 1 }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      strategyProfile: 'HERO_RB',
      slotsRemaining: { RB: 1, WR: 2 },
      recommendations: [{ playerId: 'wr-1' }],
    });
  });

  it('returns 400 for invalid JSON payloads on POST routes', async () => {
    const server = createApiServer();
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/heuristics/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Request body must be valid JSON.',
    });
  });

  it('persists and retrieves computed snapshots when a repository is configured', async () => {
    const repository = new InMemoryDraftRepository();
    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const port = (server.address() as { port: number }).port;
    const backtestResponse = await fetch(`http://127.0.0.1:${port}/predictions/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftSessionId: 'session-1',
        picks: [
          { managerId: 'm1', playerId: 'p1', position: 'RB', overallPick: 1 },
          { managerId: 'm2', playerId: 'p2', position: 'WR', overallPick: 2 },
        ],
      }),
    });
    const backtestSnapshot = await backtestResponse.json() as { id: string };
    expect(backtestResponse.status).toBe(200);
    expect(backtestSnapshot.id).toBeTruthy();

    const heuristicResponse = await fetch(`http://127.0.0.1:${port}/heuristics/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftSessionId: 'session-1',
        candidates: [{
          playerId: 'p1',
          baseRank: 4,
          signals: {
            contractYear: 0.4,
            targetShareVolatility: 0.1,
            olineUpgrade: 0.1,
            rzRegression: 0.1,
            gameScriptLeverage: 0.1,
          },
        }],
      }),
    });
    const heuristicSnapshot = await heuristicResponse.json() as { id: string };
    expect(heuristicResponse.status).toBe(200);
    expect(heuristicSnapshot.id).toBeTruthy();

    const rosterResponse = await fetch(`http://127.0.0.1:${port}/roster/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftSessionId: 'session-1',
        strategyProfile: 'BALANCED',
        starters: { RB: 2, WR: 2, QB: 1 },
        draftedPlayers: [{ playerId: 'rb-a', position: 'RB' }],
        candidates: [{ playerId: 'wr-1', position: 'WR', compositeScore: 1 }],
      }),
    });
    const rosterSnapshot = await rosterResponse.json() as { id: string };
    expect(rosterResponse.status).toBe(200);
    expect(rosterSnapshot.id).toBeTruthy();

    await expect(fetch(`http://127.0.0.1:${port}/predictions/backtest/${backtestSnapshot.id}`).then((res) => res.json()))
      .resolves.toMatchObject({ id: backtestSnapshot.id, draftSessionId: 'session-1' });
    await expect(fetch(`http://127.0.0.1:${port}/heuristics/score/${heuristicSnapshot.id}`).then((res) => res.json()))
      .resolves.toMatchObject({ id: heuristicSnapshot.id, draftSessionId: 'session-1' });
    await expect(fetch(`http://127.0.0.1:${port}/roster/recommendations/${rosterSnapshot.id}`).then((res) => res.json()))
      .resolves.toMatchObject({ id: rosterSnapshot.id, draftSessionId: 'session-1' });
  });

  it('lists snapshots by session and supports cursor pagination', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 2,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.5,
      },
      createdAt: '2026-08-22T10:00:00.000Z',
    });
    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 3,
        topOneHitRate: 0.5,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.5,
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-1',
      draftSessionId: 'session-1',
      weights: {
        contractYearBump: 0.2,
        targetShareVolatility: 0.1,
        olineUpgrade: 0.1,
        rzRegression: 0.1,
        gameScriptLeverage: 0.1,
      },
      candidates: [],
      createdAt: '2026-08-22T10:01:00.000Z',
    });
    await repository.saveStrategyRecommendation({
      id: 'strategy-1',
      draftSessionId: 'session-1',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });

    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const firstPageResponse = await fetch(
      `http://127.0.0.1:${port}/predictions/backtest?draftSessionId=session-1&limit=1`,
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = await firstPageResponse.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].id).toBe('backtest-2');
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPageResponse = await fetch(
      `http://127.0.0.1:${port}/predictions/backtest?draftSessionId=session-1&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = await secondPageResponse.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).toBe('backtest-1');
    expect(secondPage.nextCursor).toBeNull();

    await expect(
      fetch(`http://127.0.0.1:${port}/heuristics/score?draftSessionId=session-1`).then((res) => res.json()),
    ).resolves.toMatchObject({ items: [{ id: 'heuristic-1' }] });
    await expect(
      fetch(`http://127.0.0.1:${port}/roster/recommendations?draftSessionId=session-1`).then((res) => res.json()),
    ).resolves.toMatchObject({ items: [{ id: 'strategy-1' }] });
  });

  it('returns 400 for invalid list query parameters', async () => {
    const repository = new InMemoryDraftRepository();
    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/predictions/backtest?limit=0`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'limit must be an integer between 1 and 100.',
    });
  });

  it('returns latest snapshots and supports cleanup retention endpoint', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.5,
      },
      createdAt: '2026-08-22T10:00:00.000Z',
    });
    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.6,
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-1',
      draftSessionId: 'session-1',
      weights: {
        contractYearBump: 0.2,
        targetShareVolatility: 0.1,
        olineUpgrade: 0.1,
        rzRegression: 0.1,
        gameScriptLeverage: 0.1,
      },
      candidates: [],
      createdAt: '2026-08-22T10:01:00.000Z',
    });
    await repository.saveStrategyRecommendation({
      id: 'strategy-1',
      draftSessionId: 'session-1',
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [],
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });

    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    await expect(
      fetch(`http://127.0.0.1:${port}/predictions/backtest/latest?draftSessionId=session-1`).then((res) => res.json()),
    ).resolves.toMatchObject({ id: 'backtest-2' });
    await expect(
      fetch(`http://127.0.0.1:${port}/heuristics/score/latest?draftSessionId=session-1`).then((res) => res.json()),
    ).resolves.toMatchObject({ id: 'heuristic-1' });
    await expect(
      fetch(`http://127.0.0.1:${port}/roster/recommendations/latest?draftSessionId=session-1`).then((res) => res.json()),
    ).resolves.toMatchObject({ id: 'strategy-1' });

    const cleanupResponse = await fetch(`http://127.0.0.1:${port}/snapshots/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftSessionId: 'session-1', keepLatest: 1 }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toMatchObject({
      keepLatest: 1,
      deletedPredictionBacktests: 1,
    });
  });

  it('runs scheduled snapshot retention when configured on server startup', async () => {
    vi.useFakeTimers();
    const repository = new InMemoryDraftRepository();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.5,
      },
      createdAt: '2026-08-22T10:00:00.000Z',
    });
    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 1,
        topOneHitRate: 1,
        topThreeHitRate: 1,
        positionAccuracy: 1,
        averageActualPickProbability: 0.6,
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });

    const server = createApiServer({
      repository,
      snapshotRetention: {
        intervalSeconds: 1,
        keepLatest: 1,
        draftSessionId: 'session-1',
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(repository.listPredictionBacktests({ draftSessionId: 'session-1' })).resolves.toMatchObject({
      items: [{ id: 'backtest-2' }],
    });
  });

  it('exposes runtime metrics for snapshot workflows', async () => {
    const repository = new InMemoryDraftRepository();
    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const scoreResponse = await fetch(`http://127.0.0.1:${port}/heuristics/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          playerId: 'p1',
          baseRank: 4,
          signals: {
            contractYear: 0.2,
            targetShareVolatility: 0.1,
            olineUpgrade: 0.1,
            rzRegression: 0.1,
            gameScriptLeverage: 0.1,
          },
        }],
      }),
    });
    expect(scoreResponse.status).toBe(200);

    const listResponse = await fetch(`http://127.0.0.1:${port}/heuristics/score?limit=5`);
    expect(listResponse.status).toBe(200);

    const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(metricsResponse.status).toBe(200);
    await expect(metricsResponse.json()).resolves.toMatchObject({
      counters: {
        'api.heuristics.score.create.success': 1,
        'api.heuristics.score.list.success': 1,
      },
      timings: {
        'api.heuristics.score.create.durationMs': { count: 1 },
        'api.heuristics.score.list.durationMs': { count: 1 },
      },
    });
  });

  it('persists and lists observability events through metrics events API', async () => {
    const repository = new InMemoryDraftRepository();
    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const cleanupResponse = await fetch(`http://127.0.0.1:${port}/snapshots/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keepLatest: 1 }),
    });
    expect(cleanupResponse.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const eventsResponse = await fetch(`http://127.0.0.1:${port}/metrics/events?eventName=snapshot_cleanup_completed`);
    expect(eventsResponse.status).toBe(200);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      items: [{
        level: 'info',
        eventName: 'snapshot_cleanup_completed',
      }],
    });
  });

  it('returns aggregated metrics summary with optional window filtering', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: '2026-08-22T10:00:00.000Z',
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({ repository });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const summaryResponse = await fetch(`http://127.0.0.1:${port}/metrics/summary`);
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      persisted: {
        totalEvents: 2,
        byLevel: { info: 1, error: 1 },
      },
      runtime: {
        counters: expect.any(Object),
      },
    });

    const windowedSummaryResponse = await fetch(`http://127.0.0.1:${port}/metrics/summary?windowSeconds=1`);
    expect(windowedSummaryResponse.status).toBe(200);
    await expect(windowedSummaryResponse.json()).resolves.toMatchObject({
      persisted: {
        totalEvents: 1,
        byLevel: { info: 0, error: 1 },
      },
    });
  });

  it('returns 400 for invalid metrics summary windows', async () => {
    const server = createApiServer({ repository: new InMemoryDraftRepository() });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/summary?windowSeconds=0`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'windowSeconds must be an integer between 1 and 86400.',
    });
  });

  it('returns alert summaries when error rate exceeds configured threshold', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      thresholds: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
      alerts: [{
        code: 'HIGH_ERROR_RATE',
      }],
    });
  });

  it('dispatches alerts and suppresses duplicates during cooldown windows', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
        dispatchCooldownSeconds: 600,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const firstResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      totalAlerts: 1,
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
      suppressed: [],
      delivery: {
        sentCount: 0,
        failedCount: 0,
      },
    });

    const secondResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toMatchObject({
      totalAlerts: 1,
      dispatched: [],
      suppressed: [{ code: 'HIGH_ERROR_RATE', reason: 'cooldown_active' }],
    });
  });

  it('returns 409 when alert dispatching is disabled', async () => {
    const server = createApiServer({
      repository: new InMemoryDraftRepository(),
      alerting: {
        dispatchEnabled: false,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Alert dispatching is disabled.',
    });
  });

  it('returns 502 when alert delivery fails after dispatch', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
      alertNotifier: {
        notifyAlerts: async (alerts) => ({
          deliveries: alerts.map((alert) => ({
            channel: 'webhook',
            alertCode: alert.code,
            attempts: 3,
            status: 'failed',
            error: 'Webhook responded with HTTP 503 Service Unavailable.',
          })),
          sentCount: 0,
          failedCount: alerts.length,
        }),
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
      delivery: {
        failedCount: 1,
      },
    });
  });

  it('returns delivered alerts when external notification succeeds', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
      alertNotifier: {
        notifyAlerts: async (alerts) => ({
          deliveries: alerts.flatMap((alert) => ([
            {
              channel: 'webhook',
              alertCode: alert.code,
              attempts: 1,
              status: 'sent',
              error: null,
            },
            {
              channel: 'slack',
              alertCode: alert.code,
              attempts: 1,
              status: 'sent',
              error: null,
            },
          ])),
          sentCount: alerts.length * 2,
          failedCount: 0,
        }),
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
      delivery: {
        sentCount: 2,
        failedCount: 0,
        deliveries: [
          { channel: 'webhook', status: 'sent' },
          { channel: 'slack', status: 'sent' },
        ],
      },
    });
  });

  it('supports fanout notifier with per-channel policies', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
      alertNotifier: {
        notifyAlerts: async (alerts) => ({
          deliveries: alerts.map((alert) => ({
            alertCode: alert.code,
            channel: 'email',
            attempts: 2,
            status: 'sent',
            error: null,
          })),
          sentCount: alerts.length,
          failedCount: 0,
        }),
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
      delivery: {
        sentCount: 1,
        failedCount: 0,
        deliveries: [{ channel: 'email', status: 'sent' }],
      },
    });
  });

  it('supports alert silence and acknowledgement governance endpoints', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });
    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const silenceResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/silence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'HIGH_ERROR_RATE', durationSeconds: 300 }),
    });
    expect(silenceResponse.status).toBe(200);

    const dispatchResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(dispatchResponse.status).toBe(200);
    await expect(dispatchResponse.json()).resolves.toMatchObject({
      dispatched: [],
      governance: {
        suppressed: [{ code: 'HIGH_ERROR_RATE', reason: 'silenced' }],
      },
    });

    const acknowledgeResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/acknowledge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'INTERNAL_REQUEST_ERRORS', note: 'tracked' }),
    });
    expect(acknowledgeResponse.status).toBe(200);

    const stateResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/state`);
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ code: 'HIGH_ERROR_RATE' }),
        expect.objectContaining({ code: 'INTERNAL_REQUEST_ERRORS', acknowledgedNote: 'tracked' }),
      ]),
    });
  });

  it('creates escalation records when deliveries keep failing', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
        escalationFailureThreshold: 1,
      },
      alertNotifier: {
        notifyAlerts: async (alerts) => ({
          deliveries: alerts.map((alert) => ({
            channel: 'webhook',
            alertCode: alert.code,
            attempts: 1,
            status: 'failed',
            error: 'provider down',
          })),
          sentCount: 0,
          failedCount: alerts.length,
        }),
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, {
      method: 'POST',
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      governance: {
        escalations: [{
          code: 'HIGH_ERROR_RATE',
          escalationLevel: 1,
          reason: 'consecutive_delivery_failures',
        }],
      },
    });
  });

  it('replays idempotent alert dispatch responses when idempotency-key is reused', async () => {
    const repository = new InMemoryDraftRepository();
    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: {},
      createdAt: new Date().toISOString(),
    });
    await repository.saveObservabilityEvent({
      id: 'evt-3',
      level: 'info',
      eventName: 'snapshot_created',
      details: {},
      createdAt: new Date().toISOString(),
    });

    let notifyCallCount = 0;
    const server = createApiServer({
      repository,
      alerting: {
        errorRateThreshold: 0.5,
        minEventVolume: 3,
        idempotencyEnabled: true,
        idempotencyTtlSeconds: 300,
      },
      alertNotifier: {
        notifyAlerts: async (alerts) => {
          notifyCallCount += 1;
          return {
            deliveries: alerts.map((alert) => ({
              channel: 'webhook',
              alertCode: alert.code,
              attempts: 1,
              status: 'sent',
              error: null,
            })),
            sentCount: alerts.length,
            failedCount: 0,
          };
        },
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;
    const requestOptions = {
      method: 'POST',
      headers: { 'idempotency-key': 'dispatch-001' },
    };

    const first = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, requestOptions);
    expect(first.status).toBe(200);
    const firstPayload = await first.json() as { dispatched: Array<{ code: string }> };
    expect(firstPayload.dispatched).toMatchObject([{ code: 'HIGH_ERROR_RATE' }]);

    const second = await fetch(`http://127.0.0.1:${port}/metrics/alerts/dispatch`, requestOptions);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
    });
    expect(notifyCallCount).toBe(1);
  });

  it('applies rate limits to protected alert mutation routes', async () => {
    const server = createApiServer({
      repository: new InMemoryDraftRepository(),
      alerting: {
        rateLimitEnabled: true,
        rateLimitWindowSeconds: 60,
        rateLimitMaxRequests: 1,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const firstResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/silence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'HIGH_ERROR_RATE', durationSeconds: 60 }),
    });
    expect(firstResponse.status).toBe(200);

    const secondResponse = await fetch(`http://127.0.0.1:${port}/metrics/alerts/silence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'HIGH_ERROR_RATE', durationSeconds: 60 }),
    });
    expect(secondResponse.status).toBe(429);
    await expect(secondResponse.json()).resolves.toMatchObject({
      error: 'Rate limit exceeded.',
    });
  });

  it('returns operational runbook checks', async () => {
    const server = createApiServer({
      alerting: {
        dispatchEnabled: true,
        idempotencyEnabled: true,
        rateLimitEnabled: true,
      },
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/ops/runbook-checks`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'warn',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'persisted-observability' }),
        expect.objectContaining({ id: 'idempotency-keys', status: 'pass' }),
        expect.objectContaining({ id: 'rate-limits', status: 'pass' }),
      ]),
    });
  });
});
