import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { assertObject, type Position } from '../../validators.js';
import type { DraftBoard } from './draft-board.js';

/**
 * One recorded pick, reduced to what is needed to replay it.
 *
 * Only the match key is stored for pooled players: the pool is rebuilt from the
 * cached ADP on restore, so persisting names and ADP would just risk the snapshot
 * disagreeing with the pool it is replayed against.
 */
export interface PersistedPick {
  matchKey: string;
  offPool?: boolean;
  label?: string;
  position?: Position;
}

export interface PersistedBoard {
  version: 1;
  savedAt: string;
  leagueId: string;
  season: number;
  teamCount: number;
  rounds: number;
  draftSlot: number;
  draftOrder: string[];
  picks: PersistedPick[];
}

const SNAPSHOT_FILE = 'live-board.json';

function snapshotPath(dataDirectory?: string): string {
  return join(dataDirectory ?? join(process.cwd(), 'data'), SNAPSHOT_FILE);
}

/**
 * Reduce a live board to the smallest snapshot that can rebuild it.
 *
 * @param board - Live draft board.
 * @param now - Clock, injectable for tests.
 * @returns Serializable snapshot.
 */
export function toSnapshot(board: DraftBoard, now: () => Date = () => new Date()): PersistedBoard {
  assertObject(board, 'board');
  return {
    version: 1,
    savedAt: now().toISOString(),
    leagueId: board.leagueId,
    season: board.season,
    teamCount: board.teamCount,
    rounds: board.rounds,
    draftSlot: board.draftSlot,
    draftOrder: [...board.draftOrder],
    picks: board.picks.map((pick) => (pick.offPool
      ? { matchKey: pick.matchKey, offPool: true, label: pick.fullName, position: pick.position }
      : { matchKey: pick.matchKey })),
  };
}

/**
 * Write the board snapshot to disk.
 *
 * Written to a temporary file and renamed, so a crash mid-write cannot leave a
 * half-written snapshot where a recoverable draft used to be. Failures are
 * swallowed: losing the ability to recover later is bad, but taking down the pick
 * that is being recorded right now is worse.
 *
 * @param board - Live draft board.
 * @param dataDirectory - Data directory override for tests.
 */
export async function saveBoardSnapshot(board: DraftBoard, dataDirectory?: string): Promise<void> {
  const file = snapshotPath(dataDirectory);
  try {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(toSnapshot(board), null, 2), 'utf8');
    await rename(temporary, file);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(`Could not save the draft board snapshot: ${message}`);
  }
}

/**
 * Read a previously saved board snapshot.
 *
 * @param dataDirectory - Data directory override for tests.
 * @returns The snapshot, or undefined when there is none or it is unreadable.
 */
export async function loadBoardSnapshot(dataDirectory?: string): Promise<PersistedBoard | undefined> {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath(dataDirectory), 'utf8')) as PersistedBoard;
    if (parsed?.version !== 1 || !Array.isArray(parsed.picks) || !Array.isArray(parsed.draftOrder)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Delete the saved snapshot, so a finished draft is not offered for resume.
 *
 * @param dataDirectory - Data directory override for tests.
 */
export async function clearBoardSnapshot(dataDirectory?: string): Promise<void> {
  try {
    await unlink(snapshotPath(dataDirectory));
  } catch {
    // Nothing to clear.
  }
}
