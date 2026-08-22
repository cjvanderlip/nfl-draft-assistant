import {
  DraftPick,
  DraftSession,
  League,
  Manager,
  Player,
} from '../../../draft-models.js';
import { assertArray, assertNonEmptyString, assertObject } from '../../../validators.js';
import type { PredictionBacktestResult } from '../../services/prediction-engine.js';
import type { HeuristicWeights, ScoredHeuristicCandidate } from '../../services/heuristic-scorer.js';
import type { StrategyRosterEvaluation } from '../../services/roster-strategy.js';
import type { ObservabilityEvent } from '../../services/observability.js';

export interface PredictionBacktestSnapshot {
  id: string;
  draftSessionId: string | null;
  result: PredictionBacktestResult;
  createdAt: string;
}

export interface HeuristicScoreSnapshot {
  id: string;
  draftSessionId: string | null;
  weights: HeuristicWeights;
  candidates: ScoredHeuristicCandidate[];
  createdAt: string;
}

export interface StrategyRecommendationSnapshot {
  id: string;
  draftSessionId: string | null;
  evaluation: StrategyRosterEvaluation;
  createdAt: string;
}

export interface SnapshotPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ObservabilityEventRecord {
  id: string;
  level: ObservabilityEvent['level'];
  eventName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ObservabilitySummary {
  totalEvents: number;
  byLevel: Record<'info' | 'error', number>;
  byEventName: Record<string, number>;
}

/**
 * Persistence boundary used by ingestion and draft services.
 */
export interface DraftRepository {
  saveLeague(league: League): Promise<League>;
  getLeague(leagueId: string): Promise<League | null>;
  saveManagers(managers: Manager[]): Promise<void>;
  savePlayers(players: Player[]): Promise<void>;
  savePicks(picks: DraftPick[]): Promise<void>;
  getPicksForLeague(leagueId: string, season?: number): Promise<DraftPick[]>;
  saveSession(session: DraftSession): Promise<DraftSession>;
  getLatestSession(leagueId: string): Promise<DraftSession | null>;
  savePredictionBacktest(snapshot: PredictionBacktestSnapshot): Promise<PredictionBacktestSnapshot>;
  getPredictionBacktest(id: string): Promise<PredictionBacktestSnapshot | null>;
  listPredictionBacktests(options?: { draftSessionId?: string; limit?: number; cursor?: string }): Promise<SnapshotPage<PredictionBacktestSnapshot>>;
  getLatestPredictionBacktest(draftSessionId?: string): Promise<PredictionBacktestSnapshot | null>;
  deleteStalePredictionBacktests(options: { keepLatest: number; draftSessionId?: string }): Promise<number>;
  saveHeuristicScore(snapshot: HeuristicScoreSnapshot): Promise<HeuristicScoreSnapshot>;
  getHeuristicScore(id: string): Promise<HeuristicScoreSnapshot | null>;
  listHeuristicScores(options?: { draftSessionId?: string; limit?: number; cursor?: string }): Promise<SnapshotPage<HeuristicScoreSnapshot>>;
  getLatestHeuristicScore(draftSessionId?: string): Promise<HeuristicScoreSnapshot | null>;
  deleteStaleHeuristicScores(options: { keepLatest: number; draftSessionId?: string }): Promise<number>;
  saveStrategyRecommendation(snapshot: StrategyRecommendationSnapshot): Promise<StrategyRecommendationSnapshot>;
  getStrategyRecommendation(id: string): Promise<StrategyRecommendationSnapshot | null>;
  listStrategyRecommendations(options?: { draftSessionId?: string; limit?: number; cursor?: string }): Promise<SnapshotPage<StrategyRecommendationSnapshot>>;
  getLatestStrategyRecommendation(draftSessionId?: string): Promise<StrategyRecommendationSnapshot | null>;
  deleteStaleStrategyRecommendations(options: { keepLatest: number; draftSessionId?: string }): Promise<number>;
  saveObservabilityEvent(event: ObservabilityEventRecord): Promise<ObservabilityEventRecord>;
  listObservabilityEvents(options?: {
    level?: ObservabilityEvent['level'];
    eventName?: string;
    limit?: number;
    cursor?: string;
  }): Promise<SnapshotPage<ObservabilityEventRecord>>;
  getObservabilitySummary(options?: { sinceCreatedAt?: string }): Promise<ObservabilitySummary>;
}

/**
 * In-memory repository for deterministic local development and tests.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private readonly leagues = new Map<string, League>();
  private readonly managers = new Map<string, Manager>();
  private readonly players = new Map<string, Player>();
  private readonly picks = new Map<string, DraftPick>();
  private readonly sessions = new Map<string, DraftSession[]>();
  private readonly predictionBacktests = new Map<string, PredictionBacktestSnapshot>();
  private readonly heuristicScores = new Map<string, HeuristicScoreSnapshot>();
  private readonly strategyRecommendations = new Map<string, StrategyRecommendationSnapshot>();
  private readonly observabilityEvents = new Map<string, ObservabilityEventRecord>();
  private readonly defaultSnapshotPageLimit = 25;

  async saveLeague(league: League): Promise<League> {
    assertObject(league, 'league');
    this.leagues.set(league.id, league);
    return league;
  }

  async getLeague(leagueId: string): Promise<League | null> {
    assertNonEmptyString(leagueId, 'leagueId');
    return this.leagues.get(leagueId) ?? null;
  }

  async saveManagers(managers: Manager[]): Promise<void> {
    assertArray(managers, 'managers');
    for (const manager of managers) {
      assertObject(manager, 'manager');
      this.managers.set(manager.id, manager);
    }
  }

  async savePlayers(players: Player[]): Promise<void> {
    assertArray(players, 'players');
    for (const player of players) {
      assertObject(player, 'player');
      this.players.set(player.id, player);
    }
  }

  async savePicks(picks: DraftPick[]): Promise<void> {
    assertArray(picks, 'picks');
    for (const pick of picks) {
      assertObject(pick, 'pick');
      this.picks.set(pick.id, pick);
    }
  }

  async getPicksForLeague(leagueId: string, season?: number): Promise<DraftPick[]> {
    assertNonEmptyString(leagueId, 'leagueId');
    return [...this.picks.values()]
      .filter((pick) => pick.leagueId === leagueId && (season === undefined || pick.season === season))
      .sort((left, right) => left.overallPick - right.overallPick);
  }

  async saveSession(session: DraftSession): Promise<DraftSession> {
    assertObject(session, 'session');
    const leagueSessions = this.sessions.get(session.leagueId) ?? [];
    const existingIndex = leagueSessions.findIndex((existing) => existing.id === session.id);
    if (existingIndex >= 0) {
      leagueSessions[existingIndex] = session;
    } else {
      leagueSessions.push(session);
    }
    this.sessions.set(session.leagueId, leagueSessions);
    return session;
  }

  async getLatestSession(leagueId: string): Promise<DraftSession | null> {
    assertNonEmptyString(leagueId, 'leagueId');
    const leagueSessions = this.sessions.get(leagueId) ?? [];
    return leagueSessions.at(-1) ?? null;
  }

  async savePredictionBacktest(snapshot: PredictionBacktestSnapshot): Promise<PredictionBacktestSnapshot> {
    assertObject(snapshot, 'snapshot');
    assertNonEmptyString(snapshot.id, 'snapshot.id');
    this.predictionBacktests.set(snapshot.id, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async getPredictionBacktest(id: string): Promise<PredictionBacktestSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const snapshot = this.predictionBacktests.get(id);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async listPredictionBacktests(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<PredictionBacktestSnapshot>> {
    return this.listSnapshots([...this.predictionBacktests.values()], options);
  }

  async getLatestPredictionBacktest(draftSessionId?: string): Promise<PredictionBacktestSnapshot | null> {
    const page = this.listSnapshots([...this.predictionBacktests.values()], { draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  async deleteStalePredictionBacktests(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots(this.predictionBacktests, options);
  }

  async saveHeuristicScore(snapshot: HeuristicScoreSnapshot): Promise<HeuristicScoreSnapshot> {
    assertObject(snapshot, 'snapshot');
    assertNonEmptyString(snapshot.id, 'snapshot.id');
    this.heuristicScores.set(snapshot.id, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async getHeuristicScore(id: string): Promise<HeuristicScoreSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const snapshot = this.heuristicScores.get(id);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async listHeuristicScores(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<HeuristicScoreSnapshot>> {
    return this.listSnapshots([...this.heuristicScores.values()], options);
  }

  async getLatestHeuristicScore(draftSessionId?: string): Promise<HeuristicScoreSnapshot | null> {
    const page = this.listSnapshots([...this.heuristicScores.values()], { draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  async deleteStaleHeuristicScores(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots(this.heuristicScores, options);
  }

  async saveStrategyRecommendation(snapshot: StrategyRecommendationSnapshot): Promise<StrategyRecommendationSnapshot> {
    assertObject(snapshot, 'snapshot');
    assertNonEmptyString(snapshot.id, 'snapshot.id');
    this.strategyRecommendations.set(snapshot.id, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async getStrategyRecommendation(id: string): Promise<StrategyRecommendationSnapshot | null> {
    assertNonEmptyString(id, 'id');
    const snapshot = this.strategyRecommendations.get(id);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async listStrategyRecommendations(
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<SnapshotPage<StrategyRecommendationSnapshot>> {
    return this.listSnapshots([...this.strategyRecommendations.values()], options);
  }

  async getLatestStrategyRecommendation(draftSessionId?: string): Promise<StrategyRecommendationSnapshot | null> {
    const page = this.listSnapshots([...this.strategyRecommendations.values()], { draftSessionId, limit: 1 });
    return page.items.at(0) ?? null;
  }

  async deleteStaleStrategyRecommendations(options: { keepLatest: number; draftSessionId?: string }): Promise<number> {
    return this.deleteStaleSnapshots(this.strategyRecommendations, options);
  }

  async saveObservabilityEvent(event: ObservabilityEventRecord): Promise<ObservabilityEventRecord> {
    assertObject(event, 'event');
    assertNonEmptyString(event.id, 'event.id');
    assertNonEmptyString(event.eventName, 'event.eventName');
    if (event.level !== 'info' && event.level !== 'error') {
      throw new TypeError('event.level must be "info" or "error".');
    }
    assertObject(event.details, 'event.details');
    assertNonEmptyString(event.createdAt, 'event.createdAt');
    this.observabilityEvents.set(event.id, structuredClone(event));
    return structuredClone(event);
  }

  async listObservabilityEvents(options: {
    level?: ObservabilityEvent['level'];
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

    const filtered = [...this.observabilityEvents.values()].filter((event) => {
      if (options.level !== undefined && event.level !== options.level) {
        return false;
      }
      if (options.eventName !== undefined && event.eventName !== options.eventName) {
        return false;
      }
      return true;
    });

    return this.listTimestampedRecords(filtered, options);
  }

  async getObservabilitySummary(
    options: { sinceCreatedAt?: string } = {},
  ): Promise<ObservabilitySummary> {
    if (options.sinceCreatedAt !== undefined) {
      assertNonEmptyString(options.sinceCreatedAt, 'options.sinceCreatedAt');
      if (Number.isNaN(Date.parse(options.sinceCreatedAt))) {
        throw new TypeError('options.sinceCreatedAt must be a valid ISO date string.');
      }
    }

    const summary: ObservabilitySummary = {
      totalEvents: 0,
      byLevel: { info: 0, error: 0 },
      byEventName: {},
    };
    for (const event of this.observabilityEvents.values()) {
      if (options.sinceCreatedAt !== undefined && event.createdAt < options.sinceCreatedAt) {
        continue;
      }
      summary.totalEvents += 1;
      summary.byLevel[event.level] += 1;
      summary.byEventName[event.eventName] = (summary.byEventName[event.eventName] ?? 0) + 1;
    }
    return summary;
  }

  private listSnapshots<T extends { id: string; draftSessionId: string | null; createdAt: string }>(
    snapshots: T[],
    options: { draftSessionId?: string; limit?: number; cursor?: string } = {},
  ): SnapshotPage<T> {
    const limit = options.limit ?? this.defaultSnapshotPageLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('options.limit must be an integer between 1 and 100.');
    }
    if (options.draftSessionId !== undefined) {
      assertNonEmptyString(options.draftSessionId, 'options.draftSessionId');
    }

    let filtered = snapshots;
    if (options.draftSessionId !== undefined) {
      filtered = filtered.filter((snapshot) => snapshot.draftSessionId === options.draftSessionId);
    }

    const ordered = [...filtered].sort((left, right) => {
      const createdCompare = right.createdAt.localeCompare(left.createdAt);
      if (createdCompare !== 0) {
        return createdCompare;
      }
      return right.id.localeCompare(left.id);
    });

    let startIndex = 0;
    if (options.cursor !== undefined) {
      assertNonEmptyString(options.cursor, 'options.cursor');
      const [cursorCreatedAt, cursorId] = options.cursor.split('|');
      if (!cursorCreatedAt || !cursorId) {
        throw new TypeError('options.cursor must match "<createdAt>|<id>".');
      }
      const cursorIndex = ordered.findIndex(
        (snapshot) => snapshot.createdAt === cursorCreatedAt && snapshot.id === cursorId,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : ordered.length;
    }

    const pageItems = ordered.slice(startIndex, startIndex + limit);
    const lastItem = pageItems.at(-1);
    const hasMore = startIndex + limit < ordered.length;

    return {
      items: structuredClone(pageItems),
      nextCursor: hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : null,
    };
  }

  private deleteStaleSnapshots<T extends { id: string; draftSessionId: string | null; createdAt: string }>(
    snapshotMap: Map<string, T>,
    options: { keepLatest: number; draftSessionId?: string },
  ): number {
    if (!Number.isInteger(options.keepLatest) || options.keepLatest < 0 || options.keepLatest > 1000) {
      throw new TypeError('options.keepLatest must be an integer between 0 and 1000.');
    }
    if (options.draftSessionId !== undefined) {
      assertNonEmptyString(options.draftSessionId, 'options.draftSessionId');
    }

    const ordered = this.listSnapshots([...snapshotMap.values()], {
      draftSessionId: options.draftSessionId,
      limit: 100,
    });
    const allIds: string[] = [...ordered.items.map((item) => item.id)];
    let cursor = ordered.nextCursor;
    while (cursor !== null) {
      const nextPage = this.listSnapshots([...snapshotMap.values()], {
        draftSessionId: options.draftSessionId,
        limit: 100,
        cursor,
      });
      allIds.push(...nextPage.items.map((item) => item.id));
      cursor = nextPage.nextCursor;
    }

    const toDelete = allIds.slice(options.keepLatest);
    for (const id of toDelete) {
      snapshotMap.delete(id);
    }
    return toDelete.length;
  }

  private listTimestampedRecords<T extends { id: string; createdAt: string }>(
    entries: T[],
    options: { limit?: number; cursor?: string },
  ): SnapshotPage<T> {
    const limit = options.limit ?? this.defaultSnapshotPageLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('options.limit must be an integer between 1 and 100.');
    }

    const ordered = [...entries].sort((left, right) => {
      const createdCompare = right.createdAt.localeCompare(left.createdAt);
      if (createdCompare !== 0) {
        return createdCompare;
      }
      return right.id.localeCompare(left.id);
    });

    let startIndex = 0;
    if (options.cursor !== undefined) {
      assertNonEmptyString(options.cursor, 'options.cursor');
      const [cursorCreatedAt, cursorId] = options.cursor.split('|');
      if (!cursorCreatedAt || !cursorId) {
        throw new TypeError('options.cursor must match "<createdAt>|<id>".');
      }
      const cursorIndex = ordered.findIndex(
        (entry) => entry.createdAt === cursorCreatedAt && entry.id === cursorId,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : ordered.length;
    }

    const pageItems = ordered.slice(startIndex, startIndex + limit);
    const lastItem = pageItems.at(-1);
    const hasMore = startIndex + limit < ordered.length;
    return {
      items: structuredClone(pageItems),
      nextCursor: hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : null,
    };
  }
}
