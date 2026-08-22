import { describe, expect, it } from 'vitest';

import { DraftPick, DraftSession, League, Manager, Player } from '../../../draft-models.js';
import { InMemoryDraftRepository } from '../../storage/repositories/draft-repository.js';
import { getLeagueSnapshot } from './draft.js';

describe('getLeagueSnapshot', () => {
  it('returns persisted league, session, and picks', async () => {
    const repository = new InMemoryDraftRepository();
    const league = new League({
      id: 'league-1',
      providerLeagueId: 'provider-1',
      name: 'League',
      scoringFormat: 'PPR',
      rosterSettings: { starters: { WR: 2 }, bench: 5 },
      timezone: 'UTC',
    });
    const manager = new Manager({ id: 'manager-1', leagueId: league.id, displayName: 'Manager' });
    const player = new Player({ id: 'player-1', fullName: 'Player One', position: 'WR', team: 'BUF' });
    const pick = new DraftPick({
      id: 'pick-1', leagueId: league.id, season: 2025, round: 1, overallPick: 1,
      managerId: manager.id, playerId: player.id,
    });
    const session = new DraftSession({
      id: 'session-1', leagueId: league.id, season: 2025, status: 'LIVE', strategyProfile: 'BALANCED',
    });

    await repository.saveLeague(league);
    await repository.saveManagers([manager]);
    await repository.savePlayers([player]);
    await repository.savePicks([pick]);
    await repository.saveSession(session);

    const snapshot = await getLeagueSnapshot(repository, league.id, 2025);

    expect(snapshot?.league).toMatchObject({ id: league.id, name: 'League' });
    expect(snapshot?.session).toMatchObject({ id: session.id, status: 'LIVE' });
    expect(snapshot?.picks).toHaveLength(1);
  });

  it('returns null for an unknown league', async () => {
    const snapshot = await getLeagueSnapshot(new InMemoryDraftRepository(), 'missing');

    expect(snapshot).toBeNull();
  });
});
