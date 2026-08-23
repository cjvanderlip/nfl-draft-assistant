import { assertNonEmptyString } from '../../validators.js';

export interface OwnerIdentity {
  ownerId: string;
  displayName: string;
  crossLeague: boolean;
}

/**
 * Team names that belong to the same human across the A and B leagues.
 *
 * Pooling these gives roughly a hundred picks of history instead of fifty, which
 * matters most for Espanola, whose quarterback tell measures +30.6 in one league
 * and +32.3 in the other.
 */
const CROSS_LEAGUE_OWNERS: Array<{ ownerId: string; displayName: string; teamPatterns: RegExp[] }> = [
  {
    ownerId: 'owner-vandals',
    displayName: 'Vandals',
    teamPatterns: [/^northern virginia vandals$/, /^deer valley vandals$/],
  },
  {
    ownerId: 'owner-roswell-aliens',
    displayName: 'Roswell Aliens',
    teamPatterns: [/^roswell aliens$/],
  },
  {
    ownerId: 'owner-espanola',
    displayName: 'Espanola',
    teamPatterns: [/^espanola hornets$/, /^espanola chil[ei]$/],
  },
];

/**
 * Normalize a raw team name from a draft export.
 *
 * The exports carry trailing spaces and year-to-year spelling drift
 * ("Espanola chile" became "Espanola chili"), so names are lowercased and
 * whitespace-collapsed before any comparison.
 *
 * @param teamName - Raw team name from a CSV row.
 * @returns Normalized team name.
 */
export function normalizeTeamName(teamName: string): string {
  assertNonEmptyString(teamName, 'teamName');
  return teamName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a team name to the owner that drafts under it.
 *
 * Teams with no cross-league partner get an owner identity derived from their own
 * name, so every manager has exactly one owner key regardless of pooling.
 *
 * @param teamName - Raw team name from a draft export.
 * @returns Owner identity for tendency aggregation.
 */
export function resolveOwner(teamName: string): OwnerIdentity {
  const normalized = normalizeTeamName(teamName);

  for (const owner of CROSS_LEAGUE_OWNERS) {
    if (owner.teamPatterns.some((pattern) => pattern.test(normalized))) {
      return { ownerId: owner.ownerId, displayName: owner.displayName, crossLeague: true };
    }
  }

  return {
    ownerId: `owner-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    displayName: teamName.trim(),
    crossLeague: false,
  };
}

/**
 * Report whether a team name belongs to the user.
 *
 * @param teamName - Raw team name from a draft export.
 * @returns True when the team is one of the user's own.
 */
export function isUserTeam(teamName: string): boolean {
  return resolveOwner(teamName).ownerId === 'owner-vandals';
}
