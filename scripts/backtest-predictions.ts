import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtestPredictions, type HistoricalPredictionPick, type PredictionBacktestResult } from '../src/services/prediction-engine.js';

interface ImportedHistoricalDraft {
  sourceFile: string;
  picks: Array<{ managerId: string; playerId: string; overallPick: number }>;
  players: Record<string, { position: HistoricalPredictionPick['position'] }>;
}

interface BacktestReport {
  sourceFile: string;
  result: PredictionBacktestResult;
}

/**
 * Build backtest input rows from one imported historical draft payload.
 *
 * @param draft - Imported draft row from data/historical-drafts.json.
 * @returns Prediction backtest input rows ordered by overall pick.
 */
export function buildBacktestInput(draft: ImportedHistoricalDraft): HistoricalPredictionPick[] {
  return [...draft.picks]
    .sort((left, right) => left.overallPick - right.overallPick)
    .flatMap((pick) => {
      const position = draft.players[pick.playerId]?.position;
      if (!position) {
        return [];
      }
      return [{
        managerId: pick.managerId,
        playerId: pick.playerId,
        position,
        overallPick: pick.overallPick,
      }];
    });
}

/**
 * Run prediction backtests for every imported historical draft snapshot.
 *
 * @param historicalDataPath - Path to the imported historical drafts JSON file.
 * @returns Backtest report per historical source file.
 */
export async function runPredictionBacktests(historicalDataPath: string): Promise<BacktestReport[]> {
  const raw = await readFile(historicalDataPath, 'utf8');
  const drafts = JSON.parse(raw) as ImportedHistoricalDraft[];
  if (!Array.isArray(drafts)) {
    throw new Error('Historical draft payload must be a JSON array.');
  }

  const reports: BacktestReport[] = [];
  for (const draft of drafts) {
    const picks = buildBacktestInput(draft);
    if (picks.length < 2) {
      continue;
    }
    reports.push({
      sourceFile: draft.sourceFile,
      result: backtestPredictions(picks),
    });
  }

  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputFile = process.argv[2] ?? 'data/historical-drafts.json';
  const resolvedInputFile = path.resolve(inputFile);

  runPredictionBacktests(inputFile)
    .then((reports) => {
      if (reports.length === 0) {
        throw new Error(`No drafts in ${resolvedInputFile} contained enough picks to backtest.`);
      }
      const aggregate = reports.reduce((totals, report) => ({
        drafts: totals.drafts + 1,
        topOneHitRate: totals.topOneHitRate + report.result.topOneHitRate,
        topThreeHitRate: totals.topThreeHitRate + report.result.topThreeHitRate,
        positionAccuracy: totals.positionAccuracy + report.result.positionAccuracy,
      }), {
        drafts: 0,
        topOneHitRate: 0,
        topThreeHitRate: 0,
        positionAccuracy: 0,
      });

      console.log(`Backtested ${aggregate.drafts} historical drafts from ${resolvedInputFile}.`);
      console.log(`Avg top-1 hit rate: ${(aggregate.topOneHitRate / aggregate.drafts).toFixed(4)}`);
      console.log(`Avg top-3 hit rate: ${(aggregate.topThreeHitRate / aggregate.drafts).toFixed(4)}`);
      console.log(`Avg position accuracy: ${(aggregate.positionAccuracy / aggregate.drafts).toFixed(4)}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Prediction backtest failed.');
      process.exitCode = 1;
    });
}
