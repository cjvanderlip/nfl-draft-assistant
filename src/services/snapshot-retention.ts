import { assertNumberInRange, assertObject } from '../../validators.js';
import type { DraftRepository } from '../storage/repositories/draft-repository.js';

export interface SnapshotRetentionRunResult {
  deletedPredictionBacktests: number;
  deletedHeuristicScores: number;
  deletedStrategyRecommendations: number;
}

export interface SnapshotRetentionController {
  stop(): void;
  isRunning(): boolean;
}

/**
 * Run one retention sweep across all snapshot types.
 *
 * @param repository - Draft repository storing snapshots.
 * @param options - Sweep configuration.
 * @returns Number of deleted rows per snapshot type.
 */
export async function runSnapshotRetentionSweep(
  repository: DraftRepository,
  options: { keepLatest: number; draftSessionId?: string },
): Promise<SnapshotRetentionRunResult> {
  assertObject(repository, 'repository');
  assertObject(options, 'options');
  assertNumberInRange(options.keepLatest, 'options.keepLatest', 0, 1000);

  const deletedPredictionBacktests = await repository.deleteStalePredictionBacktests(options);
  const deletedHeuristicScores = await repository.deleteStaleHeuristicScores(options);
  const deletedStrategyRecommendations = await repository.deleteStaleStrategyRecommendations(options);
  return {
    deletedPredictionBacktests,
    deletedHeuristicScores,
    deletedStrategyRecommendations,
  };
}

/**
 * Start a recurring snapshot retention job.
 *
 * @param options - Repository, scheduling cadence, and retention settings.
 * @returns Controller used to stop periodic retention.
 */
export function startSnapshotRetentionJob(options: {
  repository: DraftRepository;
  intervalSeconds: number;
  keepLatest: number;
  draftSessionId?: string;
  runOnStart?: boolean;
  onRun?: (result: SnapshotRetentionRunResult) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}): SnapshotRetentionController {
  assertObject(options, 'options');
  assertObject(options.repository, 'options.repository');
  assertNumberInRange(options.intervalSeconds, 'options.intervalSeconds', 1, 86_400);
  assertNumberInRange(options.keepLatest, 'options.keepLatest', 0, 1000);

  let running = true;
  let activeSweep = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = (): void => {
    if (!running) {
      return;
    }
    timer = setTimeout(() => {
      void runOnce();
    }, options.intervalSeconds * 1000);
  };

  const runOnce = async (): Promise<void> => {
    if (!running || activeSweep) {
      return;
    }

    activeSweep = true;
    try {
      const result = await runSnapshotRetentionSweep(options.repository, {
        keepLatest: options.keepLatest,
        draftSessionId: options.draftSessionId,
      });
      await options.onRun?.(result);
    } catch (error: unknown) {
      if (options.onError) {
        await options.onError(error);
      } else {
        console.error('Snapshot retention job failed.', error);
      }
    } finally {
      activeSweep = false;
      scheduleNext();
    }
  };

  if (options.runOnStart ?? true) {
    void runOnce();
  } else {
    scheduleNext();
  }

  return {
    stop(): void {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    isRunning(): boolean {
      return running;
    },
  };
}
