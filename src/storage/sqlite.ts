import {
  DraftPick,
  DraftSession,
  League,
  Manager,
  Player,
} from '../../draft-models.js';
import { assertNonEmptyString } from '../../validators.js';
import type {
  DraftRepository,
  HeuristicScoreSnapshot,
  ObservabilitySummary,
  ObservabilityEventRecord,
  PredictionBacktestSnapshot,
  SnapshotPage,
  StrategyRecommendationSnapshot,
} from './repositories/draft-repository.js';

export interface SqliteStatement {
  run(...parameters: unknown[]): void;
  get<T extends Record<string, unknown>>(...parameters: unknown[]): T | undefined;
  all<T extends Record<string, unknown>>(...parameters: unknown[]): T[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: unknown, fieldName: string): T {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must contain JSON text.`);
  }
  return JSON.parse(value) as T;
}

/**
 * Apply the initial schema migration to a compatible SQLite database.
 *
 * @param database - SQLite database connection.
 * @param migrationSql - SQL migration contents.
 */
export function applyMigration(database: SqliteDatabase, migrationSql: string): void {
  if (!database || typeof database.exec !== 'function') {
    throw new TypeError('database must provide an exec function.');
  }
  assertNonEmptyString(migrationSql, 'migrationSql');
  database.exec(migrationSql);
}

/**
 * SQLite-backed implementation of the draft repository contract.
 */
export class SqliteDraftRepository implements DraftRepository {
  private readonly database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database must provide a prepare function.');
    }
    this.database = database;
  }

  /** @inheritdoc */
  async saveLeague(league: League): Promise<League> {
    this.database.prepare(`
      INSERT INTO leagues (id, provider_league_id, name, scoring_format, roster_settings_json, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_league_id = excluded.provider_league_id,
        name = excluded.name,
        scoring_format = excluded.scoring_format,
        roster_settings_json = excluded.roster_settings_json,
        timezone = excluded.timezone,
        updated_at = excluded.updated_at
    `).run(
      league.id,
      league.providerLeagueId,
      league.name,
      league.scoringFormat,
      asJson(league.rosterSettings),
      league.timezone,
      league.createdAt,
      league.updatedAt,
    );
    return league;
  }

  /** @inheritdoc */
  async getLeague(leagueId: string): Promise<League | null> {
    assertNonEmptyString(leagueId, 'leagueId');
    const row = this.database.prepare('SELECT * FROM leagues WHERE id = ?').get<LeagueRow>(leagueId);
    if (!row) {
      return null;
    }
    return new League({
      id: row.id,
      providerLeagueId: row.provider_league_id,
      name: row.name,
      scoringFormat: row.scoring_format as League['scoringFormat'],
      rosterSettings: fromJson(row.roster_settings_json, 'roster_settings_json'),
      timezone: row.timezone,
      createdAt: row.created_at,
    });
  }

  /** @inheritdoc */
  async saveManagers(managers: Manager[]): Promise<void> {
    for (const manager of managers) {
      this.database.prepare(`
        INSERT INTO managers (id, league_id, display_name, tendency_profile_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          league_id = excluded.league_id,
          display_name = excluded.display_name,
          tendency_profile_json = excluded.tendency_profile_json,
          updated_at = excluded.updated_at
      `).run(
        manager.id,
        manager.leagueId,
        manager.displayName,
        manager.tendencyProfile === null ? null : asJson(manager.tendencyProfile),
        manager.createdAt,
        manager.updatedAt,
      );
    }
  }

  /** @inheritdoc */
  async savePlayers(players: Player[]): Promise<void> {
    for (const player of players) {
      this.database.prepare(`
        INSERT INTO players (id, external_ids_json, full_name, position, team, bye_week, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          external_ids_json = excluded.external_ids_json,
          full_name = excluded.full_name,
          position = excluded.position,
          team = excluded.team,
          bye_week = excluded.bye_week,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        player.id,
        asJson(player.externalIds),
        player.fullName,
        player.position,
        player.team,
        player.byeWeek ?? null,
        asJson(player.metadata),
        player.createdAt,
        player.updatedAt,
      );
    }
  }

  /** @inheritdoc */
  async savePicks(picks: DraftPick[]): Promise<void> {
    for (const pick of picks) {
      this.database.prepare(`
        INSERT INTO draft_picks (id, league_id, season, round, overall_pick, manager_id, player_id, adp_at_pick, reach_delta, picked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          league_id = excluded.league_id,
          season = excluded.season,
          round = excluded.round,
          overall_pick = excluded.overall_pick,
          manager_id = excluded.manager_id,
          player_id = excluded.player_id,
          adp_at_pick = excluded.adp_at_pick,
          reach_delta = excluded.reach_delta,
          picked_at = excluded.picked_at
      `).run(
        pick.id,
        pick.leagueId,
        pick.season,
        pick.round,
        pick.overallPick,
        pick.managerId,
        pick.playerId,
        pick.adpAtPick ?? null,
        pick.reachDelta ?? null,
        pick.pickedAt,
      );
    }
  }

  /** @inheritdoc */
  async getPicksForLeague(leagueId: string, season?: number): Promise<DraftPick[]> {
    assertNonEmptyString(leagueId, 'leagueId');
    const rows = season === undefined
      ? this.database.prepare('SELECT * FROM draft_picks WHERE league_id = ? ORDER BY overall_pick').all<PickRow>(leagueId)
      : this.database.prepare('SELECT * FROM draft_picks WHERE league_id = ? AND season = ? ORDER BY overall_pick').all<PickRow>(leagueId, season);

    return rows.map((row) => new DraftPick({
      id: row.id,
      leagueId: row.league_id,
      season: row.season,
      round: row.round,
      overallPick: row.overall_pick,
      managerId: row.manager_id,
      playerId: row.player_id,
      adpAtPick: row.adp_at_pick ?? undefined,
      reachDelta: row.reach_delta ?? undefined,
      pickedAt: row.picked_at,
    }));
  }

  /** @inheritdoc */
  async saveSession(session: DraftSession): Promise<DraftSession> {
    this.database.prepare(`
      INSERT INTO draft_sessions (id, league_id, season, status, strategy_profile, current_pick, polling_interval_seconds, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        league_id = excluded.league_id,
        season = excluded.season,
        status = excluded.status,
        strategy_profile = excluded.strategy_profile,
        current_pick = excluded.current_pick,
        polling_interval_seconds = excluded.polling_interval_seconds,
        updated_at = excluded.updated_at
    `).run(
      session.id,
      session.leagueId,
      session.season,
      session.status,
      session.strategyProfile,
      session.currentPick ?? null,
      session.pollingIntervalSeconds,
      session.createdAt,
      session.updatedAt,
    );
    return session;
  }

  /** @inheritdoc */
  async getLatestSession(leagueId: string): Promise<DraftSession | null> {
    assertNonEmptyString(leagueId, 'leagueId');
    const row = this.database.prepare(
      'SELECT * FROM draft_sessions WHERE league_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).get<SessionRow>(leagueId);
    return row
      ? new DraftSession({
        id: row.id,
        leagueId: row.league_id,
        season: row.season,
        status: row.status as DraftSession['status'],
        strategyProfile: row.strategy_profile as DraftSession['strategyProfile'],
        currentPick: row.current_pick ?? undefined,
        pollingIntervalSeconds: row.polling_interval_seconds,
        createdAt: row.created_at,
      })
      : null;
  }

  /** @inheritdoc */
  async savePredictionBacktest(snapshot: PredictionBacktestSnapshot): Promise<PredictionBacktestSnapshot> {
    this.database.prepare(`
      INSERT INTO prediction_backtests (id, draft_session_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        draft_session_id = excluded.draft_session_id,
        result_json = excluded.result_json,
        created_at = excluded.created_at
    `).run(
      snapshot.id,
      snapshot.draftSessionId,
      asJson(snapshot.result),
      snapshot.createdAt,
    );
    return structuredClone(snapshot);
  }

  /** @inheritdoc */
  async getPredictionBacktest(id: string): Promise<PredictionBacktestSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const row = this.database.prepare(
      'SELECT * FROM prediction_backtests WHERE id = ?',
    ).get<PredictionBacktestRow>(id);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      draftSessionId: row.draft_session_id,
      result: fromJson(row.result_json, 'result_json'),
      createdAt: row.created_at,
    };
  }

