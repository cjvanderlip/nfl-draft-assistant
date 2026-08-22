import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import initSqlJs from 'sql.js';
import type { SqlValue } from 'sql.js';
import { describe, expect, it } from 'vitest';

import { DraftPick, League, Manager, Player } from '../../draft-models.js';
import { applyMigration, SqliteDraftRepository, type SqliteDatabase } from './sqlite.js';

const migrationSql = readFileSync(new URL('./migrations/001_initial_schema.sql', import.meta.url), 'utf8');

async function createTestDatabase(): Promise<SqliteDatabase> {
  const SqlJs = await initSqlJs({
    locateFile: (fileName) => fileURLToPath(new URL(`../../node_modules/sql.js/dist/${fileName}`, import.meta.url)),
  });
  const database = new SqlJs.Database();

  return {
    exec: (sql: string) => database.run(sql),
    prepare: (sql: string) => {
      const statement = database.prepare(sql);
      return {
        run: (...parameters: unknown[]) => {
          statement.bind(parameters as SqlValue[]);
          while (statement.step()) {
          }
          statement.reset();
        },
        get: <T extends Record<string, unknown>>(...parameters: unknown[]) => {
          statement.bind(parameters as SqlValue[]);
          const result = statement.step() ? statement.getAsObject() as T : undefined;
          statement.reset();
          return result;
        },
        all: <T extends Record<string, unknown>>(...parameters: unknown[]) => {
          statement.bind(parameters as SqlValue[]);
          const results: T[] = [];
          while (statement.step()) {
            results.push(statement.getAsObject() as T);
          }
          statement.reset();
          return results;
        },
      };
    },
  };
}

