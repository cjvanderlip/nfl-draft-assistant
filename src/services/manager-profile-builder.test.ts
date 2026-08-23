import { describe, expect, it } from 'vitest';

import { buildManagerProfiles, type ProfilePick } from './manager-profile-builder.js';
import { buildMatchKey } from './player-pool.js';

function pick(overrides: Partial<ProfilePick> & { teamName: string; overallPick: number }): ProfilePick {
  return {
    leagueId: 'A-LEAGUE',
    season: 2025,
    round: Math.ceil(overrides.overallPick / 12),
    playerName: `Player ${overrides.overallPick}`,
    playerTeam: 'DET',
    position: 'RB',
    ...overrides,
  };
}

function adpFor(entries: Array<{ name: string; position: 'QB' | 'RB' | 'WR' | 'TE'; adp: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(buildMatchKey(entry.position, entry.name, 'DET'), entry.adp);
  }
  return map;
}

describe('buildManagerProfiles', () => {
  it('measures reach as the gap between market ADP and the actual pick', () => {
    const picks = [
      pick({ teamName: 'Early Bird', overallPick: 10, position: 'QB', playerName: 'Reached Passer' }),
      pick({ teamName: 'Patient Sam', overallPick: 20, position: 'QB', playerName: 'Waited Passer' }),
    ];
    const profiles = buildManagerProfiles({
      picks,
      adpBySeason: {
        2025: adpFor([
          { name: 'Reached Passer', position: 'QB', adp: 40 },
          { name: 'Waited Passer', position: 'QB', adp: 12 },
        ]),
      },
    });

    const early = profiles.managers.find((manager) => manager.displayName === 'Early Bird');
    const patient = profiles.managers.find((manager) => manager.displayName === 'Patient Sam');
    // On a single pick each, both shrink hard toward the league mean, so the
    // guarantee worth asserting is the ordering rather than the sign.
    expect(early?.overallReach).toBeGreaterThan(patient?.overallReach ?? 0);
  });

  it('shrinks a thin sample toward the league mean more than a thick one', () => {
    // Normalization strips digits, so fixture names have to differ by letters.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const vetName = (index: number) => `Vet ${alphabet[index % 26]}${alphabet[Math.floor(index / 26)]}`;

    const thick: ProfilePick[] = [];
    for (let index = 0; index < 40; index += 1) {
      thick.push(pick({ teamName: 'Veteran', overallPick: index + 1, playerName: vetName(index) }));
    }
    const thin = [pick({ teamName: 'Rookie', overallPick: 100, playerName: 'Solo Rookie' })];

    const adp = new Map<string, number>();
    for (let index = 0; index < 40; index += 1) {
      adp.set(buildMatchKey('RB', vetName(index), 'DET'), index + 21);
    }
    adp.set(buildMatchKey('RB', 'Solo Rookie', 'DET'), 120);

    const profiles = buildManagerProfiles({ picks: [...thick, ...thin], adpBySeason: { 2025: adp } });
    const veteran = profiles.managers.find((manager) => manager.displayName === 'Veteran');
    const rookie = profiles.managers.find((manager) => manager.displayName === 'Rookie');

    expect(veteran?.confidence).toBeGreaterThan(rookie?.confidence ?? 1);
    // One pick leaves the rookie sitting essentially on the league mean.
    const leagueMean = profiles.leagues['A-LEAGUE'].meanReach;
    expect(Math.abs((rookie?.overallReach ?? 0) - leagueMean)).toBeLessThan(1);
  });

  it('keeps a strong positional habit visible instead of flattening it', () => {
    const picks: ProfilePick[] = [];
    const adp = new Map<string, number>();
    for (let season = 2022; season <= 2025; season += 1) {
      const tag = 'abcd'[season - 2022];
      picks.push(pick({ teamName: 'TE Reacher', season, overallPick: 20, position: 'TE', playerName: `Tight ${tag}` }));
      adp.set(buildMatchKey('TE', `Tight ${tag}`, 'DET'), 45);
      for (let index = 0; index < 8; index += 1) {
        const name = `Filler ${tag}${'abcdefgh'[index]}`;
        picks.push(pick({ teamName: 'TE Reacher', season, overallPick: 30 + index * 12, playerName: name }));
        adp.set(buildMatchKey('RB', name, 'DET'), 30 + index * 12);
      }
    }

    const profiles = buildManagerProfiles({
      picks,
      adpBySeason: { 2022: adp, 2023: adp, 2024: adp, 2025: adp },
    });
    const reacher = profiles.managers.find((manager) => manager.displayName === 'TE Reacher');
    expect(reacher?.reachByPosition.TE?.mean).toBeGreaterThan(10);
    expect(reacher?.tells.some((tell) => tell.position === 'TE' && tell.value > 10)).toBe(true);
  });

  it('separates the same owner into one profile per league', () => {
    const profiles = buildManagerProfiles({
      picks: [
        pick({ teamName: 'Northern Virginia Vandals', overallPick: 6, leagueId: 'A-LEAGUE' }),
        pick({ teamName: 'Deer Valley Vandals', overallPick: 6, leagueId: 'B-LEAGUE' }),
      ],
      adpBySeason: {},
    });

    const vandals = profiles.managers.filter((manager) => manager.ownerId === 'owner-vandals');
    expect(vandals).toHaveLength(2);
    expect(vandals.map((manager) => manager.leagueId).sort()).toEqual(['A-LEAGUE', 'B-LEAGUE']);
    expect(vandals.every((manager) => manager.crossLeague)).toBe(true);
  });

  it('records the average round of a first positional pick per season', () => {
    const profiles = buildManagerProfiles({
      picks: [
        pick({ teamName: 'Sam', season: 2024, overallPick: 30, position: 'QB' }),
        pick({ teamName: 'Sam', season: 2024, overallPick: 54, position: 'QB' }),
        pick({ teamName: 'Sam', season: 2025, overallPick: 54, position: 'QB' }),
      ],
      adpBySeason: {},
    });

    // 2024 first QB in round 3, 2025 first QB in round 5, averaging 4.
    expect(profiles.managers[0].firstPositionRound.QB).toBe(4);
  });

  it('reports league shape alongside the managers', () => {
    const profiles = buildManagerProfiles({
      picks: [
        pick({ teamName: 'Sam', overallPick: 1 }),
        pick({ teamName: 'Kim', overallPick: 2, position: 'WR' }),
      ],
      adpBySeason: {},
    });

    expect(profiles.leagues['A-LEAGUE'].pickCount).toBe(2);
    expect(profiles.leagues['A-LEAGUE'].positionShare.RB).toBe(0.5);
  });
});
