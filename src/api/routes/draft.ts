import type { DraftRepository } from '../../storage/repositories/draft-repository.js';

export interface LeagueSnapshot {
  league: Record<string, unknown>;
  session: Record<string, unknown> | null;
  picks: Record<string, unknown>[];
  generatedAt: string;
}

/**
 * Build a persisted league snapshot for the live draft board.
 *
 * @param repository - Repository containing normalized draft state.
 * @param leagueId - League identifier.
 * @param season - Optional season filter for picks.
 * @returns Serializable league snapshot, or null when the league is unknown.
 */
export async function getLeagueSnapshot(
  repository: DraftRepository,
  leagueId: string,
  season?: number,
): Promise<LeagueSnapshot | null> {
  const league = await repository.getLeague(leagueId);
  if (!league) {
    return null;
  }

  const [session, picks] = await Promise.all([
    repository.getLatestSession(leagueId),
    repository.getPicksForLeague(leagueId, season),
  ]);

  return {
    league: league.toJSON(),
    session: session?.toJSON() ?? null,
    picks: picks.map((pick) => pick.toJSON()),
    generatedAt: new Date().toISOString(),
  };
}
