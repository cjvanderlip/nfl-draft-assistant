import { assertNonEmptyString, assertNumberInRange } from '../../validators.js';

export type TrackedDependencyName = 'database' | 'provider';
export type TrackedDependencyHealth = 'ok' | 'degraded' | 'unknown';

interface DependencyRecord {
  status: TrackedDependencyHealth;
  updatedAt: number;
}

export interface DependencyHealthTracker {
  markSuccess(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth>;
  markFailure(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth>;
  markUnknown(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth>;
  getCurrentHealth(): Record<TrackedDependencyName, TrackedDependencyHealth>;
}

/**
 * Create an in-memory dependency health tracker for dynamic runtime checks.
 *
 * @param staleAfterMs - Milliseconds after which an `ok` dependency becomes degraded when not refreshed.
 * @returns Health tracker with mutation and snapshot helpers.
 */
export function createDependencyHealthTracker(staleAfterMs = 60000): DependencyHealthTracker {
  assertNumberInRange(staleAfterMs, 'staleAfterMs', 1, 86_400_000);

  const records: Record<TrackedDependencyName, DependencyRecord> = {
    database: { status: 'unknown', updatedAt: Date.now() },
    provider: { status: 'unknown', updatedAt: Date.now() },
  };

  function assertDependency(dependency: string): asserts dependency is TrackedDependencyName {
    assertNonEmptyString(dependency, 'dependency');
    if (dependency !== 'database' && dependency !== 'provider') {
      throw new TypeError('dependency must be either "database" or "provider".');
    }
  }

  function updateStatus(dependency: TrackedDependencyName, status: TrackedDependencyHealth): Record<TrackedDependencyName, TrackedDependencyHealth> {
    records[dependency] = {
      status,
      updatedAt: Date.now(),
    };
    return {
      database: records.database.status,
      provider: records.provider.status,
    };
  }

  return {
    markSuccess(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth> {
      assertDependency(dependency);
      return updateStatus(dependency, 'ok');
    },
    markFailure(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth> {
      assertDependency(dependency);
      return updateStatus(dependency, 'degraded');
    },
    markUnknown(dependency: TrackedDependencyName): Record<TrackedDependencyName, TrackedDependencyHealth> {
      assertDependency(dependency);
      return updateStatus(dependency, 'unknown');
    },
    getCurrentHealth(): Record<TrackedDependencyName, TrackedDependencyHealth> {
      const now = Date.now();
      const health = { ...records };
      for (const [dependency, record] of Object.entries(health) as [TrackedDependencyName, DependencyRecord][]) {
        if (record.status === 'ok' && now - record.updatedAt > staleAfterMs) {
          health[dependency] = {
            status: 'degraded',
            updatedAt: record.updatedAt,
          };
        }
      }

      return {
        database: health.database.status,
        provider: health.provider.status,
      };
    },
  };
}
