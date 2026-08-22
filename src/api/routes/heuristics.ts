import { assertArray, assertObject } from '../../../validators.js';
import { DEFAULT_HEURISTIC_WEIGHTS } from '../../config/defaults.js';
import {
  buildHeuristicWeights,
  scoreCandidatesWithHeuristics,
  type HeuristicCandidate,
  type HeuristicWeights,
  type ScoredHeuristicCandidate,
} from '../../services/heuristic-scorer.js';

export interface HeuristicScoringResponse {
  weights: HeuristicWeights;
  candidates: ScoredHeuristicCandidate[];
}

/**
 * Score recommendation candidates using configurable heuristic weights.
 *
 * @param payload - JSON payload containing candidates and optional weight overrides.
 * @returns Effective weights and scored candidates.
 */
export function scoreHeuristicsFromPayload(payload: unknown): HeuristicScoringResponse {
  assertObject(payload, 'payload');
  const request = payload as {
    candidates?: HeuristicCandidate[];
    weightOverrides?: Partial<HeuristicWeights>;
  };
  assertArray(request.candidates, 'payload.candidates');
  if (request.weightOverrides !== undefined) {
    assertObject(request.weightOverrides, 'payload.weightOverrides');
  }

  const weights = buildHeuristicWeights(DEFAULT_HEURISTIC_WEIGHTS, request.weightOverrides ?? {});
  return {
    weights,
    candidates: scoreCandidatesWithHeuristics(request.candidates, weights),
  };
}
