import type { Position } from '../../validators.js';
import { pickNumbersForSlot, type DraftBoard } from './draft-board.js';

export interface RosterRequirement {
  position: Position;
  required: number;
  filled: number;
  short: number;
}

export interface RosterRequirementStatus {
  turnsLeft: number;
  needed: RosterRequirement[];
  /**
   * True when every remaining turn is already spoken for by a mandatory slot,
   * so the next pick has to be one of them.
   */
  forced: boolean;
  message?: string;
}

/**
 * Positions every team must finish the draft holding, and how many of each.
 *
 * Measured over the 108 team-seasons in `historical-draft-data/`: every roster
 * carries exactly one kicker (108 of 108) and one defense (106 of 108), and no
 * roster has ever finished without a quarterback. Nothing else is mandatory —
 * running back and receiver counts range too widely to constrain.
 */
export const MANDATORY_SLOTS: Partial<Record<Position, number>> = {
  QB: 1,
  K: 1,
  DST: 1,
};

/**
 * Report which mandatory roster slots are still unfilled and how much room is left.
 *
 * A thirteen-round draft has no spare picks at the end: a manager who reaches the
 * last two rounds still needing a kicker and a defense has no choice left to make.
 * Comparing outstanding slots against remaining turns turns that into a warning
 * several rounds before it becomes a problem.
 *
 * @param board - Live draft board.
 * @param ownerId - Owner whose roster to check.
 * @param roster - That owner's current position counts.
 * @returns Outstanding mandatory slots and whether the remaining turns are all spoken for.
 */
export function evaluateRosterRequirements(
  board: DraftBoard,
  roster: Partial<Record<Position, number>>,
): RosterRequirementStatus {
  const nextOverall = board.picks.length + 1;
  const turnsLeft = pickNumbersForSlot(board.draftSlot, board.teamCount, board.rounds)
    .filter((pickNumber) => pickNumber >= nextOverall)
    .length;

  const needed: RosterRequirement[] = [];
  for (const [position, required] of Object.entries(MANDATORY_SLOTS)) {
    const filled = roster[position as Position] ?? 0;
    const short = (required ?? 0) - filled;
    if (short > 0) {
      needed.push({ position: position as Position, required: required ?? 0, filled, short });
    }
  }

  const outstanding = needed.reduce((sum, requirement) => sum + requirement.short, 0);
  const forced = outstanding > 0 && outstanding >= turnsLeft;

  let message: string | undefined;
  if (outstanding > turnsLeft) {
    message = `${turnsLeft} turn${turnsLeft === 1 ? '' : 's'} left but ${outstanding} mandatory slots unfilled (${needed.map((requirement) => requirement.position).join(', ')}). You cannot finish a legal roster.`;
  } else if (forced) {
    message = `Every remaining turn is spoken for: you still need ${needed.map((requirement) => requirement.position).join(' and ')}.`;
  } else if (outstanding > 0 && turnsLeft - outstanding <= 2) {
    message = `${turnsLeft} turns left and you still need ${needed.map((requirement) => requirement.position).join(', ')}. ${turnsLeft - outstanding} free pick${turnsLeft - outstanding === 1 ? '' : 's'} remaining.`;
  }

  return { turnsLeft, needed, forced, message };
}
