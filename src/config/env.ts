import {
  assertNonEmptyString,
  assertNumberInRange,
} from '../../validators.js';
import {
  DEFAULT_ALERT_ERROR_RATE_THRESHOLD,
  DEFAULT_ALERT_DISPATCH_COOLDOWN_SECONDS,
  DEFAULT_ALERT_DISPATCH_ENABLED,
  DEFAULT_ALERT_EMAIL_ENABLED,
  DEFAULT_ALERT_ESCALATION_FAILURE_THRESHOLD,
  DEFAULT_ALERT_IDEMPOTENCY_ENABLED,
  DEFAULT_ALERT_IDEMPOTENCY_TTL_SECONDS,
  DEFAULT_ALERT_EMAIL_INITIAL_BACKOFF_MS,
  DEFAULT_ALERT_EMAIL_MIN_SEVERITY,
  DEFAULT_ALERT_EMAIL_TEMPLATE,
  DEFAULT_ALERT_EMAIL_MAX_ATTEMPTS,
  DEFAULT_ALERT_MAX_SILENCE_SECONDS,
  DEFAULT_ALERT_RATE_LIMIT_ENABLED,
  DEFAULT_ALERT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_ALERT_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_ALERT_SLACK_ENABLED,
  DEFAULT_ALERT_SLACK_INITIAL_BACKOFF_MS,
  DEFAULT_ALERT_SLACK_MIN_SEVERITY,
  DEFAULT_ALERT_SLACK_TEMPLATE,
  DEFAULT_ALERT_SLACK_MAX_ATTEMPTS,
  DEFAULT_ALERT_WEBHOOK_INITIAL_BACKOFF_MS,
  DEFAULT_ALERT_WEBHOOK_MIN_SEVERITY,
  DEFAULT_ALERT_WEBHOOK_TEMPLATE,
  DEFAULT_ALERT_WEBHOOK_MAX_ATTEMPTS,
  DEFAULT_ALERT_MIN_EVENT_VOLUME,
  DEFAULT_SNAPSHOT_RETENTION_ENABLED,
  DEFAULT_SNAPSHOT_RETENTION_INTERVAL_SECONDS,
  DEFAULT_SNAPSHOT_RETENTION_KEEP_LATEST,
  DEFAULT_POLLING_INTERVAL_SECONDS,
  MAX_ALERT_MIN_EVENT_VOLUME,
  MAX_ALERT_DISPATCH_COOLDOWN_SECONDS,
  MAX_ALERT_EMAIL_INITIAL_BACKOFF_MS,
  MAX_ALERT_EMAIL_MAX_ATTEMPTS,
  MAX_ALERT_ESCALATION_FAILURE_THRESHOLD,
  MAX_ALERT_IDEMPOTENCY_TTL_SECONDS,
  MAX_ALERT_MAX_SILENCE_SECONDS,
  MAX_ALERT_RATE_LIMIT_MAX_REQUESTS,
  MAX_ALERT_RATE_LIMIT_WINDOW_SECONDS,
  MAX_ALERT_SLACK_INITIAL_BACKOFF_MS,
  MAX_ALERT_SLACK_MAX_ATTEMPTS,
  MAX_ALERT_WEBHOOK_INITIAL_BACKOFF_MS,
  MAX_ALERT_WEBHOOK_MAX_ATTEMPTS,
  MAX_SNAPSHOT_RETENTION_INTERVAL_SECONDS,
  MAX_SNAPSHOT_RETENTION_KEEP_LATEST,
  MAX_POLLING_INTERVAL_SECONDS,
  MIN_SNAPSHOT_RETENTION_INTERVAL_SECONDS,
  MIN_POLLING_INTERVAL_SECONDS,
} from './defaults.js';

type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AppConfig {
  cbsBaseUrl?: string;
  cbsAccessToken?: string;
  pollingIntervalSeconds: number;
  snapshotRetentionEnabled: boolean;
  snapshotRetentionIntervalSeconds: number;
  snapshotRetentionKeepLatest: number;
  alertErrorRateThreshold: number;
  alertMinEventVolume: number;
  alertDispatchEnabled: boolean;
  alertDispatchCooldownSeconds: number;
  alertWebhookUrl?: string;
  alertWebhookMaxAttempts: number;
  alertWebhookInitialBackoffMs: number;
  alertWebhookMinSeverity: AlertSeverity;
  alertWebhookTemplate: string;
  alertSlackEnabled: boolean;
  alertSlackWebhookUrl?: string;
  alertSlackMaxAttempts: number;
  alertSlackInitialBackoffMs: number;
  alertSlackMinSeverity: AlertSeverity;
  alertSlackTemplate: string;
  alertEmailEnabled: boolean;
  alertEmailWebhookUrl?: string;
  alertEmailMaxAttempts: number;
  alertEmailInitialBackoffMs: number;
  alertEmailMinSeverity: AlertSeverity;
  alertEmailTemplate: string;
  alertEscalationFailureThreshold: number;
  alertMaxSilenceSeconds: number;
  alertIdempotencyEnabled: boolean;
  alertIdempotencyTtlSeconds: number;
  alertRateLimitEnabled: boolean;
  alertRateLimitWindowSeconds: number;
  alertRateLimitMaxRequests: number;
}

