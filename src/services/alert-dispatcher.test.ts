import { describe, expect, it } from 'vitest';

import { createAlertDispatcher } from './alert-dispatcher.js';

describe('createAlertDispatcher', () => {
  it('dispatches alerts and suppresses duplicates during cooldown', () => {
    const dispatcher = createAlertDispatcher({ cooldownSeconds: 60 });
    const alerts = [{
      code: 'HIGH_ERROR_RATE',
      severity: 'critical' as const,
      message: 'Error rate exceeded threshold.',
      metadata: { errorRate: 0.75 },
    }];

    const firstResult = dispatcher.dispatchAlerts(alerts, '2026-08-22T10:00:00.000Z');
    expect(firstResult).toMatchObject({
      dispatched: [{ code: 'HIGH_ERROR_RATE' }],
      suppressed: [],
    });

    const secondResult = dispatcher.dispatchAlerts(alerts, '2026-08-22T10:00:20.000Z');
    expect(secondResult).toMatchObject({
      dispatched: [],
      suppressed: [{ code: 'HIGH_ERROR_RATE', reason: 'cooldown_active' }],
    });
  });

  it('re-dispatches alerts after cooldown elapses', () => {
    const dispatcher = createAlertDispatcher({ cooldownSeconds: 30 });
    const alerts = [{
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: 'warning' as const,
      message: 'Internal errors detected.',
      metadata: { internalErrors: 3 },
    }];

    dispatcher.dispatchAlerts(alerts, '2026-08-22T10:00:00.000Z');
    const result = dispatcher.dispatchAlerts(alerts, '2026-08-22T10:00:31.000Z');
    expect(result).toMatchObject({
      dispatched: [{ code: 'INTERNAL_REQUEST_ERRORS' }],
      suppressed: [],
    });
  });
});
