import type { ManagerTendencyProfile } from '../../../draft-models.js';
import { backtestPredictions, type HistoricalPredictionPick } from '../../services/prediction-engine.js';
import { assertArray, assertObject } from '../../../validators.js';

export interface BacktestResponse {
  totalEvaluated: number;
  topOneHitRate: number;
  topThreeHitRate: number;
  positionAccuracy: number;
  averageActualPickProbability: number;
}

/**
 * Execute prediction backtesting from a request payload.
 *
 * @param payload - JSON payload containing historical picks and optional tendency profiles.
 * @returns Backtest metrics for prediction quality.
 */
export function runBacktestFromPayload(payload: unknown): BacktestResponse {
  assertObject(payload, 'payload');
  const request = payload as {
    picks?: HistoricalPredictionPick[];
    tendencyProfiles?: Partial<Record<string, ManagerTendencyProfile>>;
  };
  assertArray(request.picks, 'payload.picks');
  if (request.tendencyProfiles !== undefined) {
    assertObject(request.tendencyProfiles, 'payload.tendencyProfiles');
  }

  return backtestPredictions(request.picks, request.tendencyProfiles);
}
