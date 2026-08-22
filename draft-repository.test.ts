import { describe, expect, it } from 'vitest';

import { DraftPick, DraftSession } from './draft-models.js';
import { getLatestSessionForLeague, getLeaguePickCount, InMemoryDraftRepository } from './draft-repository.js';

describe('InMemoryDraftRepository', () => {
  it('stores and retrieves picks by league', () => {
    const repository = new InMemoryDraftRepository();
    const pick = new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' });

    repository.savePick(pick);

    expect(repository.getPicksForLeague('league-1')).toEqual([pick]);
  });

  it('tracks the most recent draft session for a league', () => {
    const repository = new InMemoryDraftRepository();
    const first = new DraftSession({ leagueId: 'league-1', season: 2025, status: 'PRE_DRAFT', strategyProfile: 'BALANCED' });
    const second = new DraftSession({ leagueId: 'league-1', season: 2025, status: 'LIVE', strategyProfile: 'HERO_RB', currentPick: 3 });

    repository.saveSession(first);
    repository.saveSession(second);

    expect(getLatestSessionForLeague(repository, 'league-1')).toEqual(second);
  });
});

describe('getLeaguePickCount', () => {
  it('returns the total number of picks for a league', () => {
    const repository = new InMemoryDraftRepository();
    repository.savePick(new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 1, managerId: 'm1', playerId: 'p1' }));
    repository.savePick(new DraftPick({ leagueId: 'league-1', season: 2025, round: 1, overallPick: 2, managerId: 'm2', playerId: 'p2' }));

    expect(getLeaguePickCount(repository, 'league-1')).toBe(2);
  });
});
