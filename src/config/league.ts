import type { Position } from '../../validators.js';

/**
 * Scoring format the ADP feed should be pulled in.
 *
 * Confirmed from the A-League settings page: `Recpt .5 points`. This is a
 * half-PPR league, not the full PPR everything defaulted to before — which means
 * every reach measured against a full-PPR market was measured against the wrong
 * one. `ADP_FORMAT` still overrides, for the day a league changes its scoring.
 *
 * Other scoring worth knowing, none of which affects ADP joins: passing yards run
 * 0.1 per 2 yards with 4-point passing touchdowns, and kickers earn distance
 * bonuses out to 75 yards, which makes kickers slightly less interchangeable
 * here than in a standard league.
 */
export const LEAGUE_SCORING_FORMAT = 'half-ppr';

/**
 * Secondary feed used only to fill names the primary feed does not rank.
 *
 * Far more people mock-draft full PPR than half-PPR, so the half-PPR feed is the
 * right market but the shallower list — for 2026 it ranks 229 players against
 * PPR's 266. The 38 it misses are mostly kickers, backup quarterbacks and deep
 * tight ends, which is precisely the tail a thirteen-round draft reaches in its
 * last few rounds. Those names are borrowed from the PPR feed so they resolve in
 * the pick box; the half-PPR ADP still ranks everyone it covers.
 */
export const FALLBACK_SCORING_FORMAT = 'ppr';

/** Team count in both leagues, confirmed from the settings page. */
export const LEAGUE_TEAM_COUNT = 12;

/** Rounds in the live draft, confirmed from the settings page. */
export const LEAGUE_ROUNDS = 13;

/**
 * Minimum number of each position a legal starting lineup needs.
 *
 * Taken from the A-League roster limits: every position carries an active
 * minimum of one, and an illegal roster scores zero points in the standings. So
 * finishing the draft without any one of these is not a soft mistake — it forfeits
 * the week. Historical drafts back this up: across 108 team-seasons every roster
 * ended with exactly one kicker (108 of 108) and one defense (106 of 108).
 */
export const LINEUP_MINIMUMS: Partial<Record<Position, number>> = {
  QB: 1,
  RB: 1,
  WR: 1,
  TE: 1,
  K: 1,
  DST: 1,
};

/**
 * How many of each position a manager will realistically carry on a 13-man roster.
 *
 * The league sets no per-position roster cap, so these are behavioural rather than
 * legal limits: they stop the simulation from having somebody take a fourth
 * quarterback in the twelfth round. The numbers are the observed maxima across the
 * 108 historical team-seasons — QB reached 3 once, DST reached 2 twice, TE 3 once —
 * so they constrain nothing anyone has actually done.
 */
export const REALISTIC_ROSTER_LIMITS: Partial<Record<Position, number>> = {
  QB: 3,
  TE: 3,
  K: 1,
  DST: 2,
};

/**
 * Resolve the ADP scoring format to use, honouring an explicit override.
 *
 * @param override - Value of `ADP_FORMAT`, when set.
 * @returns The scoring format to read and write ADP caches under.
 */
export function resolveScoringFormat(override?: string): string {
  const trimmed = override?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : LEAGUE_SCORING_FORMAT;
}
