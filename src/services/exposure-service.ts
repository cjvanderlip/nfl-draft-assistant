import { assertArray, assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface ExposureEntry {
  userId: string;
  playerId: string;
  leagueId: string;
  season: number;
  rosterSlot: string;
}

export interface PlayerExposure {
  playerId: string;
  shareCount: number;
  leagues: string[];
  diversificationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Aggregate player exposure across configured leagues.
 *
 * @param entries - Player roster shares across leagues and seasons.
 * @param alertThreshold - Share count at which concentration becomes high risk.
 * @returns Exposure summaries sorted from highest to lowest share count.
 */
export function calculatePlayerExposure(
  entries: ExposureEntry[],
  alertThreshold = 5,
): PlayerExposure[] {
  assertArray(entries, 'entries');
  assertNumberInRange(alertThreshold, 'alertThreshold', 1, 1000);

  const exposureByPlayer = new Map<string, { count: number; leagues: Set<string> }>();
  for (const entry of entries) {
    assertObject(entry, 'entry');
    assertNonEmptyString(entry.userId, 'entry.userId');
    assertNonEmptyString(entry.playerId, 'entry.playerId');
    assertNonEmptyString(entry.leagueId, 'entry.leagueId');
    assertNumberInRange(entry.season, 'entry.season', 2000, 2100);
    assertNonEmptyString(entry.rosterSlot, 'entry.rosterSlot');

    const current = exposureByPlayer.get(entry.playerId) ?? { count: 0, leagues: new Set<string>() };
    current.count += 1;
    current.leagues.add(entry.leagueId);
    exposureByPlayer.set(entry.playerId, current);
  }

  return [...exposureByPlayer.entries()]
    .map(([playerId, exposure]) => {
      let diversificationRisk: PlayerExposure['diversificationRisk'] = 'LOW';
      if (exposure.count >= alertThreshold) {
        diversificationRisk = 'HIGH';
      } else if (exposure.count >= Math.max(2, Math.ceil(alertThreshold / 2))) {
        diversificationRisk = 'MEDIUM';
      }

      return {
        playerId,
        shareCount: exposure.count,
        leagues: [...exposure.leagues].sort(),
        diversificationRisk,
      };
    })
    .sort((left, right) => right.shareCount - left.shareCount || left.playerId.localeCompare(right.playerId));
}