describe('SqliteDraftRepository integration', () => {
  it('persists and reconstructs the draft aggregate in SQLite', async () => {
    const database = await createTestDatabase();
    applyMigration(database, migrationSql);
    const repository = new SqliteDraftRepository(database);
    const league = new League({
      id: 'league-1',
      providerLeagueId: 'provider-1',
      name: 'Integration League',
      scoringFormat: 'PPR',
      rosterSettings: { starters: { QB: 1 }, bench: 5 },
      timezone: 'UTC',
    });
    const manager = new Manager({ id: 'manager-1', leagueId: league.id, displayName: 'Manager' });
    const player = new Player({ id: 'player-1', fullName: 'Player One', position: 'WR', team: 'BUF' });
    const pick = new DraftPick({
      id: 'pick-1',
      leagueId: league.id,
      season: 2025,
      round: 1,
      overallPick: 1,
      managerId: manager.id,
      playerId: player.id,
    });

    await repository.saveLeague(league);
    await repository.saveManagers([manager]);
    await repository.savePlayers([player]);
    await repository.savePicks([pick, pick]);

    const restoredLeague = await repository.getLeague(league.id);
    const restoredPicks = await repository.getPicksForLeague(league.id, 2025);

    expect(restoredLeague?.toJSON()).toMatchObject(league.toJSON());
    expect(restoredPicks).toHaveLength(1);
    expect(restoredPicks[0].toJSON()).toMatchObject(pick.toJSON());

    const createdAt = new Date().toISOString();
    await repository.savePredictionBacktest({
      id: 'backtest-1',
      draftSessionId: null,
      result: {
        totalEvaluated: 10,
        topOneHitRate: 0.3,
        topThreeHitRate: 0.6,
        positionAccuracy: 0.7,
        averageActualPickProbability: 0.25,
      },
      createdAt,
    });
    await repository.saveHeuristicScore({
      id: 'heuristic-1',
      draftSessionId: null,
      weights: {
        contractYearBump: 0.2,
        targetShareVolatility: 0.1,
        olineUpgrade: 0.1,
        rzRegression: 0.1,
        gameScriptLeverage: 0.1,
      },
      candidates: [{
        playerId: 'player-1',
        baseRank: 1,
        adjustedRank: 1,
        signalBreakdown: {
          contractYear: 0.1,
          targetShareVolatility: 0.1,
          olineUpgrade: 0.1,
          rzRegression: 0.1,
          gameScriptLeverage: 0.1,
        },
        weightedContributions: {
          contractYear: 0.02,
          targetShareVolatility: 0.01,
          olineUpgrade: 0.01,
          rzRegression: 0.01,
          gameScriptLeverage: 0.01,
        },
        compositeScore: 1.06,
      }],
      createdAt,
    });
    await repository.saveStrategyRecommendation({
      id: 'strategy-1',
      draftSessionId: null,
      evaluation: {
        strategyProfile: 'BALANCED',
        slotsRemaining: { RB: 1 },
        priorityPositions: ['RB', 'WR', 'QB', 'TE', 'K', 'DST'],
        recommendations: [{
          playerId: 'player-1',
          position: 'WR',
          strategyFit: 'ON_STRATEGY',
          score: 1.1,
          reason: 'fit',
        }],
      },
      createdAt,
    });

    await expect(repository.getPredictionBacktest('backtest-1')).resolves.toMatchObject({ id: 'backtest-1' });
    await expect(repository.getHeuristicScore('heuristic-1')).resolves.toMatchObject({ id: 'heuristic-1' });
    await expect(repository.getStrategyRecommendation('strategy-1')).resolves.toMatchObject({ id: 'strategy-1' });

    await repository.savePredictionBacktest({
      id: 'backtest-2',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 8,
        topOneHitRate: 0.2,
        topThreeHitRate: 0.5,
        positionAccuracy: 0.65,
        averageActualPickProbability: 0.2,
      },
      createdAt: '2026-08-22T10:01:00.000Z',
    });
    await repository.savePredictionBacktest({
      id: 'backtest-3',
      draftSessionId: 'session-1',
      result: {
        totalEvaluated: 6,
        topOneHitRate: 0.3,
        topThreeHitRate: 0.7,
        positionAccuracy: 0.75,
        averageActualPickProbability: 0.3,
      },
      createdAt: '2026-08-22T10:02:00.000Z',
    });

    const firstPage = await repository.listPredictionBacktests({ draftSessionId: 'session-1', limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].id).toBe('backtest-3');
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await repository.listPredictionBacktests({
      draftSessionId: 'session-1',
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).toBe('backtest-2');

    await expect(repository.listHeuristicScores({ limit: 5 })).resolves.toMatchObject({
      items: [{ id: 'heuristic-1' }],
    });
    await expect(repository.listStrategyRecommendations({ limit: 5 })).resolves.toMatchObject({
      items: [{ id: 'strategy-1' }],
    });

    expect(await repository.getLatestPredictionBacktest('session-1')).toMatchObject({ id: 'backtest-3' });
    expect(await repository.deleteStalePredictionBacktests({ draftSessionId: 'session-1', keepLatest: 1 })).toBe(1);
    await expect(repository.listPredictionBacktests({ draftSessionId: 'session-1' })).resolves.toMatchObject({
      items: [{ id: 'backtest-3' }],
    });
    expect(await repository.getLatestHeuristicScore()).toMatchObject({ id: 'heuristic-1' });
    expect(await repository.getLatestStrategyRecommendation()).toMatchObject({ id: 'strategy-1' });
    expect(await repository.deleteStaleHeuristicScores({ keepLatest: 0 })).toBe(1);
    expect(await repository.deleteStaleStrategyRecommendations({ keepLatest: 0 })).toBe(1);

    await repository.saveObservabilityEvent({
      id: 'evt-1',
      level: 'info',
      eventName: 'snapshot_created',
      details: { id: 'backtest-3' },
      createdAt: '2026-08-22T10:03:00.000Z',
    });
    await repository.saveObservabilityEvent({
      id: 'evt-2',
      level: 'error',
      eventName: 'snapshot_failed',
      details: { reason: 'timeout' },
      createdAt: '2026-08-22T10:04:00.000Z',
    });
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
      sinceCreatedAt: '2026-08-22T10:03:30.000Z',
    })).resolves.toMatchObject({
      totalEvents: 1,
      byLevel: { info: 0, error: 1 },
      byEventName: { snapshot_failed: 1 },
    });
  });
});
