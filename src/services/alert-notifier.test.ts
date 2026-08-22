import { describe, expect, it, vi } from 'vitest';

import { createMultiChannelAlertNotifier, createWebhookAlertNotifier } from './alert-notifier.js';

describe('createWebhookAlertNotifier', () => {
  it('rejects invalid webhook URLs', () => {
    expect(() => createWebhookAlertNotifier({ webhookUrl: 'bad-url' }))
      .toThrow('options.webhook.webhookUrl');
  });

  it('retries failed deliveries and succeeds before max attempts', async () => {
    const sender = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    const sleeper = vi.fn().mockResolvedValue(undefined);

    const notifier = createWebhookAlertNotifier({
      webhookUrl: 'https://alerts.example.test/webhook',
      maxAttempts: 3,
      initialBackoffMs: 10,
      sender,
      sleeper,
    });

    const result = await notifier.notifyAlerts([{
      code: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'Error rate exceeded threshold.',
      metadata: { errorRate: 0.6 },
    }]);

    expect(result).toMatchObject({
      sentCount: 1,
      failedCount: 0,
      deliveries: [{ alertCode: 'HIGH_ERROR_RATE', attempts: 2, status: 'sent', error: null }],
    });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledWith(10);
  });

  it('reports failures after exhausting retries', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const sleeper = vi.fn().mockResolvedValue(undefined);

    const notifier = createWebhookAlertNotifier({
      webhookUrl: 'https://alerts.example.test/webhook',
      maxAttempts: 2,
      initialBackoffMs: 5,
      sender,
      sleeper,
    });

    const result = await notifier.notifyAlerts([{
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: 'warning',
      message: 'Internal errors detected.',
      metadata: { internalErrors: 2 },
    }]);

    expect(result).toMatchObject({
      sentCount: 0,
      failedCount: 1,
      deliveries: [{
        alertCode: 'INTERNAL_REQUEST_ERRORS',
        attempts: 2,
        status: 'failed',
      }],
    });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledTimes(1);
  });
});

describe('createMultiChannelAlertNotifier', () => {
  it('fans out alerts across configured channels', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const notifier = createMultiChannelAlertNotifier({
      webhook: { enabled: true, webhookUrl: 'https://hooks.example.test/webhook' },
      slack: { enabled: true, webhookUrl: 'https://hooks.example.test/slack' },
      email: { enabled: true, webhookUrl: 'https://hooks.example.test/email' },
      sender,
      sleeper: vi.fn().mockResolvedValue(undefined),
    });

    const result = await notifier.notifyAlerts([{
      code: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'Error rate exceeded threshold.',
      metadata: { errorRate: 0.7 },
    }]);

    expect(result).toMatchObject({
      sentCount: 3,
      failedCount: 0,
      deliveries: [
        { channel: 'webhook', alertCode: 'HIGH_ERROR_RATE', status: 'sent' },
        { channel: 'slack', alertCode: 'HIGH_ERROR_RATE', status: 'sent' },
        { channel: 'email', alertCode: 'HIGH_ERROR_RATE', status: 'sent' },
      ],
    });
    expect(sender).toHaveBeenCalledTimes(3);
  });

  it('respects per-channel enablement policies', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const notifier = createMultiChannelAlertNotifier({
      webhook: { enabled: true, webhookUrl: 'https://hooks.example.test/webhook' },
      slack: { enabled: false, webhookUrl: 'https://hooks.example.test/slack' },
      email: { enabled: false, webhookUrl: 'https://hooks.example.test/email' },
      sender,
      sleeper: vi.fn().mockResolvedValue(undefined),
    });

    const result = await notifier.notifyAlerts([{
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: 'warning',
      message: 'Internal errors detected.',
      metadata: { internalErrors: 2 },
    }]);

    expect(result).toMatchObject({
      sentCount: 1,
      failedCount: 0,
      deliveries: [{ channel: 'webhook', status: 'sent' }],
    });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('routes by severity thresholds per channel', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const notifier = createMultiChannelAlertNotifier({
      webhook: {
        enabled: true,
        webhookUrl: 'https://hooks.example.test/webhook',
        minSeverity: 'warning',
      },
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.example.test/slack',
        minSeverity: 'critical',
      },
      email: {
        enabled: true,
        webhookUrl: 'https://hooks.example.test/email',
        minSeverity: 'critical',
      },
      sender,
      sleeper: vi.fn().mockResolvedValue(undefined),
    });

    const result = await notifier.notifyAlerts([{
      code: 'HIGH_ERROR_RATE',
      severity: 'warning',
      message: 'Error rate exceeded threshold.',
      metadata: { errorRate: 0.7 },
    }]);

    expect(result).toMatchObject({
      sentCount: 1,
      failedCount: 0,
      deliveries: [{ channel: 'webhook', alertCode: 'HIGH_ERROR_RATE', status: 'sent' }],
    });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('applies channel templates to rendered payload messages', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const notifier = createMultiChannelAlertNotifier({
      webhook: {
        enabled: true,
        webhookUrl: 'https://hooks.example.test/webhook',
        template: 'ALERT {code} ({severity}) -> {message}',
      },
      sender,
      sleeper: vi.fn().mockResolvedValue(undefined),
    });

    await notifier.notifyAlerts([{
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: 'critical',
      message: 'Internal request errors detected.',
      metadata: { internalErrors: 12 },
    }]);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0].body).toContain('ALERT INTERNAL_REQUEST_ERRORS (critical) -> Internal request errors detected.');
  });
});
