import { describe, expect, it } from 'vitest';

import { createAlertGovernance } from './alert-governance.js';

describe('createAlertGovernance', () => {
  it('suppresses silenced alerts until silence window expires', () => {
    const governance = createAlertGovernance({ maxSilenceSeconds: 120 });
    governance.silenceAlert({
      code: 'HIGH_ERROR_RATE',
      durationSeconds: 60,
      now: '2026-08-22T10:00:00.000Z',
    });

    expect(governance.filterAlerts([{
      code: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'error rate high',
      metadata: {},
    }], '2026-08-22T10:00:10.000Z')).toMatchObject({
      eligible: [],
      suppressed: [{ code: 'HIGH_ERROR_RATE', reason: 'silenced' }],
    });

    expect(governance.filterAlerts([{
      code: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'error rate high',
      metadata: {},
    }], '2026-08-22T10:01:10.000Z')).toMatchObject({
      eligible: [{ code: 'HIGH_ERROR_RATE' }],
      suppressed: [],
    });
  });

  it('suppresses acknowledged alerts and escalates on repeated delivery failure', () => {
    const governance = createAlertGovernance({ escalationFailureThreshold: 2 });
    governance.acknowledgeAlert({
      code: 'INTERNAL_REQUEST_ERRORS',
      note: 'Investigating',
      now: '2026-08-22T10:00:00.000Z',
    });

    expect(governance.filterAlerts([{
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: 'warning',
      message: 'request errors',
      metadata: {},
    }], '2026-08-22T10:00:01.000Z')).toMatchObject({
      eligible: [],
      suppressed: [{ code: 'INTERNAL_REQUEST_ERRORS', reason: 'acknowledged' }],
    });

    const first = governance.recordDeliveryOutcome([{
      channel: 'webhook',
      alertCode: 'DELIVERY_OUTAGE',
      attempts: 1,
      status: 'failed',
      error: 'bad gateway',
    }], '2026-08-22T10:01:00.000Z');
    expect(first.escalations).toHaveLength(0);

    const second = governance.recordDeliveryOutcome([{
      channel: 'webhook',
      alertCode: 'DELIVERY_OUTAGE',
      attempts: 1,
      status: 'failed',
      error: 'bad gateway',
    }], '2026-08-22T10:02:00.000Z');
    expect(second.escalations).toMatchObject([{
      code: 'DELIVERY_OUTAGE',
      escalationLevel: 1,
      failureCount: 2,
    }]);
  });
});
