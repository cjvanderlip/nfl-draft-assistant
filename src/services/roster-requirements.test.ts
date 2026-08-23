import { describe, expect, it } from 'vitest';

import { createDraftBoard, recordPick, type DraftBoard } from './draft-board.js';
import { buildPlayerPool } from './player-pool.js';
import { evaluateRosterRequirements } from './roster-requirements.js';
import type { ManagerProfile } from './manager-profile-builder.js';

const TEAMS = ['One', 'Two', 'Three', 'Four'];

function buildBoard(rounds: number): DraftBoard {
  const pool = buildPlayerPool({
    season: 2026,
    adpEntries: [
      { name: 'Alpha Back', position: 'RB', team: 'DAL', adp: 1 },
      { name: 'Bravo Wide', position: 'WR', team: 'PHI', adp: 2 },
      { name: 'Charlie Arm', position: 'QB', team: 'KC', adp: 3 },
      { name: 'Delta Foot', position: 'PK', team: 'BAL', adp: 4 },
    ],
  });
  return createDraftBoard({
    leagueId: 'A-LEAGUE',
    season: 2026,
    teamCount: TEAMS.length,
    rounds,
    draftSlot: 1,
    draftOrder: TEAMS,
    pool,
    profiles: [] as ManagerProfile[],
  });
}

describe('evaluateRosterRequirements', () => {
  it('reports every lineup minimum as outstanding on an empty roster', () => {
    const status = evaluateRosterRequirements(buildBoard(13), {});
    expect(status.needed.map((requirement) => requirement.position).sort())
      .toEqual(['DST', 'K', 'QB', 'RB', 'TE', 'WR']);
    expect(status.turnsLeft).toBe(13);
    expect(status.forced).toBe(false);
    expect(status.message).toBeUndefined();
  });

  it('clears a slot once it is filled', () => {
    const status = evaluateRosterRequirements(buildBoard(13), { QB: 1, RB: 4, WR: 3, TE: 1 });
    expect(status.needed.map((requirement) => requirement.position).sort()).toEqual(['DST', 'K']);
  });

  it('says nothing when every lineup minimum is met', () => {
    const status = evaluateRosterRequirements(
      buildBoard(13),
      { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    );
    expect(status.needed).toEqual([]);
    expect(status.forced).toBe(false);
    expect(status.message).toBeUndefined();
  });

  it('warns once the free picks are nearly gone', () => {
    // Four turns left against three outstanding slots leaves one free pick.
    const status = evaluateRosterRequirements(buildBoard(4), { RB: 1, WR: 1, TE: 1 });
    expect(status.forced).toBe(false);
    expect(status.message).toMatch(/1 free pick remaining/);
  });

  it('flags the point where every remaining turn is spoken for', () => {
    const status = evaluateRosterRequirements(buildBoard(3), { RB: 1, WR: 1, TE: 1 });
    expect(status.turnsLeft).toBe(3);
    expect(status.forced).toBe(true);
    expect(status.message).toMatch(/Every remaining turn is spoken for/);
  });

  it('reports an unreachable legal roster when the turns have run out', () => {
    const status = evaluateRosterRequirements(buildBoard(2), { RB: 1, WR: 1, TE: 1 });
    expect(status.message).toMatch(/cannot finish a legal roster/);
  });

  it('treats the league lineup minimums as the requirement set', () => {
    // The league scores an illegal roster as zero, so every active minimum counts,
    // not just the ones that are hard to fill.
    expect(evaluateRosterRequirements(buildBoard(13), {}).needed.map((r) => r.required))
      .toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('counts turns from the picks already recorded', () => {
    const board = buildBoard(13);
    const first = board.pool.players.find((player) => player.position === 'RB');
    expect(first).toBeDefined();
    recordPick(board, first!);

    // Slot 1 picked at overall 1, so twelve of its turns remain.
    expect(evaluateRosterRequirements(board, { RB: 1 }).turnsLeft).toBe(12);
  });
});
