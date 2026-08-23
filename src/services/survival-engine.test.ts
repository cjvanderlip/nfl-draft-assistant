import { describe, expect, it } from 'vitest';

import { buildPlayerPool } from './player-pool.js';
import { createDraftBoard, recordPick, type DraftBoard } from './draft-board.js';
import { calibrateSurvival, createSeededRandom, simulateSurvival } from './survival-engine.js';
import type { ManagerProfile } from './manager-profile-builder.js';

function profile(overrides: Partial<ManagerProfile> & { ownerId: string }): ManagerProfile {
  return {
    displayName: overrides.ownerId,
    leagueId: 'TEST',
    teamNames: [],
    seasons: [2022, 2023, 2024, 2025],
    crossLeague: false,
    pickCount: 52,
    adpMatchedCount: 50,
    confidence: 0.8,
    overallReach: 0,
    reachByPosition: {},
    positionShare: {},
    positionByRound: {},
    firstPositionRound: {},
    earlyRoundShape: {},
    tells: [],
    ...overrides,
  };
}

function makeBoard(profiles: ManagerProfile[], draftSlot = 1): DraftBoard {
  // Names must stay unique after normalization, which strips digits.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const adpEntries = [];
  for (let index = 1; index <= 30; index += 1) {
    const letters = alphabet[(index - 1) % 26] + alphabet[Math.floor((index - 1) / 26)];
    adpEntries.push({
      name: `Player ${letters}`,
      position: index % 3 === 0 ? 'QB' : 'RB',
      team: 'DET',
      adp: index,
    });
  }

  return createDraftBoard({
    leagueId: 'TEST',
    season: 2026,
    teamCount: 4,
    rounds: 4,
    draftSlot,
    draftOrder: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
    pool: buildPlayerPool({ season: 2026, adpEntries }),
    profiles,
  });
}

