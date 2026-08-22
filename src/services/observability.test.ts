import { describe, expect, it } from 'vitest';

import { createRuntimeObservability } from './observability.js';

describe('createRuntimeObservability', () => {
  it('tracks counters, timings, and recent events', () => {
    const loggedEvents: string[] = [];
    const observability = createRuntimeObservability({
      eventLimit: 2,
      logger: (entry) => {
        loggedEvents.push(entry.eventName);
      },
    });

    observability.incrementCounter('snapshots.created');
    observability.recordTiming('snapshots.create.durationMs', 15);
    observability.recordTiming('snapshots.create.durationMs', 5);
    observability.logEvent('info', 'snapshot-created', { id: 's1' });
    observability.logEvent('info', 'snapshot-listed');
    observability.logEvent('error', 'snapshot-cleanup-failed');

    const snapshot = observability.getSnapshot();
    expect(snapshot.counters['snapshots.created']).toBe(1);
    expect(snapshot.timings['snapshots.create.durationMs']).toMatchObject({
      count: 2,
      totalMs: 20,
      averageMs: 10,
      maxMs: 15,
    });
    expect(snapshot.recentEvents).toHaveLength(2);
    expect(snapshot.recentEvents[0].eventName).toBe('snapshot-listed');
    expect(snapshot.recentEvents[1].eventName).toBe('snapshot-cleanup-failed');
    expect(loggedEvents).toEqual(['snapshot-created', 'snapshot-listed', 'snapshot-cleanup-failed']);
  });
});
