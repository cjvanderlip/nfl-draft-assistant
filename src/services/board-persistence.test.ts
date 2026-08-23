import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearBoardSnapshot,
  loadBoardSnapshot,
  saveBoardSnapshot,
  toSnapshot,
} from './board-persistence.js';
import { createDraftBoard, recordOffPoolPick, recordPick, type DraftBoard } from './draft-board.js';
import { buildPlayerPool } from './player-pool.js';
import type { ManagerProfile } from './manager-profile-builder.js';

let directory: string;

function buildBoard(): DraftBoard {
  const pool = buildPlayerPool({
    season: 2026,
    adpEntries: [
      { name: 'Alpha Back', position: 'RB', team: 'DAL', adp: 1 },
      { name: 'Bravo Wide', position: 'WR', team: 'PHI', adp: 2 },
    ],
  });
  return createDraftBoard({
    leagueId: 'A-LEAGUE',
    season: 2026,
    teamCount: 2,
    rounds: 3,
    draftSlot: 1,
    draftOrder: ['One', 'Two'],
    pool,
    profiles: [] as ManagerProfile[],
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wingman-snapshot-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('toSnapshot', () => {
  it('keeps only the match key for pooled picks', () => {
    const board = buildBoard();
    recordPick(board, board.pool.byMatchKey.get('RB:alpha back')!);

    expect(toSnapshot(board).picks).toEqual([{ matchKey: 'RB:alpha back' }]);
  });

  it('keeps the label and position for off-pool placeholders', () => {
    const board = buildBoard();
    recordOffPoolPick(board, 'Some Deep Flier', 'TE');

    expect(toSnapshot(board).picks).toEqual([
      { matchKey: 'OFFPOOL:1', offPool: true, label: 'Some Deep Flier', position: 'TE' },
    ]);
  });

  it('records the draft shape needed to rebuild the board', () => {
    const snapshot = toSnapshot(buildBoard(), () => new Date('2026-08-29T18:00:00.000Z'));

    expect(snapshot).toMatchObject({
      version: 1,
      savedAt: '2026-08-29T18:00:00.000Z',
      leagueId: 'A-LEAGUE',
      season: 2026,
      teamCount: 2,
      rounds: 3,
      draftSlot: 1,
      draftOrder: ['One', 'Two'],
    });
  });
});

describe('saveBoardSnapshot', () => {
  it('round-trips through disk', async () => {
    const board = buildBoard();
    recordPick(board, board.pool.byMatchKey.get('RB:alpha back')!);
    await saveBoardSnapshot(board, directory);

    const loaded = await loadBoardSnapshot(directory);
    expect(loaded?.picks).toEqual([{ matchKey: 'RB:alpha back' }]);
    expect(loaded?.leagueId).toBe('A-LEAGUE');
  });

  it('leaves no temporary file behind', async () => {
    await saveBoardSnapshot(buildBoard(), directory);
    await expect(readFile(join(directory, 'live-board.json.tmp'), 'utf8')).rejects.toThrow();
  });

  it('overwrites the previous snapshot rather than appending', async () => {
    const board = buildBoard();
    await saveBoardSnapshot(board, directory);
    recordPick(board, board.pool.byMatchKey.get('RB:alpha back')!);
    await saveBoardSnapshot(board, directory);

    expect((await loadBoardSnapshot(directory))?.picks).toHaveLength(1);
  });
});

describe('loadBoardSnapshot', () => {
  it('returns undefined when there is no snapshot', async () => {
    expect(await loadBoardSnapshot(directory)).toBeUndefined();
  });

  it('rejects a snapshot written by a future version', async () => {
    await writeFile(join(directory, 'live-board.json'), JSON.stringify({ version: 2, picks: [] }), 'utf8');
    expect(await loadBoardSnapshot(directory)).toBeUndefined();
  });

  it('rejects unparseable contents rather than throwing', async () => {
    await writeFile(join(directory, 'live-board.json'), 'not json', 'utf8');
    expect(await loadBoardSnapshot(directory)).toBeUndefined();
  });
});

describe('clearBoardSnapshot', () => {
  it('removes the snapshot', async () => {
    await saveBoardSnapshot(buildBoard(), directory);
    await clearBoardSnapshot(directory);
    expect(await loadBoardSnapshot(directory)).toBeUndefined();
  });

  it('is a no-op when there is nothing to clear', async () => {
    await expect(clearBoardSnapshot(directory)).resolves.toBeUndefined();
  });
});