describe('calibrateSurvival', () => {
  it('is monotonic across the range', () => {
    let previous = -1;
    for (let raw = 0; raw <= 1.0001; raw += 0.05) {
      const value = calibrateSurvival(raw);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('lifts the over-eager bottom of the raw scale', () => {
    expect(calibrateSurvival(0)).toBeGreaterThan(0.25);
    expect(calibrateSurvival(0.07)).toBeCloseTo(0.37, 2);
    expect(calibrateSurvival(1)).toBeCloseTo(0.98, 2);
  });

  it('clamps out-of-range input', () => {
    expect(calibrateSurvival(-5)).toBe(calibrateSurvival(0));
    expect(calibrateSurvival(5)).toBe(calibrateSurvival(1));
  });
});

describe('simulateSurvival', () => {
  it('is deterministic for a fixed seed', () => {
    const first = simulateSurvival({ board: makeBoard([], 4), samples: 200, random: createSeededRandom(7) });
    const second = simulateSurvival({ board: makeBoard([], 4), samples: 200, random: createSeededRandom(7) });
    expect(first.players.map((player) => player.survivalProbability))
      .toEqual(second.players.map((player) => player.survivalProbability));
  });

  it('gives later-ADP players a better chance of surviving', () => {
    const result = simulateSurvival({ board: makeBoard([], 4), samples: 400, random: createSeededRandom(11) });
    const early = result.players.find((player) => player.fullName === 'Player aa');
    const late = result.players.find((player) => player.fullName === 'Player db');
    expect(late!.survivalProbability).toBeGreaterThan(early!.survivalProbability);
  });

  it('looks through to the next turn when you are on the clock', () => {
    // Slot 1 of a 4-team snake picks at 1 and 8, so six picks sit in between.
    const result = simulateSurvival({ board: makeBoard([], 1), samples: 200, random: createSeededRandom(3) });
    expect(result.assumesCurrentPickSpent).toBe(true);
    expect(result.targetPick).toBe(8);
    expect(result.picksSimulated).toBe(6);
    expect(result.players.some((player) => player.survivalProbability < 0.9)).toBe(true);
    expect(result.note).toMatch(/spend this pick on someone else/);
  });

  it('reports everything as safe on the final turn of the draft', () => {
    const board = makeBoard([], 1);
    // Slot 1 of a 4-team, 4-round snake picks at 1, 8, 9 and 16; fill up to 16
    // so it is on the clock with no further turn behind it.
    const lastSlotPick = 16;
    while (board.picks.length < lastSlotPick - 1) {
      recordPick(board, [...board.available.values()][0]);
    }
    const result = simulateSurvival({ board, samples: 50, random: createSeededRandom(3) });
    expect(result.picksSimulated).toBe(0);
    expect(result.players.every((player) => player.survivalProbability === 1)).toBe(true);
  });

  it('lets a manager who reaches for a position pull that position off the board', () => {
    const neutral = makeBoard([], 4);
    const reacher = makeBoard([
      profile({
        ownerId: 'owner-bravo',
        overallReach: 0,
        reachByPosition: { QB: { mean: 40, sampleSize: 8 } },
        positionByRound: { 1: { QB: 0.9, RB: 0.1 } },
      }),
    ], 4);

    const withoutReach = simulateSurvival({ board: neutral, samples: 600, random: createSeededRandom(4) });
    const withReach = simulateSurvival({ board: reacher, samples: 600, random: createSeededRandom(4) });

    // The reach shifts every quarterback equally, so what it changes is which
    // position Bravo takes, which in turn drains the quarterbacks off the board.
    const oddsBefore = withoutReach.threats.find((threat) => threat.teamName === 'Bravo')!.positionOdds.QB ?? 0;
    const oddsAfter = withReach.threats.find((threat) => threat.teamName === 'Bravo')!.positionOdds.QB ?? 0;
    expect(oddsBefore).toBeLessThan(0.5);
    expect(oddsAfter).toBeGreaterThan(0.9);

    const qbKey = 'QB:player ca';
    const before = withoutReach.players.find((player) => player.matchKey === qbKey)!;
    const after = withReach.players.find((player) => player.matchKey === qbKey)!;
    expect(after.rawSurvivalProbability).toBeLessThan(before.rawSurvivalProbability);
  });

  it('names the manager most likely to take a player', () => {
    const board = makeBoard([
      profile({
        ownerId: 'owner-bravo',
        reachByPosition: { QB: { mean: 60, sampleSize: 8 } },
        positionByRound: { 1: { QB: 0.95 } },
      }),
    ], 4);
    const result = simulateSurvival({ board, samples: 300, random: createSeededRandom(5) });
    const qb = result.players.find((player) => player.matchKey === 'QB:player ca');
    expect(qb?.topThreat?.teamName).toBe('Bravo');
  });

  it('respects roster limits so nobody drafts three kickers', () => {
    const board = createDraftBoard({
      leagueId: 'TEST',
      season: 2026,
      teamCount: 2,
      rounds: 3,
      draftSlot: 1,
      draftOrder: ['Alpha', 'Bravo'],
      pool: buildPlayerPool({
        season: 2026,
        adpEntries: [
          { name: 'Kicker One', position: 'PK', team: 'DAL', adp: 1 },
          { name: 'Kicker Two', position: 'PK', team: 'SEA', adp: 2 },
          { name: 'Kicker Three', position: 'PK', team: 'KC', adp: 3 },
          { name: 'Runner One', position: 'RB', team: 'DET', adp: 4 },
          { name: 'Runner Two', position: 'RB', team: 'ATL', adp: 5 },
          { name: 'Runner Three', position: 'RB', team: 'NYG', adp: 6 },
        ],
      }),
      profiles: [],
    });

    // Alpha takes its one kicker at pick 1; its next turn is pick 4, and both
    // intervening picks (2 and 3) belong to Bravo in a two-team snake.
    recordPick(board, board.pool.byMatchKey.get('K:kicker one')!);
    const result = simulateSurvival({ board, samples: 300, slot: 1, random: createSeededRandom(9) });
    expect(result.picksSimulated).toBe(2);

    const two = result.players.find((player) => player.matchKey === 'K:kicker two')!;
    const three = result.players.find((player) => player.matchKey === 'K:kicker three')!;
    // Bravo is capped at one kicker and Alpha already has his, so at most one of
    // the two remaining kickers can come off the board.
    expect(two.rawSurvivalProbability + three.rawSurvivalProbability).toBeGreaterThanOrEqual(1);
  });

  it('describes each upcoming manager with sample size and tells', () => {
    const board = makeBoard([
      profile({
        ownerId: 'owner-bravo',
        seasons: [2024, 2025],
        confidence: 0.6,
        tells: [{ label: 'Takes QB early', position: 'QB', value: 22, sampleSize: 8 }],
        positionByRound: { 1: { QB: 0.8, RB: 0.2 } },
      }),
    ], 4);

    const result = simulateSurvival({ board, samples: 100, random: createSeededRandom(2) });
    const bravo = result.threats.find((threat) => threat.teamName === 'Bravo');
    expect(bravo?.seasons).toBe(2);
    expect(bravo?.tells).toContain('Takes QB early');
    expect(Object.keys(bravo?.positionOdds ?? {}).length).toBeGreaterThan(0);
  });
});

describe('simulateSurvival simulation depth', () => {
  it('reports only the requested candidate depth', () => {
    const result = simulateSurvival({
      board: makeBoard([profile({ ownerId: 'owner-alpha' })]),
      samples: 40,
      candidateDepth: 10,
      random: createSeededRandom(7),
    });

    expect(result.players).toHaveLength(10);
  });

  it('lets a reaching manager draft past the reported board', () => {
    // This manager takes quarterbacks 40 picks ahead of ADP, which in a
    // 30-player pool means the deepest quarterbacks outrank everyone. With the
    // simulation confined to the reported ten, he could never reach them.
    const profiles = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((team) => profile({
      ownerId: `owner-${team.toLowerCase()}`,
      reachByPosition: { QB: { mean: 40, sampleSize: 12 } },
      positionByRound: { 1: { QB: 0.95, RB: 0.05 }, 2: { QB: 0.95, RB: 0.05 } },
    }));

    const shallow = simulateSurvival({
      board: makeBoard(profiles, 4),
      samples: 200,
      candidateDepth: 10,
      simulationDepth: 10,
      random: createSeededRandom(11),
    });
    const deep = simulateSurvival({
      board: makeBoard(profiles, 4),
      samples: 200,
      candidateDepth: 10,
      simulationDepth: 30,
      random: createSeededRandom(11),
    });

    const meanSurvival = (players: Array<{ rawSurvivalProbability: number }>): number =>
      players.reduce((sum, player) => sum + player.rawSurvivalProbability, 0) / players.length;

    // Given somewhere else to reach, the reaching managers stop consuming the
    // top of the board, so the reported players survive more often.
    expect(meanSurvival(deep.players)).toBeGreaterThan(meanSurvival(shallow.players));
  });

  it('never simulates a shallower pool than it reports', () => {
    const result = simulateSurvival({
      board: makeBoard([profile({ ownerId: 'owner-alpha' })]),
      samples: 20,
      candidateDepth: 20,
      simulationDepth: 5,
      random: createSeededRandom(3),
    });

    expect(result.players).toHaveLength(20);
  });
});
