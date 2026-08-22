import { DraftPick, DraftSession, League, Manager, Player } from '../../draft-models.js';
import { assertNonEmptyString, assertObject } from '../../validators.js';
import type { DraftRepository } from '../storage/repositories/draft-repository.js';
import type { DependencyHealthTracker } from './dependency-health.js';

export interface ProviderLeagueState {
  league: League;
  managers: Manager[];
  players: Player[];
  picks: DraftPick[];
  currentPick?: number;
  status?: DraftSession['status'];
}

export interface IngestionRefreshResult {
  session: DraftSession;
  newPicks: DraftPick[];
  picks: DraftPick[];
  refreshedAt: string;
  durationMs: number;
  warning?: string;
}

export interface DraftProvider {
  getLeagueState(leagueId: string, season: number): Promise<ProviderLeagueState>;
}

/**
 * Ingest one provider snapshot and update the persisted draft session.
 *
 * @param session - Live session to refresh.
 * @param provider - Provider adapter returning normalized league state.
 * @param repository - Persistence boundary for the normalized state.
 * @returns New picks, complete persisted picks, and optional failure warning.
 */
export async function refreshDraftSession({
  session,
  provider,
  repository,
  healthTracker,
}: {
  session: DraftSession;
  provider: DraftProvider;
  repository: DraftRepository;
  healthTracker?: DependencyHealthTracker;
}): Promise<IngestionRefreshResult> {
  assertObject(session, 'session');
  assertObject(provider, 'provider');
  assertObject(repository, 'repository');
  assertNonEmptyString(session.leagueId, 'session.leagueId');

  const startedAt = Date.now();
  let existingPicks: DraftPick[] = [];
  let failedDependency: 'database' | 'provider' = 'database';

  try {
    existingPicks = await repository.getPicksForLeague(session.leagueId, session.season);
    healthTracker?.markSuccess('database');
    failedDependency = 'provider';
    const existingPickIds = new Set(existingPicks.map((pick) => pick.id));
    const state = await provider.getLeagueState(session.leagueId, session.season);
    healthTracker?.markSuccess('provider');
    failedDependency = 'database';
    assertObject(state, 'provider state');
    if (state.league.id !== session.leagueId) {
      throw new Error('Provider returned a league that does not match the draft session.');
    }

    const newPicks = state.picks.filter((pick) => !existingPickIds.has(pick.id));
    await repository.saveLeague(state.league);
    await repository.saveManagers(state.managers);
    await repository.savePlayers(state.players);
    await repository.savePicks(state.picks);

    if (state.currentPick !== undefined) {
      session.currentPick = state.currentPick;
    } else if (state.picks.length > 0) {
      session.currentPick = Math.max(...state.picks.map((pick) => pick.overallPick)) + 1;
    }
    if (state.status !== undefined) {
      session.status = state.status;
    }
    await repository.saveSession(session);
    healthTracker?.markSuccess('database');

    return {
      session,
      newPicks,
      picks: await repository.getPicksForLeague(session.leagueId, session.season),
      refreshedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown provider failure.';
    healthTracker?.markFailure(failedDependency);
    console.error(`Draft refresh failed for ${session.leagueId}: ${message}`);
    return {
      session,
      newPicks: [],
      picks: existingPicks,
      refreshedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      warning: `Using last-known-good draft state: ${message}`,
    };
  }
}

export interface LiveIngestionOptions {
  session: DraftSession;
  provider: DraftProvider;
  repository: DraftRepository;
  healthTracker?: DependencyHealthTracker;
  onRefresh?: (result: IngestionRefreshResult) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface LiveIngestionController {
  stop(): void;
  isRunning(): boolean;
}

/**
 * Start a non-overlapping polling loop for a live draft session.
 *
 * @param options - Session, provider, repository, and refresh callbacks.
 * @returns Controller used to stop the polling loop.
 */
export function startLiveIngestion(options: LiveIngestionOptions): LiveIngestionController {
  assertObject(options, 'options');
  assertObject(options.session, 'options.session');
  assertObject(options.provider, 'options.provider');
  assertObject(options.repository, 'options.repository');

  let running = true;
  let scheduledTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInProgress = false;

  const scheduleNextRefresh = (): void => {
    if (!running || options.session.status === 'COMPLETE') {
      running = false;
      return;
    }
    scheduledTimer = setTimeout(() => {
      void refreshOnce();
    }, options.session.pollingIntervalSeconds * 1000);
  };

  const refreshOnce = async (): Promise<void> => {
    if (!running || refreshInProgress) {
      return;
    }
    refreshInProgress = true;
    try {
      const result = await refreshDraftSession(options);
      await options.onRefresh?.(result);
    } catch (error: unknown) {
      await options.onError?.(error);
    } finally {
      refreshInProgress = false;
      scheduleNextRefresh();
    }
  };

  void refreshOnce();

  return {
    stop: () => {
      running = false;
      if (scheduledTimer !== undefined) {
        clearTimeout(scheduledTimer);
        scheduledTimer = undefined;
      }
    },
    isRunning: () => running,
  };
}
