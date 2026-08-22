import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';
import type { DispatchableAlert } from './alert-dispatcher.js';

export type AlertDeliveryChannel = 'webhook' | 'slack' | 'email';
export type AlertSeverity = DispatchableAlert['severity'];

export interface AlertDeliveryRecord {
  channel: AlertDeliveryChannel;
  alertCode: string;
  attempts: number;
  status: 'sent' | 'failed';
  error: string | null;
}

export interface AlertNotificationResult {
  deliveries: AlertDeliveryRecord[];
  sentCount: number;
  failedCount: number;
}

export interface AlertNotifier {
  notifyAlerts(alerts: DispatchableAlert[]): Promise<AlertNotificationResult>;
}

export interface AlertChannelPolicy {
  enabled?: boolean;
  webhookUrl?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  minSeverity?: AlertSeverity;
  template?: string;
}

interface WebhookSenderResponse {
  ok: boolean;
  status: number;
  statusText: string;
}

type WebhookSender = (request: {
  url: string;
  body: string;
  headers: Record<string, string>;
}) => Promise<WebhookSenderResponse>;

interface NormalizedChannelPolicy {
  enabled: boolean;
  webhookUrl?: string;
  maxAttempts: number;
  initialBackoffMs: number;
  minSeverity: AlertSeverity;
  template: string;
}

/**
 * Create a multi-channel alert notifier with retry and backoff behavior per channel.
 *
 * @param options - Channel endpoint and retry settings.
 * @returns Alert notifier for dispatching alert payloads.
 */
export function createMultiChannelAlertNotifier(options: {
  webhook?: AlertChannelPolicy;
  slack?: AlertChannelPolicy;
  email?: AlertChannelPolicy;
  sender?: WebhookSender;
  sleeper?: (milliseconds: number) => Promise<void>;
} = {}): AlertNotifier {
  assertObject(options, 'options');
  const sleeper = options.sleeper ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const sender = options.sender ?? defaultWebhookSender;
  const webhookPolicy = normalizeChannelPolicy(options.webhook, 'options.webhook');
  const slackPolicy = normalizeChannelPolicy(options.slack, 'options.slack');
  const emailPolicy = normalizeChannelPolicy(options.email, 'options.email');

  return {
    async notifyAlerts(alerts: DispatchableAlert[]): Promise<AlertNotificationResult> {
      if (!Array.isArray(alerts)) {
        throw new TypeError('alerts must be an array.');
      }

      const deliveries: AlertDeliveryRecord[] = [];
      for (const alert of alerts) {
        const channelDeliveries = await sendAlertFanout({
          alert,
          sender,
          sleeper,
          channels: {
            webhook: webhookPolicy,
            slack: slackPolicy,
            email: emailPolicy,
          },
        });
        deliveries.push(...channelDeliveries);
      }

      return {
        deliveries: deliveries.map((delivery) => ({ ...delivery })),
        sentCount: deliveries.filter((delivery) => delivery.status === 'sent').length,
        failedCount: deliveries.filter((delivery) => delivery.status === 'failed').length,
      };
    },
  };
}

/**
 * Create a webhook-only alert notifier with retry and backoff behavior.
 *
 * @param options - Webhook endpoint and retry settings.
 * @returns Alert notifier for dispatching alert payloads.
 */
export function createWebhookAlertNotifier(options: {
  webhookUrl?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  minSeverity?: AlertSeverity;
  template?: string;
  sender?: WebhookSender;
  sleeper?: (milliseconds: number) => Promise<void>;
} = {}): AlertNotifier {
  return createMultiChannelAlertNotifier({
    webhook: {
      enabled: true,
      webhookUrl: options.webhookUrl,
      maxAttempts: options.maxAttempts,
      initialBackoffMs: options.initialBackoffMs,
      minSeverity: options.minSeverity,
      template: options.template,
    },
    sender: options.sender,
    sleeper: options.sleeper,
  });
}

async function defaultWebhookSender(request: {
  url: string;
  body: string;
  headers: Record<string, string>;
}): Promise<WebhookSenderResponse> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

function normalizeChannelPolicy(
  policy: AlertChannelPolicy | undefined,
  fieldName: string,
): NormalizedChannelPolicy {
  if (policy !== undefined && (typeof policy !== 'object' || policy === null || Array.isArray(policy))) {
    throw new TypeError(`${fieldName} must be a non-null object.`);
  }
  const normalizedPolicy: AlertChannelPolicy = policy ?? {};
  const enabled = normalizedPolicy.enabled ?? true;
  const webhookUrl = normalizedPolicy.webhookUrl?.trim();
  if (webhookUrl !== undefined && webhookUrl.length > 0) {
    try {
      new URL(webhookUrl);
    } catch {
      throw new TypeError(`${fieldName}.webhookUrl must be a valid URL.`);
    }
  }
  const maxAttempts = normalizedPolicy.maxAttempts ?? 3;
  assertNumberInRange(maxAttempts, `${fieldName}.maxAttempts`, 1, 10);
  const initialBackoffMs = normalizedPolicy.initialBackoffMs ?? 250;
  assertNumberInRange(initialBackoffMs, `${fieldName}.initialBackoffMs`, 1, 60_000);
  const minSeverity = normalizeSeverity(normalizedPolicy.minSeverity, `${fieldName}.minSeverity`);
  const template = normalizeTemplate(normalizedPolicy.template, fieldName);
  return {
    enabled,
    webhookUrl: webhookUrl && webhookUrl.length > 0 ? webhookUrl : undefined,
    maxAttempts,
    initialBackoffMs,
    minSeverity,
    template,
  };
}

