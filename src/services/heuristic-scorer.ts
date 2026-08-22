import { assertArray, assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface HeuristicWeights {
  contractYearBump: number;
  targetShareVolatility: number;
  olineUpgrade: number;
  rzRegression: number;
  gameScriptLeverage: number;
}

export interface HeuristicSignals {
  contractYear: number;
  targetShareVolatility: number;
  olineUpgrade: number;
  rzRegression: number;
  gameScriptLeverage: number;
}

export interface HeuristicCandidate {
  playerId: string;
  baseRank: number;
  signals: HeuristicSignals;
}

export interface ScoredHeuristicCandidate {
  playerId: string;
  baseRank: number;
  adjustedRank: number;
  signalBreakdown: HeuristicSignals;
  weightedContributions: HeuristicSignals;
  compositeScore: number;
}

/**
 * Build validated heuristic weights from defaults and user overrides.
 *
 * @param defaults - Baseline weights.
 * @param overrides - Optional user-provided overrides.
 * @returns Validated merged weights.
 */
export function buildHeuristicWeights(
  defaults: HeuristicWeights,
  overrides: Partial<HeuristicWeights> = {},
): HeuristicWeights {
  assertObject(defaults, 'defaults');
  assertObject(overrides, 'overrides');

  const merged: HeuristicWeights = {
    contractYearBump: overrides.contractYearBump ?? defaults.contractYearBump,
    targetShareVolatility: overrides.targetShareVolatility ?? defaults.targetShareVolatility,
    olineUpgrade: overrides.olineUpgrade ?? defaults.olineUpgrade,
    rzRegression: overrides.rzRegression ?? defaults.rzRegression,
    gameScriptLeverage: overrides.gameScriptLeverage ?? defaults.gameScriptLeverage,
  };
  validateWeights(merged, 'weights');
  return { ...merged };
}

/**
 * Apply heuristic scoring across draft candidates.
 *
 * @param candidates - Candidate players with base rank and normalized signal values.
 * @param weights - Heuristic weighting configuration.
 * @returns Candidates sorted by strongest composite score first.
 */
export function scoreCandidatesWithHeuristics(
  candidates: HeuristicCandidate[],
  weights: HeuristicWeights,
): ScoredHeuristicCandidate[] {
  assertArray(candidates, 'candidates');
  validateWeights(weights, 'weights');

  const scored = candidates.map((candidate, index) => scoreHeuristicCandidate(candidate, weights, index));
  const ranked = [...scored].sort((left, right) => right.compositeScore - left.compositeScore);
  return ranked.map((candidate, index) => ({
    ...candidate,
    adjustedRank: index + 1,
  }));
}

function scoreHeuristicCandidate(
  candidate: HeuristicCandidate,
  weights: HeuristicWeights,
  index: number,
): ScoredHeuristicCandidate {
  assertObject(candidate, `candidates[${index}]`);
  assertNonEmptyString(candidate.playerId, `candidates[${index}].playerId`);
  assertNumberInRange(candidate.baseRank, `candidates[${index}].baseRank`, 1, 1000);
  validateSignals(candidate.signals, `candidates[${index}].signals`);

  const weightedContributions: HeuristicSignals = {
    contractYear: Number((candidate.signals.contractYear * weights.contractYearBump).toFixed(4)),
    targetShareVolatility: Number((candidate.signals.targetShareVolatility * weights.targetShareVolatility).toFixed(4)),
    olineUpgrade: Number((candidate.signals.olineUpgrade * weights.olineUpgrade).toFixed(4)),
    rzRegression: Number((candidate.signals.rzRegression * weights.rzRegression).toFixed(4)),
    gameScriptLeverage: Number((candidate.signals.gameScriptLeverage * weights.gameScriptLeverage).toFixed(4)),
  };

  const baseRankScore = 1 / candidate.baseRank;
  const weightedScore = Object.values(weightedContributions).reduce((sum, value) => sum + value, 0);

  return {
    playerId: candidate.playerId,
    baseRank: candidate.baseRank,
    adjustedRank: candidate.baseRank,
    signalBreakdown: { ...candidate.signals },
    weightedContributions,
    compositeScore: Number((baseRankScore + weightedScore).toFixed(4)),
  };
}

function validateWeights(weights: HeuristicWeights, fieldName: string): void {
  assertObject(weights, fieldName);
  assertNumberInRange(weights.contractYearBump, `${fieldName}.contractYearBump`, -10, 10);
  assertNumberInRange(weights.targetShareVolatility, `${fieldName}.targetShareVolatility`, -10, 10);
  assertNumberInRange(weights.olineUpgrade, `${fieldName}.olineUpgrade`, -10, 10);
  assertNumberInRange(weights.rzRegression, `${fieldName}.rzRegression`, -10, 10);
  assertNumberInRange(weights.gameScriptLeverage, `${fieldName}.gameScriptLeverage`, -10, 10);
}

function validateSignals(signals: HeuristicSignals, fieldName: string): void {
  assertObject(signals, fieldName);
  assertNumberInRange(signals.contractYear, `${fieldName}.contractYear`, -1, 1);
  assertNumberInRange(signals.targetShareVolatility, `${fieldName}.targetShareVolatility`, -1, 1);
  assertNumberInRange(signals.olineUpgrade, `${fieldName}.olineUpgrade`, -1, 1);
  assertNumberInRange(signals.rzRegression, `${fieldName}.rzRegression`, -1, 1);
  assertNumberInRange(signals.gameScriptLeverage, `${fieldName}.gameScriptLeverage`, -1, 1);
}
