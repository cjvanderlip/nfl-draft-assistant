import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface DispatchableAlert {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
}

export interface SuppressedAlert {
  code: string;
  reason: 'cooldown_active';
  retryAfterSeconds: number;
}

export interface AlertDispatchResult {
  dispatched: DispatchableAlert[];
  suppressed: SuppressedAlert[];
}

export interface AlertDispatcher {
  dispatchAlerts(alerts: DispatchableAlert[], now?: string): AlertDispatchResult;
}

/**
 * Create an in-memory alert dispatcher that suppresses duplicate alerts during a cooldown window.
 *
 * @param options - Dispatcher behavior configuration.
 * @returns Stateful dispatcher for alert delivery decisions.
 */
export function createAlertDispatcher(options: { cooldownSeconds?: number } = {}): AlertDispatcher {
  assertObject(options, 'options');
  const cooldownSeconds = options.cooldownSeconds ?? 300;
  assertNumberInRange(cooldownSeconds, 'options.cooldownSeconds', 1, 86_400);

  const lastDispatchedAtByCode = new Map<string, number>();

  return {
    dispatchAlerts(alerts: DispatchableAlert[], now = new Date().toISOString()): AlertDispatchResult {
      if (!Array.isArray(alerts)) {
        throw new TypeError('alerts must be an array.');
      }
      assertNonEmptyString(now, 'now');
      const nowMs = Date.parse(now);
      if (Number.isNaN(nowMs)) {
        throw new TypeError('now must be a valid ISO date string.');
      }

      const dispatched: DispatchableAlert[] = [];
      const suppressed: SuppressedAlert[] = [];
      for (const alert of alerts) {
        assertObject(alert, 'alert');
        assertNonEmptyString(alert.code, 'alert.code');
        assertNonEmptyString(alert.message, 'alert.message');
        assertObject(alert.metadata, 'alert.metadata');
        if (alert.severity !== 'info' && alert.severity !== 'warning' && alert.severity !== 'critical') {
          throw new TypeError('alert.severity must be "info", "warning", or "critical".');
        }

        const lastDispatchedAt = lastDispatchedAtByCode.get(alert.code);
        if (lastDispatchedAt !== undefined) {
          const elapsedMs = nowMs - lastDispatchedAt;
          if (elapsedMs < cooldownSeconds * 1000) {
            suppressed.push({
              code: alert.code,
              reason: 'cooldown_active',
              retryAfterSeconds: Math.max(1, Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000)),
            });
            continue;
          }
        }

        lastDispatchedAtByCode.set(alert.code, nowMs);
        dispatched.push({
          code: alert.code,
          severity: alert.severity,
          message: alert.message,
          metadata: { ...alert.metadata },
        });
      }

      return {
        dispatched: dispatched.map((alert) => ({ ...alert, metadata: { ...alert.metadata } })),
        suppressed: suppressed.map((alert) => ({ ...alert })),
      };
    },
  };
}
