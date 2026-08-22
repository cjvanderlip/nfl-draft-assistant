import { afterEach, describe, expect, it, vi } from 'vitest';

import { DraftPick, DraftSession, League, Manager, Player } from '../../draft-models.js';
import { InMemoryDraftRepository } from '../storage/repositories/draft-repository.js';
import { createDependencyHealthTracker } from './dependency-health.js';
import { refreshDraftSession, startLiveIngestion, type ProviderLeagueState } from './ingestion-service.js';

function createState(league: League, pick: DraftPick): ProviderLeagueState {
  return {
    league,
    managers: [new Manager({ id: 'manager-1', leagueId: league.id, displayName: 'Manager' })],
    players: [new Player({ id: 'player-1', fullName: 'Player One', position: 'WR', team: 'BUF' })],
    picks: [pick],
    currentPick: 2,
    status: 'LIVE',
  };
}

describe('refreshDraftSession', () => {
  it('persists new picks and advances the session cursor', async () => {
    const repository = new InMemoryDraftRepository();
    const league = new League({
      id: 'league-1',
      providerLeagueId: 'provider-1',
      name: 'League',
      scoringFormat: 'PPR',
      rosterSettings: { starters: { WR: 2 }, bench: 5 },
      timezone: 'UTC',
    });
    const session = new DraftSession({
      id: 'session-1',
      leagueId: league.id,
      season: 2025,
      status: 'LIVE',
      strategyProfile: 'BALANCED',
      currentPick: 1,
    });
    const pick = new DraftPick({
      id: 'pick-1',
      leagueId: league.id,
      season: 2025,
      round: 1,
      overallPick: 1,
      managerId: 'manager-1',
      playerId: 'player-1',
    });

    const result = await refreshDraftSession({
      session,
      repository,
      provider: { getLeagueState: async () => createState(league, pick) },
    });

    expect(result.newPicks).toEqual([pick]);
    expect(result.picks).toEqual([pick]);
    expect(result.session.currentPick).toBe(2);
    expect(result.warning).toBeUndefined();
  });

  it('returns the last-known-good state when the provider fails', async () => {
    const repository = new InMemoryDraftRepository();
    const session = new DraftSession({
      id: 'session-1',
      leagueId: 'league-1',
      season: 2025,
      status: 'LIVE',
      strategyProfile: 'BALANCED',
    });

    const result = await refreshDraftSession({
      session,
      repository,
      provider: {
        getLeagueState: async () => {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(result.picks).toEqual([]);
    expect(result.newPicks).toEqual([]);
    expect(result.warning).toContain('provider unavailable');
  });

  it('updates dependency health based on refresh outcomes', async () => {
    const repository = new InMemoryDraftRepository();
    const session = new DraftSession({
      id: 'session-1',
      leagueId: 'league-1',
      season: 2025,
      status: 'LIVE',
      strategyProfile: 'BALANCED',
    });
    const healthTracker = createDependencyHealthTracker();

    await refreshDraftSession({
      session,
      repository,
      healthTracker,
      provider: {
        getLeagueState: async () => {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(healthTracker.getCurrentHealth()).toMatchObject({
      database: 'ok',
      provider: 'degraded',
    });
  });
});

describe('startLiveIngestion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes immediately and on the configured interval without overlapping', async () => {
    vi.useFakeTimers();
    const repository = new InMemoryDraftRepository();
    const league = new League({
      id: 'league-1',
      providerLeagueId: 'provider-1',
      name: 'League',
      scoringFormat: 'PPR',
      rosterSettings: { starters: { WR: 2 }, bench: 5 },
      timezone: 'UTC',
    });
    const session = new DraftSession({
      id: 'session-1',
      leagueId: league.id,
      season: 2025,
      status: 'LIVE',
      strategyProfile: 'BALANCED',
      pollingIntervalSeconds: 5,
    });
    const pick = new DraftPick({
      id: 'pick-1',
      leagueId: league.id,
      season: 2025,
      round: 1,
      overallPick: 1,
      managerId: 'manager-1',
      playerId: 'player-1',
    });
    let providerCalls = 0;
    let refreshes = 0;

    const controller = startLiveIngestion({
      session,
      repository,
      provider: {
        getLeagueState: async () => {
          providerCalls += 1;
          return createState(league, pick);
        },
      },
      onRefresh: () => {
        refreshes += 1;
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(providerCalls).toBe(1);
    expect(refreshes).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(providerCalls).toBe(2);
    expect(refreshes).toBe(2);
    expect(controller.isRunning()).toBe(true);

    controller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(providerCalls).toBe(2);
    expect(controller.isRunning()).toBe(false);
  });
});