/**
 * Read and validate application configuration from environment variables.
 *
 * @param environment - Environment values to parse.
 * @returns Validated application configuration.
 */
export function readAppConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const cbsBaseUrl = environment.CBS_BASE_URL?.trim() || undefined;
  const cbsAccessToken = environment.CBS_ACCESS_TOKEN?.trim() || undefined;
  if (cbsBaseUrl !== undefined && cbsAccessToken === undefined) {
    throw new Error('CBS_ACCESS_TOKEN is required when CBS_BASE_URL is configured.');
  }
  if (cbsAccessToken !== undefined && cbsBaseUrl === undefined) {
    throw new Error('CBS_BASE_URL is required when CBS_ACCESS_TOKEN is configured.');
  }
  if (cbsBaseUrl !== undefined) {
    assertNonEmptyString(cbsBaseUrl, 'CBS_BASE_URL');
  }
  if (cbsAccessToken !== undefined) {
    assertNonEmptyString(cbsAccessToken, 'CBS_ACCESS_TOKEN');
  }

  const configuredInterval = environment.POLLING_INTERVAL_SECONDS;
  const pollingIntervalSeconds = configuredInterval === undefined
    ? DEFAULT_POLLING_INTERVAL_SECONDS
    : Number(configuredInterval);
  assertNumberInRange(
    pollingIntervalSeconds,
    'POLLING_INTERVAL_SECONDS',
    MIN_POLLING_INTERVAL_SECONDS,
    MAX_POLLING_INTERVAL_SECONDS,
  );

  const snapshotRetentionEnabled = environment.SNAPSHOT_RETENTION_ENABLED === undefined
    ? DEFAULT_SNAPSHOT_RETENTION_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.SNAPSHOT_RETENTION_ENABLED.trim().toLowerCase());
  const configuredRetentionInterval = environment.SNAPSHOT_RETENTION_INTERVAL_SECONDS;
  const snapshotRetentionIntervalSeconds = configuredRetentionInterval === undefined
    ? DEFAULT_SNAPSHOT_RETENTION_INTERVAL_SECONDS
    : Number(configuredRetentionInterval);
  assertNumberInRange(
    snapshotRetentionIntervalSeconds,
    'SNAPSHOT_RETENTION_INTERVAL_SECONDS',
    MIN_SNAPSHOT_RETENTION_INTERVAL_SECONDS,
    MAX_SNAPSHOT_RETENTION_INTERVAL_SECONDS,
  );
  const configuredRetentionKeepLatest = environment.SNAPSHOT_RETENTION_KEEP_LATEST;
  const snapshotRetentionKeepLatest = configuredRetentionKeepLatest === undefined
    ? DEFAULT_SNAPSHOT_RETENTION_KEEP_LATEST
    : Number(configuredRetentionKeepLatest);
  assertNumberInRange(
    snapshotRetentionKeepLatest,
    'SNAPSHOT_RETENTION_KEEP_LATEST',
    0,
    MAX_SNAPSHOT_RETENTION_KEEP_LATEST,
  );

  const configuredAlertErrorRateThreshold = environment.ALERT_ERROR_RATE_THRESHOLD;
  const alertErrorRateThreshold = configuredAlertErrorRateThreshold === undefined
    ? DEFAULT_ALERT_ERROR_RATE_THRESHOLD
    : Number(configuredAlertErrorRateThreshold);
  assertNumberInRange(
    alertErrorRateThreshold,
    'ALERT_ERROR_RATE_THRESHOLD',
    0,
    1,
  );
  const configuredAlertMinEventVolume = environment.ALERT_MIN_EVENT_VOLUME;
  const alertMinEventVolume = configuredAlertMinEventVolume === undefined
    ? DEFAULT_ALERT_MIN_EVENT_VOLUME
    : Number(configuredAlertMinEventVolume);
  assertNumberInRange(
    alertMinEventVolume,
    'ALERT_MIN_EVENT_VOLUME',
    1,
    MAX_ALERT_MIN_EVENT_VOLUME,
  );
  const alertDispatchEnabled = environment.ALERT_DISPATCH_ENABLED === undefined
    ? DEFAULT_ALERT_DISPATCH_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.ALERT_DISPATCH_ENABLED.trim().toLowerCase());
  const configuredAlertDispatchCooldownSeconds = environment.ALERT_DISPATCH_COOLDOWN_SECONDS;
  const alertDispatchCooldownSeconds = configuredAlertDispatchCooldownSeconds === undefined
    ? DEFAULT_ALERT_DISPATCH_COOLDOWN_SECONDS
    : Number(configuredAlertDispatchCooldownSeconds);
  assertNumberInRange(
    alertDispatchCooldownSeconds,
    'ALERT_DISPATCH_COOLDOWN_SECONDS',
    1,
    MAX_ALERT_DISPATCH_COOLDOWN_SECONDS,
  );
  const alertWebhookUrl = environment.ALERT_WEBHOOK_URL?.trim() || undefined;
  if (alertWebhookUrl !== undefined) {
    try {
      new URL(alertWebhookUrl);
    } catch {
      throw new TypeError('ALERT_WEBHOOK_URL must be a valid URL.');
    }
  }
  const configuredAlertWebhookMaxAttempts = environment.ALERT_WEBHOOK_MAX_ATTEMPTS;
  const alertWebhookMaxAttempts = configuredAlertWebhookMaxAttempts === undefined
    ? DEFAULT_ALERT_WEBHOOK_MAX_ATTEMPTS
    : Number(configuredAlertWebhookMaxAttempts);
  assertNumberInRange(
    alertWebhookMaxAttempts,
    'ALERT_WEBHOOK_MAX_ATTEMPTS',
    1,
    MAX_ALERT_WEBHOOK_MAX_ATTEMPTS,
  );
  const configuredAlertWebhookInitialBackoffMs = environment.ALERT_WEBHOOK_INITIAL_BACKOFF_MS;
  const alertWebhookInitialBackoffMs = configuredAlertWebhookInitialBackoffMs === undefined
    ? DEFAULT_ALERT_WEBHOOK_INITIAL_BACKOFF_MS
    : Number(configuredAlertWebhookInitialBackoffMs);
  assertNumberInRange(
    alertWebhookInitialBackoffMs,
    'ALERT_WEBHOOK_INITIAL_BACKOFF_MS',
    1,
    MAX_ALERT_WEBHOOK_INITIAL_BACKOFF_MS,
  );
  const alertWebhookMinSeverity = parseAlertSeverity(
    environment.ALERT_WEBHOOK_MIN_SEVERITY,
    'ALERT_WEBHOOK_MIN_SEVERITY',
    DEFAULT_ALERT_WEBHOOK_MIN_SEVERITY,
  );
  const alertWebhookTemplate = parseRequiredTemplate(
    environment.ALERT_WEBHOOK_TEMPLATE,
    'ALERT_WEBHOOK_TEMPLATE',
    DEFAULT_ALERT_WEBHOOK_TEMPLATE,
  );
  const alertSlackEnabled = environment.ALERT_SLACK_ENABLED === undefined
    ? DEFAULT_ALERT_SLACK_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.ALERT_SLACK_ENABLED.trim().toLowerCase());
  const alertSlackWebhookUrl = environment.ALERT_SLACK_WEBHOOK_URL?.trim() || undefined;
  if (alertSlackWebhookUrl !== undefined) {
    try {
      new URL(alertSlackWebhookUrl);
    } catch {
      throw new TypeError('ALERT_SLACK_WEBHOOK_URL must be a valid URL.');
    }
  }
  const configuredAlertSlackMaxAttempts = environment.ALERT_SLACK_MAX_ATTEMPTS;
  const alertSlackMaxAttempts = configuredAlertSlackMaxAttempts === undefined
    ? DEFAULT_ALERT_SLACK_MAX_ATTEMPTS
    : Number(configuredAlertSlackMaxAttempts);
  assertNumberInRange(
    alertSlackMaxAttempts,
    'ALERT_SLACK_MAX_ATTEMPTS',
    1,
    MAX_ALERT_SLACK_MAX_ATTEMPTS,
  );
  const configuredAlertSlackInitialBackoffMs = environment.ALERT_SLACK_INITIAL_BACKOFF_MS;
  const alertSlackInitialBackoffMs = configuredAlertSlackInitialBackoffMs === undefined
    ? DEFAULT_ALERT_SLACK_INITIAL_BACKOFF_MS
    : Number(configuredAlertSlackInitialBackoffMs);
  assertNumberInRange(
    alertSlackInitialBackoffMs,
    'ALERT_SLACK_INITIAL_BACKOFF_MS',
    1,
    MAX_ALERT_SLACK_INITIAL_BACKOFF_MS,
  );
  const alertSlackMinSeverity = parseAlertSeverity(
    environment.ALERT_SLACK_MIN_SEVERITY,
    'ALERT_SLACK_MIN_SEVERITY',
    DEFAULT_ALERT_SLACK_MIN_SEVERITY,
  );
  const alertSlackTemplate = parseRequiredTemplate(
    environment.ALERT_SLACK_TEMPLATE,
    'ALERT_SLACK_TEMPLATE',
    DEFAULT_ALERT_SLACK_TEMPLATE,
  );

  const alertEmailEnabled = environment.ALERT_EMAIL_ENABLED === undefined
    ? DEFAULT_ALERT_EMAIL_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.ALERT_EMAIL_ENABLED.trim().toLowerCase());
  const alertEmailWebhookUrl = environment.ALERT_EMAIL_WEBHOOK_URL?.trim() || undefined;
  if (alertEmailWebhookUrl !== undefined) {
    try {
      new URL(alertEmailWebhookUrl);
    } catch {
      throw new TypeError('ALERT_EMAIL_WEBHOOK_URL must be a valid URL.');
    }
  }
  const configuredAlertEmailMaxAttempts = environment.ALERT_EMAIL_MAX_ATTEMPTS;
  const alertEmailMaxAttempts = configuredAlertEmailMaxAttempts === undefined
    ? DEFAULT_ALERT_EMAIL_MAX_ATTEMPTS
    : Number(configuredAlertEmailMaxAttempts);
  assertNumberInRange(
    alertEmailMaxAttempts,
    'ALERT_EMAIL_MAX_ATTEMPTS',
    1,
    MAX_ALERT_EMAIL_MAX_ATTEMPTS,
  );
  const configuredAlertEmailInitialBackoffMs = environment.ALERT_EMAIL_INITIAL_BACKOFF_MS;
  const alertEmailInitialBackoffMs = configuredAlertEmailInitialBackoffMs === undefined
    ? DEFAULT_ALERT_EMAIL_INITIAL_BACKOFF_MS
    : Number(configuredAlertEmailInitialBackoffMs);
  assertNumberInRange(
    alertEmailInitialBackoffMs,
    'ALERT_EMAIL_INITIAL_BACKOFF_MS',
    1,
    MAX_ALERT_EMAIL_INITIAL_BACKOFF_MS,
  );
  const alertEmailMinSeverity = parseAlertSeverity(
    environment.ALERT_EMAIL_MIN_SEVERITY,
    'ALERT_EMAIL_MIN_SEVERITY',
    DEFAULT_ALERT_EMAIL_MIN_SEVERITY,
  );
  const alertEmailTemplate = parseRequiredTemplate(
    environment.ALERT_EMAIL_TEMPLATE,
    'ALERT_EMAIL_TEMPLATE',
    DEFAULT_ALERT_EMAIL_TEMPLATE,
  );
  const configuredAlertEscalationFailureThreshold = environment.ALERT_ESCALATION_FAILURE_THRESHOLD;
  const alertEscalationFailureThreshold = configuredAlertEscalationFailureThreshold === undefined
    ? DEFAULT_ALERT_ESCALATION_FAILURE_THRESHOLD
    : Number(configuredAlertEscalationFailureThreshold);
  assertNumberInRange(
    alertEscalationFailureThreshold,
    'ALERT_ESCALATION_FAILURE_THRESHOLD',
    1,
    MAX_ALERT_ESCALATION_FAILURE_THRESHOLD,
  );
  const configuredAlertMaxSilenceSeconds = environment.ALERT_MAX_SILENCE_SECONDS;
  const alertMaxSilenceSeconds = configuredAlertMaxSilenceSeconds === undefined
    ? DEFAULT_ALERT_MAX_SILENCE_SECONDS
    : Number(configuredAlertMaxSilenceSeconds);
  assertNumberInRange(
    alertMaxSilenceSeconds,
    'ALERT_MAX_SILENCE_SECONDS',
    1,
    MAX_ALERT_MAX_SILENCE_SECONDS,
  );
  const alertIdempotencyEnabled = environment.ALERT_IDEMPOTENCY_ENABLED === undefined
    ? DEFAULT_ALERT_IDEMPOTENCY_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.ALERT_IDEMPOTENCY_ENABLED.trim().toLowerCase());
  const configuredAlertIdempotencyTtlSeconds = environment.ALERT_IDEMPOTENCY_TTL_SECONDS;
  const alertIdempotencyTtlSeconds = configuredAlertIdempotencyTtlSeconds === undefined
    ? DEFAULT_ALERT_IDEMPOTENCY_TTL_SECONDS
    : Number(configuredAlertIdempotencyTtlSeconds);
  assertNumberInRange(
    alertIdempotencyTtlSeconds,
    'ALERT_IDEMPOTENCY_TTL_SECONDS',
    1,
    MAX_ALERT_IDEMPOTENCY_TTL_SECONDS,
  );
  const alertRateLimitEnabled = environment.ALERT_RATE_LIMIT_ENABLED === undefined
    ? DEFAULT_ALERT_RATE_LIMIT_ENABLED
    : ['true', '1', 'yes', 'on'].includes(environment.ALERT_RATE_LIMIT_ENABLED.trim().toLowerCase());
  const configuredAlertRateLimitWindowSeconds = environment.ALERT_RATE_LIMIT_WINDOW_SECONDS;
  const alertRateLimitWindowSeconds = configuredAlertRateLimitWindowSeconds === undefined
    ? DEFAULT_ALERT_RATE_LIMIT_WINDOW_SECONDS
    : Number(configuredAlertRateLimitWindowSeconds);
  assertNumberInRange(
    alertRateLimitWindowSeconds,
    'ALERT_RATE_LIMIT_WINDOW_SECONDS',
    1,
    MAX_ALERT_RATE_LIMIT_WINDOW_SECONDS,
  );
  const configuredAlertRateLimitMaxRequests = environment.ALERT_RATE_LIMIT_MAX_REQUESTS;
  const alertRateLimitMaxRequests = configuredAlertRateLimitMaxRequests === undefined
    ? DEFAULT_ALERT_RATE_LIMIT_MAX_REQUESTS
    : Number(configuredAlertRateLimitMaxRequests);
  assertNumberInRange(
    alertRateLimitMaxRequests,
    'ALERT_RATE_LIMIT_MAX_REQUESTS',
    1,
    MAX_ALERT_RATE_LIMIT_MAX_REQUESTS,
  );

  return {
    cbsBaseUrl,
    cbsAccessToken,
    pollingIntervalSeconds,
    snapshotRetentionEnabled,
    snapshotRetentionIntervalSeconds,
    snapshotRetentionKeepLatest,
    alertErrorRateThreshold,
    alertMinEventVolume,
    alertDispatchEnabled,
    alertDispatchCooldownSeconds,
    alertWebhookUrl,
    alertWebhookMaxAttempts,
    alertWebhookInitialBackoffMs,
    alertWebhookMinSeverity,
    alertWebhookTemplate,
    alertSlackEnabled,
    alertSlackWebhookUrl,
    alertSlackMaxAttempts,
    alertSlackInitialBackoffMs,
    alertSlackMinSeverity,
    alertSlackTemplate,
    alertEmailEnabled,
    alertEmailWebhookUrl,
    alertEmailMaxAttempts,
    alertEmailInitialBackoffMs,
    alertEmailMinSeverity,
    alertEmailTemplate,
    alertEscalationFailureThreshold,
    alertMaxSilenceSeconds,
    alertIdempotencyEnabled,
    alertIdempotencyTtlSeconds,
    alertRateLimitEnabled,
    alertRateLimitWindowSeconds,
    alertRateLimitMaxRequests,
  };
}

function parseAlertSeverity(
  value: string | undefined,
  fieldName: string,
  defaultValue: string,
): AlertSeverity {
  const normalized = value?.trim().toLowerCase() ?? defaultValue;
  if (normalized !== 'info' && normalized !== 'warning' && normalized !== 'critical') {
    throw new TypeError(`${fieldName} must be one of: info, warning, critical.`);
  }
  return normalized;
}

function parseRequiredTemplate(
  value: string | undefined,
  fieldName: string,
  defaultValue: string,
): string {
  const template = value === undefined ? defaultValue : value.trim();
  assertNonEmptyString(template, fieldName);
  return template;
}
