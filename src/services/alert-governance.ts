import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';
import type { DispatchableAlert } from './alert-dispatcher.js';
import type { AlertDeliveryRecord } from './alert-notifier.js';

export interface AlertGovernanceSuppression {
  code: string;
  reason: 'silenced' | 'acknowledged';
  silencedUntil?: string;
  acknowledgedAt?: string;
}

export interface AlertEscalation {
  code: string;
  escalationLevel: number;
  failureCount: number;
  reason: 'consecutive_delivery_failures';
}

export interface AlertGovernanceState {
  code: string;
  silencedUntil: string | null;
  acknowledgedAt: string | null;
  acknowledgedNote: string | null;
  consecutiveDeliveryFailures: number;
  escalationLevel: number;
  updatedAt: string;
}

export interface AlertGovernance {
  silenceAlert(input: { code: string; durationSeconds: number; now?: string }): AlertGovernanceState;
  acknowledgeAlert(input: { code: string; note?: string; now?: string }): AlertGovernanceState;
  listStates(): AlertGovernanceState[];
  filterAlerts(alerts: DispatchableAlert[], now?: string): {
    eligible: DispatchableAlert[];
    suppressed: AlertGovernanceSuppression[];
  };
  recordDeliveryOutcome(deliveries: AlertDeliveryRecord[], now?: string): { escalations: AlertEscalation[] };
}

interface MutableAlertGovernanceState {
  code: string;
  silencedUntil: string | null;
  acknowledgedAt: string | null;
  acknowledgedNote: string | null;
  consecutiveDeliveryFailures: number;
  escalationLevel: number;
  updatedAt: string;
}

/**
 * Create in-memory alert governance for acknowledgements, silence windows, and escalation tracking.
 *
 * @param options - Governance settings for silence and escalation thresholds.
 * @returns Stateful governance coordinator.
 */
export function createAlertGovernance(options: {
  maxSilenceSeconds?: number;
  escalationFailureThreshold?: number;
} = {}): AlertGovernance {
  assertObject(options, 'options');
  const maxSilenceSeconds = options.maxSilenceSeconds ?? 86_400;
  assertNumberInRange(maxSilenceSeconds, 'options.maxSilenceSeconds', 1, 604_800);
  const escalationFailureThreshold = options.escalationFailureThreshold ?? 3;
  assertNumberInRange(escalationFailureThreshold, 'options.escalationFailureThreshold', 1, 20);

  const states = new Map<string, MutableAlertGovernanceState>();

  function requireState(code: string, now: string): MutableAlertGovernanceState {
    const existing = states.get(code);
    if (existing) {
      return existing;
    }
    const created: MutableAlertGovernanceState = {
      code,
      silencedUntil: null,
      acknowledgedAt: null,
      acknowledgedNote: null,
      consecutiveDeliveryFailures: 0,
      escalationLevel: 0,
      updatedAt: now,
    };
    states.set(code, created);
    return created;
  }

  function parseNow(now: string): number {
    assertNonEmptyString(now, 'now');
    const timestamp = Date.parse(now);
    if (Number.isNaN(timestamp)) {
      throw new TypeError('now must be a valid ISO date string.');
    }
    return timestamp;
  }

  function cloneState(state: MutableAlertGovernanceState): AlertGovernanceState {
    return { ...state };
  }

  return {
    silenceAlert(input: { code: string; durationSeconds: number; now?: string }): AlertGovernanceState {
      assertObject(input, 'input');
      assertNonEmptyString(input.code, 'input.code');
      assertNumberInRange(input.durationSeconds, 'input.durationSeconds', 1, maxSilenceSeconds);
      const now = input.now ?? new Date().toISOString();
      const nowMs = parseNow(now);
      const state = requireState(input.code, now);
      state.silencedUntil = new Date(nowMs + input.durationSeconds * 1000).toISOString();
      state.updatedAt = now;
      return cloneState(state);
    },
    acknowledgeAlert(input: { code: string; note?: string; now?: string }): AlertGovernanceState {
      assertObject(input, 'input');
      assertNonEmptyString(input.code, 'input.code');
      const now = input.now ?? new Date().toISOString();
      parseNow(now);
      const state = requireState(input.code, now);
      state.acknowledgedAt = now;
      state.acknowledgedNote = input.note?.trim() || null;
      state.updatedAt = now;
      return cloneState(state);
    },
    listStates(): AlertGovernanceState[] {
      return [...states.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((state) => cloneState(state));
    },
    filterAlerts(alerts: DispatchableAlert[], now = new Date().toISOString()): {
      eligible: DispatchableAlert[];
      suppressed: AlertGovernanceSuppression[];
    } {
      if (!Array.isArray(alerts)) {
        throw new TypeError('alerts must be an array.');
      }
      const nowMs = parseNow(now);
      const eligible: DispatchableAlert[] = [];
      const suppressed: AlertGovernanceSuppression[] = [];
      for (const alert of alerts) {
        assertObject(alert, 'alert');
        assertNonEmptyString(alert.code, 'alert.code');
        const state = states.get(alert.code);
        if (!state) {
          eligible.push({ ...alert, metadata: { ...alert.metadata } });
          continue;
        }
        if (state.silencedUntil !== null && Date.parse(state.silencedUntil) > nowMs) {
          suppressed.push({
            code: alert.code,
            reason: 'silenced',
            silencedUntil: state.silencedUntil,
          });
          continue;
        }
        if (state.silencedUntil !== null && Date.parse(state.silencedUntil) <= nowMs) {
          state.silencedUntil = null;
          state.updatedAt = now;
        }
        if (state.acknowledgedAt !== null) {
          suppressed.push({
            code: alert.code,
            reason: 'acknowledged',
            acknowledgedAt: state.acknowledgedAt,
          });
          continue;
        }
        eligible.push({ ...alert, metadata: { ...alert.metadata } });
      }
      return {
        eligible,
        suppressed,
      };
    },
    recordDeliveryOutcome(deliveries: AlertDeliveryRecord[], now = new Date().toISOString()): { escalations: AlertEscalation[] } {
      if (!Array.isArray(deliveries)) {
        throw new TypeError('deliveries must be an array.');
      }
      parseNow(now);
      const escalations: AlertEscalation[] = [];
      for (const delivery of deliveries) {
        assertObject(delivery, 'delivery');
        assertNonEmptyString(delivery.alertCode, 'delivery.alertCode');
        const state = requireState(delivery.alertCode, now);
        state.updatedAt = now;
        if (delivery.status === 'sent') {
          state.consecutiveDeliveryFailures = 0;
          state.escalationLevel = 0;
          continue;
        }
        if (delivery.status !== 'failed') {
          throw new TypeError('delivery.status must be "sent" or "failed".');
        }
        state.consecutiveDeliveryFailures += 1;
        const nextEscalationLevel = Math.floor(state.consecutiveDeliveryFailures / escalationFailureThreshold);
        if (nextEscalationLevel > state.escalationLevel) {
          state.escalationLevel = nextEscalationLevel;
          escalations.push({
            code: state.code,
            escalationLevel: state.escalationLevel,
            failureCount: state.consecutiveDeliveryFailures,
            reason: 'consecutive_delivery_failures',
          });
        }
      }
      return { escalations };
    },
  };
}