  /** @inheritdoc */
  async listPredictionBacktests(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<PredictionBacktestSnapshot>> {
    const page = this.querySnapshotPage<PredictionBacktestRow>('prediction_backtests', options);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        draftSessionId: row.draft_session_id,
        result: fromJson(row.result_json, 'result_json'),
        createdAt: row.created_at,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** @inheritdoc */
  async getLatestPredictionBacktest(draftSessionId?: string): Promise<PredictionBacktestSnapshot | null> {
    const page = await this.listPredictionBacktests({ draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  /** @inheritdoc */
  async deleteStalePredictionBacktests(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots('prediction_backtests', options);
  }

  /** @inheritdoc */
  async saveHeuristicScore(snapshot: HeuristicScoreSnapshot): Promise<HeuristicScoreSnapshot> {
    this.database.prepare(`
      INSERT INTO heuristic_scores (id, draft_session_id, weights_json, candidates_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        draft_session_id = excluded.draft_session_id,
        weights_json = excluded.weights_json,
        candidates_json = excluded.candidates_json,
        created_at = excluded.created_at
    `).run(
      snapshot.id,
      snapshot.draftSessionId,
      asJson(snapshot.weights),
      asJson(snapshot.candidates),
      snapshot.createdAt,
    );
    return structuredClone(snapshot);
  }

  /** @inheritdoc */
  async getHeuristicScore(id: string): Promise<HeuristicScoreSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const row = this.database.prepare(
      'SELECT * FROM heuristic_scores WHERE id = ?',
    ).get<HeuristicScoreRow>(id);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      draftSessionId: row.draft_session_id,
      weights: fromJson(row.weights_json, 'weights_json'),
      candidates: fromJson(row.candidates_json, 'candidates_json'),
      createdAt: row.created_at,
    };
  }

  /** @inheritdoc */
  async listHeuristicScores(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<HeuristicScoreSnapshot>> {
    const page = this.querySnapshotPage<HeuristicScoreRow>('heuristic_scores', options);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        draftSessionId: row.draft_session_id,
        weights: fromJson(row.weights_json, 'weights_json'),
        candidates: fromJson(row.candidates_json, 'candidates_json'),
        createdAt: row.created_at,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** @inheritdoc */
  async getLatestHeuristicScore(draftSessionId?: string): Promise<HeuristicScoreSnapshot | null> {
    const page = await this.listHeuristicScores({ draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  /** @inheritdoc */
  async deleteStaleHeuristicScores(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots('heuristic_scores', options);
  }

  /** @inheritdoc */
  async saveStrategyRecommendation(snapshot: StrategyRecommendationSnapshot): Promise<StrategyRecommendationSnapshot> {
    this.database.prepare(`
      INSERT INTO strategy_recommendations (id, draft_session_id, evaluation_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        draft_session_id = excluded.draft_session_id,
        evaluation_json = excluded.evaluation_json,
        created_at = excluded.created_at
    `).run(
      snapshot.id,
      snapshot.draftSessionId,
      asJson(snapshot.evaluation),
      snapshot.createdAt,
    );
    return structuredClone(snapshot);
  }

  /** @inheritdoc */
  async getStrategyRecommendation(id: string): Promise<StrategyRecommendationSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const row = this.database.prepare(
      'SELECT * FROM strategy_recommendations WHERE id = ?',
    ).get<StrategyRecommendationRow>(id);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      draftSessionId: row.draft_session_id,
      evaluation: fromJson(row.evaluation_json, 'evaluation_json'),
      createdAt: row.created_at,
    };
  }

  /** @inheritdoc */
  async listStrategyRecommendations(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<StrategyRecommendationSnapshot>> {
    const page = this.querySnapshotPage<StrategyRecommendationRow>('strategy_recommendations', options);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        draftSessionId: row.draft_session_id,
        evaluation: fromJson(row.evaluation_json, 'evaluation_json'),
        createdAt: row.created_at,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** @inheritdoc */
  async saveObservabilityEvent(event: ObservabilityEventRecord): Promise<ObservabilityEventRecord> {
    this.database.prepare(`
      INSERT INTO observability_events (id, level, event_name, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        level = excluded.level,
        event_name = excluded.event_name,
        details_json = excluded.details_json,
        created_at = excluded.created_at
    `).run(
      event.id,
      event.level,
      event.eventName,
      asJson(event.details),
      event.createdAt,
    );
    return structuredClone(event);
  }

  /** @inheritdoc */
  async listObservabilityEvents(options: {
    level?: 'info' | 'error';
    eventName?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<SnapshotPage<ObservabilityEventRecord>> {
    if (options.level !== undefined && options.level !== 'info' && options.level !== 'error') {
      throw new TypeError('options.level must be "info" or "error".');
    }
    if (options.eventName !== undefined) {
      assertNonEmptyString(options.eventName, 'options.eventName');
    }

    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('options.limit must be an integer between 1 and 100.');
    }

    let cursorCreatedAt: string | undefined;
    let cursorId: string | undefined;
    if (options.cursor !== undefined) {
      assertNonEmptyString(options.cursor, 'options.cursor');
      [cursorCreatedAt, cursorId] = options.cursor.split('|');
      if (!cursorCreatedAt || !cursorId) {
        throw new TypeError('options.cursor must match "<createdAt>|<id>".');
      }
    }

    const whereClauses: string[] = [];
    const parameters: unknown[] = [];
    if (options.level !== undefined) {
      whereClauses.push('level = ?');
      parameters.push(options.level);
    }
    if (options.eventName !== undefined) {
      whereClauses.push('event_name = ?');
      parameters.push(options.eventName);
    }
    if (cursorCreatedAt !== undefined && cursorId !== undefined) {
      whereClauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
      parameters.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = this.database.prepare(`
      SELECT * FROM observability_events
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all<ObservabilityEventRow>(...parameters, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        level: row.level,
        eventName: row.event_name,
        details: fromJson(row.details_json, 'details_json'),
        createdAt: row.created_at,
      })),
      nextCursor: hasMore && lastRow ? `${lastRow.created_at}|${lastRow.id}` : null,
    };
  }

  /** @inheritdoc */
  async getObservabilitySummary(options: { sinceCreatedAt?: string } = {}): Promise<ObservabilitySummary> {
    if (options.sinceCreatedAt !== undefined) {
      assertNonEmptyString(options.sinceCreatedAt, 'options.sinceCreatedAt');
      if (Number.isNaN(Date.parse(options.sinceCreatedAt))) {
        throw new TypeError('options.sinceCreatedAt must be a valid ISO date string.');
      }
    }

    const whereSql = options.sinceCreatedAt === undefined ? '' : 'WHERE created_at >= ?';
    const parameters = options.sinceCreatedAt === undefined ? [] : [options.sinceCreatedAt];

    const totalRow = this.database.prepare(`
      SELECT COUNT(*) AS total_events
      FROM observability_events
      ${whereSql}
    `).get<{ total_events: number }>(...parameters);
    const byLevelRows = this.database.prepare(`
      SELECT level, COUNT(*) AS total
      FROM observability_events
      ${whereSql}
      GROUP BY level
    `).all<{ level: 'info' | 'error'; total: number }>(...parameters);
    const byEventRows = this.database.prepare(`
      SELECT event_name, COUNT(*) AS total
      FROM observability_events
      ${whereSql}
      GROUP BY event_name
    `).all<{ event_name: string; total: number }>(...parameters);

    const byLevel: ObservabilitySummary['byLevel'] = { info: 0, error: 0 };
    for (const row of byLevelRows) {
      byLevel[row.level] = row.total;
    }

    const byEventName = Object.fromEntries(
      byEventRows.map((row) => [row.event_name, row.total]),
    ) as Record<string, number>;

    return {
      totalEvents: totalRow?.total_events ?? 0,
      byLevel,
      byEventName,
    };
  }

  /** @inheritdoc */
  async getLatestStrategyRecommendation(draftSessionId?: string): Promise<StrategyRecommendationSnapshot | null> {
    const page = await this.listStrategyRecommendations({ draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  /** @inheritdoc */
  async deleteStaleStrategyRecommendations(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots('strategy_recommendations', options);
  }

  private querySnapshotPage<Row extends { id: string; draft_session_id: string | null; created_at: string }>(
    tableName: 'prediction_backtests' | 'heuristic_scores' | 'strategy_recommendations',
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): SnapshotPage<Row> {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('options.limit must be an integer between 1 and 100.');
    }
    if (options.draftSessionId !== undefined) {
      assertNonEmptyString(options.draftSessionId, 'options.draftSessionId');
    }

    let cursorCreatedAt: string | undefined;
    let cursorId: string | undefined;
    if (options.cursor !== undefined) {
      assertNonEmptyString(options.cursor, 'options.cursor');
      [cursorCreatedAt, cursorId] = options.cursor.split('|');
      if (!cursorCreatedAt || !cursorId) {
        throw new TypeError('options.cursor must match "<createdAt>|<id>".');
      }
    }

    const whereClauses: string[] = [];
    const parameters: unknown[] = [];
    if (options.draftSessionId !== undefined) {
      whereClauses.push('draft_session_id = ?');
      parameters.push(options.draftSessionId);
    }
    if (cursorCreatedAt !== undefined && cursorId !== undefined) {
      whereClauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
      parameters.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT * FROM ${tableName}
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    const rows = this.database.prepare(query).all<Row>(...parameters, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows,
      nextCursor: hasMore && lastRow ? `${lastRow.created_at}|${lastRow.id}` : null,
    };
  }

  private deleteStaleSnapshots(
    tableName: 'prediction_backtests' | 'heuristic_scores' | 'strategy_recommendations',
    options: { keepLatest: number; draftSessionId?: string },
  ): number {
    if (!Number.isInteger(options.keepLatest) || options.keepLatest < 0 || options.keepLatest > 1000) {
      throw new TypeError('options.keepLatest must be an integer between 0 and 1000.');
    }
    if (options.draftSessionId !== undefined) {
      assertNonEmptyString(options.draftSessionId, 'options.draftSessionId');
    }

    const whereClauses: string[] = [];
    const parameters: unknown[] = [];
    if (options.draftSessionId !== undefined) {
      whereClauses.push('draft_session_id = ?');
      parameters.push(options.draftSessionId);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const staleRows = this.database.prepare(`
      SELECT id FROM ${tableName}
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT -1 OFFSET ?
    `).all<{ id: string }>(...parameters, options.keepLatest);

    if (staleRows.length === 0) {
      return 0;
    }

    const deleteById = this.database.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
    for (const row of staleRows) {
      deleteById.run(row.id);
    }

    return staleRows.length;
  }
}

type LeagueRow = {
  id: string;
  provider_league_id: string;
  name: string;
  scoring_format: string;
  roster_settings_json: string;
  timezone: string;
  created_at: string;
};

type PickRow = {
  id: string;
  league_id: string;
  season: number;
  round: number;
  overall_pick: number;
  manager_id: string;
  player_id: string;
  adp_at_pick: number | null;
  reach_delta: number | null;
  picked_at: string;
};

type SessionRow = {
  id: string;
  league_id: string;
  season: number;
  status: string;
  strategy_profile: string;
  current_pick: number | null;
  polling_interval_seconds: number;
  created_at: string;
};

type PredictionBacktestRow = {
  id: string;
  draft_session_id: string | null;
  result_json: string;
  created_at: string;
};

type HeuristicScoreRow = {
  id: string;
  draft_session_id: string | null;
  weights_json: string;
  candidates_json: string;
  created_at: string;
};

type StrategyRecommendationRow = {
  id: string;
  draft_session_id: string | null;
  evaluation_json: string;
  created_at: string;
};

type ObservabilityEventRow = {
  id: string;
  level: 'info' | 'error';
  event_name: string;
  details_json: string;
  created_at: string;
};
