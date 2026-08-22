import { describe, expect, it, vi } from 'vitest';

import { createDependencyHealthTracker } from './dependency-health.js';

describe('createDependencyHealthTracker', () => {
  it('tracks dependency transitions and staleness', () => {
    vi.useFakeTimers();
    const tracker = createDependencyHealthTracker(1000);

    expect(tracker.getCurrentHealth()).toEqual({
      database: 'unknown',
      provider: 'unknown',
    });

    tracker.markSuccess('database');
    tracker.markSuccess('provider');
    expect(tracker.getCurrentHealth()).toEqual({
      database: 'ok',
      provider: 'ok',
    });

    vi.advanceTimersByTime(1001);
    expect(tracker.getCurrentHealth()).toEqual({
      database: 'degraded',
      provider: 'degraded',
    });
    vi.useRealTimers();
  });

  it('marks explicit dependency failures as degraded', () => {
    const tracker = createDependencyHealthTracker();
    tracker.markFailure('provider');

    expect(tracker.getCurrentHealth().provider).toBe('degraded');
  });
});
