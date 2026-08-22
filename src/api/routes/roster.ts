import { assertObject } from '../../../validators.js';
import {
  buildStrategyAwareRecommendations,
  type DraftedPlayer,
  type StrategyCandidate,
  type StrategyRosterEvaluation,
} from '../../services/roster-strategy.js';
import type { Position, StrategyProfile } from '../../../validators.js';

/**
 * Build strategy-aware roster recommendations from request payload input.
 *
 * @param payload - JSON payload with strategy, roster state, and candidate scores.
 * @returns Roster constraints and recommendation ordering.
 */
export function scoreRosterFromPayload(payload: unknown): StrategyRosterEvaluation {
  assertObject(payload, 'payload');
  const request = payload as {
    strategyProfile?: StrategyProfile;
    starters?: Partial<Record<Position, number>>;
    draftedPlayers?: DraftedPlayer[];
    candidates?: StrategyCandidate[];
    maxPerPosition?: Partial<Record<Position, number>>;
  };

  return buildStrategyAwareRecommendations({
    strategyProfile: request.strategyProfile as StrategyProfile,
    starters: request.starters as Partial<Record<Position, number>>,
    draftedPlayers: request.draftedPlayers as DraftedPlayer[],
    candidates: request.candidates as StrategyCandidate[],
    maxPerPosition: request.maxPerPosition,
  });
}