async function sendAlertFanout(options: {
  alert: DispatchableAlert;
  channels: Record<AlertDeliveryChannel, NormalizedChannelPolicy>;
  sender: WebhookSender;
  sleeper: (milliseconds: number) => Promise<void>;
}): Promise<AlertDeliveryRecord[]> {
  const deliveries: AlertDeliveryRecord[] = [];
  const channels: AlertDeliveryChannel[] = ['webhook', 'slack', 'email'];
  for (const channel of channels) {
    const channelPolicy = options.channels[channel];
    if (!channelPolicy.enabled || !channelPolicy.webhookUrl) {
      continue;
    }
    if (!isSeverityAllowed(options.alert.severity, channelPolicy.minSeverity)) {
      continue;
    }
    deliveries.push(await sendAlertWithRetry({
      channel,
      alert: options.alert,
      template: channelPolicy.template,
      webhookUrl: channelPolicy.webhookUrl,
      maxAttempts: channelPolicy.maxAttempts,
      initialBackoffMs: channelPolicy.initialBackoffMs,
      sender: options.sender,
      sleeper: options.sleeper,
    }));
  }
  return deliveries;
}

async function sendAlertWithRetry(options: {
  channel: AlertDeliveryChannel;
  alert: DispatchableAlert;
  template: string;
  webhookUrl: string;
  maxAttempts: number;
  initialBackoffMs: number;
  sender: WebhookSender;
  sleeper: (milliseconds: number) => Promise<void>;
}): Promise<AlertDeliveryRecord> {
  assertObject(options.alert, 'alert');
  assertNonEmptyString(options.alert.code, 'alert.code');
  assertNonEmptyString(options.alert.message, 'alert.message');
  assertObject(options.alert.metadata, 'alert.metadata');

  const payload = JSON.stringify({
    channel: options.channel,
    code: options.alert.code,
    severity: options.alert.severity,
    message: options.alert.message,
    renderedMessage: renderAlertTemplate(options.template, options.alert),
    metadata: options.alert.metadata,
    occurredAt: new Date().toISOString(),
  });

  let lastError = 'Unknown alert delivery error.';
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const response = await options.sender({
        url: options.webhookUrl,
        body: payload,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
      if (response.ok) {
        return {
          channel: options.channel,
          alertCode: options.alert.code,
          attempts: attempt,
          status: 'sent',
          error: null,
        };
      }
      lastError = `Webhook responded with HTTP ${response.status} ${response.statusText}.`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : 'Unknown webhook request failure.';
    }

    if (attempt < options.maxAttempts) {
      const backoffMs = options.initialBackoffMs * (2 ** (attempt - 1));
      await options.sleeper(backoffMs);
    }
  }

  return {
    channel: options.channel,
    alertCode: options.alert.code,
    attempts: options.maxAttempts,
    status: 'failed',
    error: lastError,
  };
}

function normalizeSeverity(
  severity: AlertSeverity | undefined,
  fieldName: string,
): AlertSeverity {
  const normalized = severity ?? 'info';
  if (normalized !== 'info' && normalized !== 'warning' && normalized !== 'critical') {
    throw new TypeError(`${fieldName} must be "info", "warning", or "critical".`);
  }
  return normalized;
}

function normalizeTemplate(template: string | undefined, fieldName: string): string {
  const normalizedTemplate = template?.trim()
    || '[{severity}] {code}: {message} | metadata={metadata}';
  assertNonEmptyString(normalizedTemplate, `${fieldName}.template`);
  return normalizedTemplate;
}

function isSeverityAllowed(
  alertSeverity: AlertSeverity,
  minSeverity: AlertSeverity,
): boolean {
  return getSeverityRank(alertSeverity) >= getSeverityRank(minSeverity);
}

function getSeverityRank(severity: AlertSeverity): number {
  if (severity === 'info') {
    return 1;
  }
  if (severity === 'warning') {
    return 2;
  }
  return 3;
}

function renderAlertTemplate(template: string, alert: DispatchableAlert): string {
  const metadataText = JSON.stringify(alert.metadata);
  return template
    .replaceAll('{code}', alert.code)
    .replaceAll('{severity}', alert.severity)
    .replaceAll('{message}', alert.message)
    .replaceAll('{metadata}', metadataText);
}
