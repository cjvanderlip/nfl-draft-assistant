import { describe, expect, it } from 'vitest';

import { readAppConfig } from './env.js';

describe('readAppConfig', () => {
  it('uses the 15-second polling default without provider credentials', () => {
    expect(readAppConfig({})).toEqual({
      cbsBaseUrl: undefined,
      cbsAccessToken: undefined,
      pollingIntervalSeconds: 15,
      snapshotRetentionEnabled: true,
      snapshotRetentionIntervalSeconds: 900,
      snapshotRetentionKeepLatest: 100,
      alertErrorRateThreshold: 0.2,
      alertMinEventVolume: 20,
      alertDispatchEnabled: true,
      alertDispatchCooldownSeconds: 300,
      alertWebhookUrl: undefined,
      alertWebhookMaxAttempts: 3,
      alertWebhookInitialBackoffMs: 250,
      alertWebhookMinSeverity: 'info',
      alertWebhookTemplate: '[{severity}] {code}: {message} | metadata={metadata}',
      alertSlackEnabled: false,
      alertSlackWebhookUrl: undefined,
      alertSlackMaxAttempts: 3,
      alertSlackInitialBackoffMs: 250,
      alertSlackMinSeverity: 'warning',
      alertSlackTemplate: ':rotating_light: [{severity}] {code} - {message}',
      alertEmailEnabled: false,
      alertEmailWebhookUrl: undefined,
      alertEmailMaxAttempts: 3,
      alertEmailInitialBackoffMs: 250,
      alertEmailMinSeverity: 'critical',
      alertEmailTemplate: '[{severity}] {code}\n\n{message}\n\nmetadata={metadata}',
      alertEscalationFailureThreshold: 3,
      alertMaxSilenceSeconds: 86400,
      alertIdempotencyEnabled: true,
      alertIdempotencyTtlSeconds: 900,
      alertRateLimitEnabled: true,
      alertRateLimitWindowSeconds: 60,
      alertRateLimitMaxRequests: 30,
    });
  });

  it('requires both CBS configuration values', () => {
    expect(() => readAppConfig({ CBS_BASE_URL: 'https://cbs.example.test' }))
      .toThrow('CBS_ACCESS_TOKEN is required');
  });

  it('rejects polling intervals outside the supported range', () => {
    expect(() => readAppConfig({ POLLING_INTERVAL_SECONDS: '2' }))
      .toThrow('POLLING_INTERVAL_SECONDS');
  });

  it('parses snapshot retention settings and validates limits', () => {
    expect(readAppConfig({
      SNAPSHOT_RETENTION_ENABLED: 'false',
      SNAPSHOT_RETENTION_INTERVAL_SECONDS: '120',
      SNAPSHOT_RETENTION_KEEP_LATEST: '15',
    })).toMatchObject({
      snapshotRetentionEnabled: false,
      snapshotRetentionIntervalSeconds: 120,
      snapshotRetentionKeepLatest: 15,
    });

    expect(() => readAppConfig({ SNAPSHOT_RETENTION_KEEP_LATEST: '2000' }))
      .toThrow('SNAPSHOT_RETENTION_KEEP_LATEST');
  });

  it('parses alert threshold settings and validates ranges', () => {
    expect(readAppConfig({
      ALERT_ERROR_RATE_THRESHOLD: '0.35',
      ALERT_MIN_EVENT_VOLUME: '5',
      ALERT_DISPATCH_ENABLED: 'false',
      ALERT_DISPATCH_COOLDOWN_SECONDS: '45',
      ALERT_WEBHOOK_URL: 'https://alerts.example.test/webhook',
      ALERT_WEBHOOK_MAX_ATTEMPTS: '4',
      ALERT_WEBHOOK_INITIAL_BACKOFF_MS: '120',
      ALERT_WEBHOOK_MIN_SEVERITY: 'warning',
      ALERT_WEBHOOK_TEMPLATE: '[{severity}] {code} => {message}',
      ALERT_SLACK_ENABLED: 'true',
      ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/alerts',
      ALERT_SLACK_MAX_ATTEMPTS: '5',
      ALERT_SLACK_INITIAL_BACKOFF_MS: '150',
      ALERT_SLACK_MIN_SEVERITY: 'critical',
      ALERT_SLACK_TEMPLATE: 'SLACK {code}: {message}',
      ALERT_EMAIL_ENABLED: 'true',
      ALERT_EMAIL_WEBHOOK_URL: 'https://email-gateway.example.test/send',
      ALERT_EMAIL_MAX_ATTEMPTS: '6',
      ALERT_EMAIL_INITIAL_BACKOFF_MS: '200',
      ALERT_EMAIL_MIN_SEVERITY: 'warning',
      ALERT_EMAIL_TEMPLATE: 'EMAIL {severity}: {message}',
      ALERT_ESCALATION_FAILURE_THRESHOLD: '4',
      ALERT_MAX_SILENCE_SECONDS: '7200',
      ALERT_IDEMPOTENCY_ENABLED: 'false',
      ALERT_IDEMPOTENCY_TTL_SECONDS: '120',
      ALERT_RATE_LIMIT_ENABLED: 'false',
      ALERT_RATE_LIMIT_WINDOW_SECONDS: '30',
      ALERT_RATE_LIMIT_MAX_REQUESTS: '10',
    })).toMatchObject({
      alertErrorRateThreshold: 0.35,
      alertMinEventVolume: 5,
      alertDispatchEnabled: false,
      alertDispatchCooldownSeconds: 45,
      alertWebhookUrl: 'https://alerts.example.test/webhook',
      alertWebhookMaxAttempts: 4,
      alertWebhookInitialBackoffMs: 120,
      alertWebhookMinSeverity: 'warning',
      alertWebhookTemplate: '[{severity}] {code} => {message}',
      alertSlackEnabled: true,
      alertSlackWebhookUrl: 'https://hooks.slack.test/alerts',
      alertSlackMaxAttempts: 5,
      alertSlackInitialBackoffMs: 150,
      alertSlackMinSeverity: 'critical',
      alertSlackTemplate: 'SLACK {code}: {message}',
      alertEmailEnabled: true,
      alertEmailWebhookUrl: 'https://email-gateway.example.test/send',
      alertEmailMaxAttempts: 6,
      alertEmailInitialBackoffMs: 200,
      alertEmailMinSeverity: 'warning',
      alertEmailTemplate: 'EMAIL {severity}: {message}',
      alertEscalationFailureThreshold: 4,
      alertMaxSilenceSeconds: 7200,
      alertIdempotencyEnabled: false,
      alertIdempotencyTtlSeconds: 120,
      alertRateLimitEnabled: false,
      alertRateLimitWindowSeconds: 30,
      alertRateLimitMaxRequests: 10,
    });

    expect(() => readAppConfig({ ALERT_ERROR_RATE_THRESHOLD: '2' }))
      .toThrow('ALERT_ERROR_RATE_THRESHOLD');
    expect(() => readAppConfig({ ALERT_DISPATCH_COOLDOWN_SECONDS: '0' }))
      .toThrow('ALERT_DISPATCH_COOLDOWN_SECONDS');
    expect(() => readAppConfig({ ALERT_WEBHOOK_MAX_ATTEMPTS: '0' }))
      .toThrow('ALERT_WEBHOOK_MAX_ATTEMPTS');
    expect(() => readAppConfig({ ALERT_WEBHOOK_URL: 'not-a-url' }))
      .toThrow('ALERT_WEBHOOK_URL');
    expect(() => readAppConfig({ ALERT_SLACK_WEBHOOK_URL: 'bad-url' }))
      .toThrow('ALERT_SLACK_WEBHOOK_URL');
    expect(() => readAppConfig({ ALERT_EMAIL_WEBHOOK_URL: 'bad-url' }))
      .toThrow('ALERT_EMAIL_WEBHOOK_URL');
    expect(() => readAppConfig({ ALERT_EMAIL_MIN_SEVERITY: 'fatal' }))
      .toThrow('ALERT_EMAIL_MIN_SEVERITY');
    expect(() => readAppConfig({ ALERT_ESCALATION_FAILURE_THRESHOLD: '0' }))
      .toThrow('ALERT_ESCALATION_FAILURE_THRESHOLD');
    expect(() => readAppConfig({ ALERT_IDEMPOTENCY_TTL_SECONDS: '0' }))
      .toThrow('ALERT_IDEMPOTENCY_TTL_SECONDS');
    expect(() => readAppConfig({ ALERT_RATE_LIMIT_MAX_REQUESTS: '0' }))
      .toThrow('ALERT_RATE_LIMIT_MAX_REQUESTS');
  });
});
