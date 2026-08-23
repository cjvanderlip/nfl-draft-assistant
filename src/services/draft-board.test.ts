import { describe, expect, it } from 'vitest';

import { buildPlayerPool } from './player-pool.js';
import {
  createDraftBoard,
  locatePick,
  pickNumbersForSlot,
  recordOffPoolPick,
  recordPick,
  resolveAvailablePlayer,
  rosterFor,
  teamOnTheClock,
  undoLastPick,
  upcomingTurns,
  type DraftBoard,
} from './draft-board.js';

const TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

function makeBoard(overrides: { draftSlot?: number; rounds?: number } = {}): DraftBoard {
  const pool = buildPlayerPool({
    season: 2026,
    adpEntries: [
      { name: 'Ace Runner', position: 'RB', team: 'DET', adp: 1 },
      { name: 'Bo Catcher', position: 'WR', team: 'ATL', adp: 2 },
      { name: 'Cy Thrower', position: 'QB', team: 'BUF', adp: 3 },
      { name: 'Dex Endzone', position: 'TE', team: 'KC', adp: 4 },
      { name: 'Eli Runner', position: 'RB', team: 'NYG', adp: 5 },
      { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 6 },
    ],
  });

  return createDraftBoard({
    leagueId: 'TEST',
    season: 2026,
    teamCount: 4,
    rounds: overrides.rounds ?? 3,
    draftSlot: overrides.draftSlot ?? 2,
    draftOrder: TEAMS,
    pool,
    profiles: [],
  });
}

describe('locatePick', () => {
  it('reverses the order on even rounds', () => {
    expect(locatePick(1, 4)).toEqual({ round: 1, slot: 1 });
    expect(locatePick(4, 4)).toEqual({ round: 1, slot: 4 });
    expect(locatePick(5, 4)).toEqual({ round: 2, slot: 4 });
    expect(locatePick(8, 4)).toEqual({ round: 2, slot: 1 });
    expect(locatePick(9, 4)).toEqual({ round: 3, slot: 1 });
  });
});

describe('pickNumbersForSlot', () => {
  it('walks the snake for one seat', () => {
    expect(pickNumbersForSlot(1, 4, 3)).toEqual([1, 8, 9]);
    expect(pickNumbersForSlot(4, 4, 3)).toEqual([4, 5, 12]);
    expect(pickNumbersForSlot(2, 4, 3)).toEqual([2, 7, 10]);
  });
});

describe('recordPick', () => {
  it('assigns each pick to the team the snake puts on the clock', () => {
    const board = makeBoard();
    const first = recordPick(board, board.pool.byMatchKey.get('RB:ace runner')!);
    const second = recordPick(board, board.pool.byMatchKey.get('WR:bo catcher')!);

    expect(first).toMatchObject({ overallPick: 1, round: 1, slot: 1, teamName: 'Alpha' });
    expect(second).toMatchObject({ overallPick: 2, round: 1, slot: 2, teamName: 'Bravo' });
  });

  it('records reach against ADP', () => {
    const board = makeBoard();
    recordPick(board, board.pool.byMatchKey.get('WR:bo catcher')!);
    expect(board.picks[0].reachDelta).toBe(1);
  });

  it('refuses a player who is already gone', () => {
    const board = makeBoard();
    const player = board.pool.byMatchKey.get('RB:ace runner')!;
    recordPick(board, player);
    expect(() => recordPick(board, player)).toThrow(/already been drafted/);
  });

  it('refuses picks once the draft is full', () => {
    const board = makeBoard({ rounds: 1 });
    for (const player of [...board.available.values()].slice(0, 4)) {
      recordPick(board, player);
    }
    expect(() => recordPick(board, [...board.available.values()][0])).toThrow(/already complete/);
  });
});

describe('undoLastPick', () => {
  it('returns the player to the pool', () => {
    const board = makeBoard();
    const player = board.pool.byMatchKey.get('RB:ace runner')!;
    recordPick(board, player);
    expect(board.available.has(player.matchKey)).toBe(false);

    const undone = undoLastPick(board);
    expect(undone?.fullName).toBe('Ace Runner');
    expect(board.available.has(player.matchKey)).toBe(true);
    expect(board.picks).toHaveLength(0);
  });

  it('is safe on an empty board', () => {
    expect(undoLastPick(makeBoard())).toBeUndefined();
  });
});

