import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface ObservabilityEvent {
  timestamp: string;
  level: 'info' | 'error';
  eventName: string;
  details: Record<string, unknown>;
}

export interface TimingMetric {
  count: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
}

export interface ObservabilitySnapshot {
  counters: Record<string, number>;
  timings: Record<string, TimingMetric>;
  recentEvents: ObservabilityEvent[];
}

export interface RuntimeObservability {
  incrementCounter(metricName: string, amount?: number): ObservabilitySnapshot;
  recordTiming(metricName: string, durationMs: number): ObservabilitySnapshot;
  logEvent(level: 'info' | 'error', eventName: string, details?: Record<string, unknown>): ObservabilitySnapshot;
  getSnapshot(): ObservabilitySnapshot;
}

/**
 * Create an in-memory observability collector for counters, timings, and events.
 *
 * @param options - Optional logger hook and event retention limit.
 * @returns Runtime observability collector.
 */
export function createRuntimeObservability(options: {
  eventLimit?: number;
  logger?: (entry: ObservabilityEvent) => void;
} = {}): RuntimeObservability {
  assertObject(options, 'options');
  const eventLimit = options.eventLimit ?? 100;
  assertNumberInRange(eventLimit, 'options.eventLimit', 1, 1000);

  const counters: Record<string, number> = {};
  const timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  const events: ObservabilityEvent[] = [];
  const logger = options.logger ?? ((entry: ObservabilityEvent) => {
    const message = JSON.stringify(entry);
    if (entry.level === 'error') {
      console.error(message);
      return;
    }
    console.info(message);
  });

  function snapshot(): ObservabilitySnapshot {
    const timingSnapshot = Object.fromEntries(
      [...timings.entries()].map(([metricName, metric]) => [
        metricName,
        {
          count: metric.count,
          totalMs: Number(metric.totalMs.toFixed(2)),
          averageMs: Number((metric.totalMs / metric.count).toFixed(2)),
          maxMs: Number(metric.maxMs.toFixed(2)),
        },
      ]),
    ) as Record<string, TimingMetric>;

    return {
      counters: { ...counters },
      timings: timingSnapshot,
      recentEvents: events.map((event) => ({ ...event, details: { ...event.details } })),
    };
  }

  return {
    incrementCounter(metricName: string, amount = 1): ObservabilitySnapshot {
      assertNonEmptyString(metricName, 'metricName');
      assertNumberInRange(amount, 'amount', 1, 1_000_000);
      counters[metricName] = (counters[metricName] ?? 0) + amount;
      return snapshot();
    },
    recordTiming(metricName: string, durationMs: number): ObservabilitySnapshot {
      assertNonEmptyString(metricName, 'metricName');
      assertNumberInRange(durationMs, 'durationMs', 0, 86_400_000);
      const current = timings.get(metricName) ?? { count: 0, totalMs: 0, maxMs: 0 };
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      timings.set(metricName, current);
      return snapshot();
    },
    logEvent(level: 'info' | 'error', eventName: string, details: Record<string, unknown> = {}): ObservabilitySnapshot {
      if (level !== 'info' && level !== 'error') {
        throw new TypeError('level must be "info" or "error".');
      }
      assertNonEmptyString(eventName, 'eventName');
      assertObject(details, 'details');
      const entry: ObservabilityEvent = {
        timestamp: new Date().toISOString(),
        level,
        eventName,
        details: { ...details },
      };
      events.push(entry);
      if (events.length > eventLimit) {
        events.splice(0, events.length - eventLimit);
      }
      logger(entry);
      return snapshot();
    },
    getSnapshot(): ObservabilitySnapshot {
      return snapshot();
    },
  };
}
