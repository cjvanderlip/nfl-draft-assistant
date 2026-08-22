/**
 * Persistence contracts and an in-memory repository for draft-related entities.
 */

import { DraftPick, DraftSession, type DraftStatus } from './draft-models.js';
import { assertArray, assertNonEmptyString, assertObject } from './validators.js';

export interface DraftRepository {
  savePick(pick: DraftPick): DraftPick;
  getPicksForLeague(leagueId: string): DraftPick[];
  saveSession(session: DraftSession): DraftSession;
  getSessionsForLeague(leagueId: string): DraftSession[];
}

/**
 * In-memory repository used for local draft orchestration and testing.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private readonly picksByLeague = new Map<string, DraftPick[]>();
  private readonly sessionsByLeague = new Map<string, DraftSession[]>();

  savePick(pick: DraftPick): DraftPick {
    assertObject(pick, 'pick');
    const leaguePicks = this.picksByLeague.get(pick.leagueId) ?? [];
    leaguePicks.push(pick);
    this.picksByLeague.set(pick.leagueId, leaguePicks);
    return pick;
  }

  getPicksForLeague(leagueId: string): DraftPick[] {
    assertNonEmptyString(leagueId, 'leagueId');
    return [...(this.picksByLeague.get(leagueId) ?? [])];
  }

  saveSession(session: DraftSession): DraftSession {
    assertObject(session, 'session');
    const leagueSessions = this.sessionsByLeague.get(session.leagueId) ?? [];
    leagueSessions.push(session);
    this.sessionsByLeague.set(session.leagueId, leagueSessions);
    return session;
  }

  getSessionsForLeague(leagueId: string): DraftSession[] {
    assertNonEmptyString(leagueId, 'leagueId');
    return [...(this.sessionsByLeague.get(leagueId) ?? [])];
  }
}

/**
 * Get the most recent active draft session for a league.
 *
 * @param repository - Repository implementation.
 * @param leagueId - League identifier.
 * @returns Most recent session or null if none are found.
 */
export function getLatestSessionForLeague(
  repository: DraftRepository,
  leagueId: string,
): DraftSession | null {
  assertNonEmptyString(leagueId, 'leagueId');
  assertObject(repository, 'repository');

  const sessions = repository.getSessionsForLeague(leagueId);
  return sessions.length === 0 ? null : sessions[sessions.length - 1];
}

/**
 * Compute an aggregate pick count for a league using the repository abstraction.
 *
 * @param repository - Repository implementation.
 * @param leagueId - League identifier.
 * @returns Total pick count.
 */
export function getLeaguePickCount(repository: DraftRepository, leagueId: string): number {
  assertNonEmptyString(leagueId, 'leagueId');
  assertObject(repository, 'repository');
  const picks = repository.getPicksForLeague(leagueId);
  return picks.length;
}