describe('upcomingTurns', () => {
  it('counts the picks before your turn and the gap after it', () => {
    const board = makeBoard({ draftSlot: 4 });
    // Slot 4 in a 4-team, 3-round snake picks at 4, 5 and 12.
    expect(upcomingTurns(board, 4)).toMatchObject({
      nextPick: 4,
      followingPick: 5,
      picksUntilNext: 3,
      picksBetweenTurns: 0,
    });
  });

  it('reports the long wait at the turn', () => {
    const board = makeBoard({ draftSlot: 1 });
    expect(upcomingTurns(board, 1)).toMatchObject({
      nextPick: 1,
      followingPick: 8,
      picksUntilNext: 0,
      picksBetweenTurns: 6,
    });
  });
});

describe('teamOnTheClock and rosterFor', () => {
  it('tracks each owner separately', () => {
    const board = makeBoard();
    recordPick(board, board.pool.byMatchKey.get('RB:ace runner')!);
    recordPick(board, board.pool.byMatchKey.get('WR:bo catcher')!);

    expect(teamOnTheClock(board, 3).teamName).toBe('Charlie');
    expect(rosterFor(board, 'owner-alpha')).toEqual({ RB: 1 });
    expect(rosterFor(board, 'owner-bravo')).toEqual({ WR: 1 });
  });
});

describe('resolveAvailablePlayer', () => {
  it('resolves a unique partial name', () => {
    const board = makeBoard();
    expect(resolveAvailablePlayer(board, 'catcher').player?.fullName).toBe('Bo Catcher');
  });

  it('returns candidates when the query is ambiguous', () => {
    const board = makeBoard();
    const result = resolveAvailablePlayer(board, 'runner');
    expect(result.player).toBeUndefined();
    expect(result.candidates.map((candidate) => candidate.fullName)).toEqual(['Ace Runner', 'Eli Runner']);
  });

  it('does not offer players who are already drafted', () => {
    const board = makeBoard();
    recordPick(board, board.pool.byMatchKey.get('RB:ace runner')!);
    expect(resolveAvailablePlayer(board, 'runner').player?.fullName).toBe('Eli Runner');
  });
});

describe('recordOffPoolPick (regression)', () => {
  it('keeps the board in sync when a name is not in the ADP pool', () => {
    // A deep-bench flier used to throw, which would stall the draft and push
    // every later pick onto the wrong team.
    const board = makeBoard();
    recordPick(board, board.pool.byMatchKey.get('RB:ace runner')!);
    const placeholder = recordOffPoolPick(board, 'Some Deep Sleeper', 'WR');

    expect(placeholder.overallPick).toBe(2);
    expect(placeholder.teamName).toBe('Bravo');
    expect(placeholder.offPool).toBe(true);
    expect(board.picks).toHaveLength(2);

    // The next real pick still lands on the correct team.
    const third = recordPick(board, board.pool.byMatchKey.get('WR:bo catcher')!);
    expect(third.teamName).toBe('Charlie');
  });

  it('counts toward the drafting team roster', () => {
    const board = makeBoard();
    recordOffPoolPick(board, 'Mystery Man', 'TE');
    expect(rosterFor(board, 'owner-alpha')).toEqual({ TE: 1 });
  });

  it('does not consume anyone from the available pool', () => {
    const board = makeBoard();
    const before = board.available.size;
    recordOffPoolPick(board, 'Mystery Man', 'WR');
    expect(board.available.size).toBe(before);
  });

  it('can be undone like any other pick', () => {
    const board = makeBoard();
    recordOffPoolPick(board, 'Mystery Man', 'WR');
    const undone = undoLastPick(board);
    expect(undone?.offPool).toBe(true);
    expect(board.picks).toHaveLength(0);
  });

  it('refuses to overfill a completed draft', () => {
    const board = makeBoard({ rounds: 1 });
    for (let index = 0; index < 4; index += 1) {
      recordOffPoolPick(board, `Filler ${'abcd'[index]}`, 'RB');
    }
    expect(() => recordOffPoolPick(board, 'One Too Many', 'RB')).toThrow(/already complete/);
  });
});
