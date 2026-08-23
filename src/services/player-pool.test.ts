import { describe, expect, it } from 'vitest';

import {
  buildMatchKey,
  buildPlayerPool,
  normalizePlayerName,
  normalizeTeam,
  searchPlayers,
  toDomainPosition,
} from './player-pool.js';

describe('normalizePlayerName', () => {
  it('strips punctuation and generational suffixes', () => {
    expect(normalizePlayerName('Brian Thomas Jr.')).toBe('brian thomas');
    expect(normalizePlayerName("Ja'Marr Chase")).toBe('jamarr chase');
    expect(normalizePlayerName('Marvin Harrison Jr')).toBe('marvin harrison');
    expect(normalizePlayerName('Amon-Ra St. Brown')).toBe('amonra st brown');
  });
});

describe('normalizeTeam', () => {
  it('collapses known abbreviation variants', () => {
    expect(normalizeTeam('JAC')).toBe('JAX');
    expect(normalizeTeam('WSH')).toBe('WAS');
    expect(normalizeTeam('oak')).toBe('LV');
    expect(normalizeTeam(null)).toBe('FA');
  });
});

describe('toDomainPosition', () => {
  it('maps feed-specific labels onto domain positions', () => {
    expect(toDomainPosition('DEF')).toBe('DST');
    expect(toDomainPosition('DST')).toBe('DST');
    expect(toDomainPosition('PK')).toBe('K');
    expect(toDomainPosition('WR')).toBe('WR');
    expect(toDomainPosition('LB')).toBeUndefined();
  });
});

describe('buildMatchKey', () => {
  it('keys defenses by team so name differences do not matter', () => {
    expect(buildMatchKey('DST', 'Seattle Defense', 'SEA')).toBe('DST:SEA');
    expect(buildMatchKey('DST', 'Seahawks DST', 'SEA')).toBe('DST:SEA');
  });
});

describe('buildPlayerPool', () => {
  const adpEntries = [
    { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 1.6, bye: 6, stdev: 0.7 },
    { name: 'Brian Thomas Jr.', position: 'WR', team: 'JAC', adp: 14.2 },
    { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 82.9 },
    { name: 'Brandon Aubrey', position: 'PK', team: 'DAL', adp: 130.3 },
    { name: 'Some Linebacker', position: 'LB', team: 'CHI', adp: 200 },
  ];

  it('merges ADP with Sleeper metadata and drops undraftable positions', () => {
    const pool = buildPlayerPool({
      season: 2026,
      adpEntries,
      sleeperPlayers: {
        '1': { player_id: '1', full_name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', injury_status: 'Questionable' },
        '2': { player_id: '2', first_name: 'Brian', last_name: 'Thomas', position: 'WR', team: 'JAX' },
      },
    });

    // The pool also carries all 32 synthesized team defenses.
    const ranked = pool.players.filter((player) => player.position !== 'DST');
    expect(ranked).toHaveLength(3);
    expect(ranked[0].fullName).toBe('Jahmyr Gibbs');
    expect(pool.players[0].injuryStatus).toBe('Questionable');
    expect(pool.byMatchKey.get('WR:brian thomas')?.team).toBe('JAX');
    expect(pool.byMatchKey.get('DST:SEA')?.position).toBe('DST');
    expect(pool.byMatchKey.get('K:brandon aubrey')?.position).toBe('K');
  });

  it('reports ADP names Sleeper could not confirm instead of dropping them', () => {
    const pool = buildPlayerPool({ season: 2026, adpEntries, sleeperPlayers: {} });
    expect(pool.players.filter((player) => player.position !== 'DST')).toHaveLength(3);
    expect(pool.unresolvedSleeperMatches).toContain('Brandon Aubrey (K, DAL)');
  });

  it('sorts by ADP so the board reads top-down', () => {
    const pool = buildPlayerPool({ season: 2026, adpEntries });
    const rankedAdps = pool.players
      .filter((player) => player.matchKey !== 'DST:SEA' && player.position !== 'DST')
      .map((player) => player.adp);
    expect(rankedAdps).toEqual([1.6, 14.2, 130.3]);
    // Synthesized defenses sort to the very bottom.
    expect(pool.players[pool.players.length - 1].position).toBe('DST');
  });
});

describe('searchPlayers', () => {
  const pool = buildPlayerPool({
    season: 2026,
    adpEntries: [
      { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 1.6 },
      { name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 1.9 },
      { name: 'Brian Robinson Jr.', position: 'RB', team: 'WAS', adp: 96.4 },
      { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 82.9 },
    ],
  });

  it('ranks full-name prefixes above surname matches', () => {
    const results = searchPlayers(pool, 'bijan');
    expect(results[0].fullName).toBe('Bijan Robinson');
  });

  it('breaks surname ties on ADP', () => {
    const results = searchPlayers(pool, 'robinson');
    expect(results.map((player) => player.fullName)).toEqual(['Bijan Robinson', 'Brian Robinson Jr.']);
  });

  it('finds defenses by team abbreviation', () => {
    expect(searchPlayers(pool, 'sea')[0].position).toBe('DST');
  });

  it('returns nothing for an empty query', () => {
    expect(searchPlayers(pool, '  ')).toEqual([]);
  });
});

describe('team defenses (regression)', () => {
  const pool = buildPlayerPool({
    season: 2026,
    adpEntries: [
      { name: 'Philadelphia Defense', position: 'DEF', team: 'PHI', adp: 120 },
      { name: 'Chase Brown', position: 'RB', team: 'CIN', adp: 13.5 },
      { name: 'A.J. Brown', position: 'WR', team: 'PHI', adp: 40 },
    ],
  });

  it('carries every NFL defense, not just the ones the ADP feed ranks', () => {
    // Seven defenses were missing from the 2026 feed; a round-13 pick for one of
    // them used to fail outright.
    const defenses = pool.players.filter((player) => player.position === 'DST');
    expect(defenses).toHaveLength(32);
    expect(defenses.some((defense) => defense.team === 'TB')).toBe(true);
  });

  it('resolves the nickname the draft room actually shows', () => {
    // CBS displays "Eagles DST | PHI" while the ADP feed says "Philadelphia Defense".
    expect(searchPlayers(pool, 'Eagles')[0].matchKey).toBe('DST:PHI');
    expect(searchPlayers(pool, 'Bucs')[0].matchKey).toBe('DST:TB');
    expect(searchPlayers(pool, 'Niners')[0].matchKey).toBe('DST:SF');
    expect(searchPlayers(pool, 'Philadelphia')[0].matchKey).toBe('DST:PHI');
    expect(searchPlayers(pool, 'PHI')[0].matchKey).toBe('DST:PHI');
  });

  it('does not let a nickname outrank a real surname', () => {
    // "brown" must find the player; only "browns" should find the defense.
    expect(searchPlayers(pool, 'brown')[0].fullName).toBe('Chase Brown');
    expect(searchPlayers(pool, 'browns')[0].matchKey).toBe('DST:CLE');
  });

  it('gives synthesized defenses a deeper ADP than every ranked player', () => {
    const synthesized = pool.players.find((player) => player.matchKey === 'DST:TB');
    expect(synthesized!.adp).toBeGreaterThan(120);
  });
});
