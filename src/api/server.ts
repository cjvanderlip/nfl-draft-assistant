import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { buildHealthResponse, type DependencyHealth } from './routes/health.js';
import { getLeagueSnapshot } from './routes/draft.js';
import { runBacktestFromPayload } from './routes/backtest.js';
import { scoreHeuristicsFromPayload } from './routes/heuristics.js';
import { scoreRosterFromPayload } from './routes/roster.js';
import type { DraftRepository } from '../storage/repositories/draft-repository.js';
import type { DependencyHealthTracker } from '../services/dependency-health.js';
import { createRuntimeObservability, type ObservabilityEvent, type RuntimeObservability } from '../services/observability.js';
import { createAlertDispatcher, type AlertDispatcher } from '../services/alert-dispatcher.js';
import { createMultiChannelAlertNotifier, type AlertNotifier } from '../services/alert-notifier.js';
import { createAlertGovernance, type AlertGovernance } from '../services/alert-governance.js';
import { startSnapshotRetentionJob, type SnapshotRetentionController } from '../services/snapshot-retention.js';
import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

export interface ApiServerOptions {
  databaseHealth?: DependencyHealth;
  providerHealth?: DependencyHealth;
  healthTracker?: DependencyHealthTracker;
  repository?: DraftRepository;
  observability?: RuntimeObservability;
  snapshotRetention?: {
    enabled?: boolean;
    intervalSeconds: number;
    keepLatest: number;
    draftSessionId?: string;
    runOnStart?: boolean;
  };
  alerting?: {
    errorRateThreshold?: number;
    minEventVolume?: number;
    dispatchEnabled?: boolean;
    dispatchCooldownSeconds?: number;
    webhookUrl?: string;
    webhookMaxAttempts?: number;
    webhookInitialBackoffMs?: number;
    webhookMinSeverity?: 'info' | 'warning' | 'critical';
    webhookTemplate?: string;
    slackEnabled?: boolean;
    slackWebhookUrl?: string;
    slackMaxAttempts?: number;
    slackInitialBackoffMs?: number;
    slackMinSeverity?: 'info' | 'warning' | 'critical';
    slackTemplate?: string;
    emailEnabled?: boolean;
    emailWebhookUrl?: string;
    emailMaxAttempts?: number;
    emailInitialBackoffMs?: number;
    emailMinSeverity?: 'info' | 'warning' | 'critical';
    emailTemplate?: string;
    escalationFailureThreshold?: number;
    maxSilenceSeconds?: number;
    idempotencyEnabled?: boolean;
    idempotencyTtlSeconds?: number;
    rateLimitEnabled?: boolean;
    rateLimitWindowSeconds?: number;
    rateLimitMaxRequests?: number;
  };
  alertDispatcher?: AlertDispatcher;
  alertNotifier?: AlertNotifier;
  alertGovernance?: AlertGovernance;
  requestHardening?: RequestHardeningState;
}

interface IdempotencyRecord {
  statusCode: number;
  payload: unknown;
  expiresAtMs: number;
}

interface RateLimitWindowState {
  startedAtMs: number;
  requestCount: number;
}

interface RequestHardeningState {
  idempotencyEnabled: boolean;
  idempotencyTtlSeconds: number;
  idempotencyCache: Map<string, IdempotencyRecord>;
  rateLimitEnabled: boolean;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  rateLimitWindows: Map<string, RateLimitWindowState>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..');
const publicDir = join(projectRoot, 'public');

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function getContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

async function serveStaticAsset(pathname: string): Promise<{ statusCode: number; contentType: string; body: Buffer } | null> {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = normalizedPath.replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) {
    return null;
  }

  const candidatePath = normalize(join(publicDir, relativePath));
  if (!candidatePath.startsWith(publicDir)) {
    return null;
  }

  try {
    const body = await readFile(candidatePath);
    return {
      statusCode: 200,
      contentType: getContentType(candidatePath),
      body,
    };
  } catch {
    return null;
  }
}

function isHardeningProtectedRoute(method: string | undefined, pathname: string): boolean {
  if (method !== 'POST') {
    return false;
  }
  return pathname === '/metrics/alerts/dispatch'
    || pathname === '/metrics/alerts/silence'
    || pathname === '/metrics/alerts/acknowledge'
    || pathname === '/snapshots/cleanup';
}

function getClientIdentifier(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

function checkRateLimit(
  request: IncomingMessage,
  pathname: string,
  hardening: RequestHardeningState | undefined,
): { allowed: boolean; retryAfterSeconds?: number } {
  if (!hardening?.rateLimitEnabled || !isHardeningProtectedRoute(request.method, pathname)) {
    return { allowed: true };
  }

  const nowMs = Date.now();
  const key = `${getClientIdentifier(request)}|${pathname}`;
  const existing = hardening.rateLimitWindows.get(key);
  const windowMs = hardening.rateLimitWindowSeconds * 1000;
  if (!existing || nowMs - existing.startedAtMs >= windowMs) {
    hardening.rateLimitWindows.set(key, { startedAtMs: nowMs, requestCount: 1 });
    return { allowed: true };
  }
  if (existing.requestCount >= hardening.rateLimitMaxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (nowMs - existing.startedAtMs)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.requestCount += 1;
  return { allowed: true };
}

function getIdempotencyContext(
  request: IncomingMessage,
  pathname: string,
  hardening: RequestHardeningState | undefined,
): {
  cacheKey: string;
  replay: { statusCode: number; payload: unknown } | null;
} | null {
  if (!hardening?.idempotencyEnabled || !isHardeningProtectedRoute(request.method, pathname)) {
    return null;
  }

  const headerValue = request.headers['idempotency-key'];
  const rawKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (rawKey === undefined) {
    return null;
  }
  assertNonEmptyString(rawKey, 'idempotency-key');
  const idempotencyKey = rawKey.trim();
  if (idempotencyKey.length > 128) {
    throw new TypeError('idempotency-key must be 128 characters or fewer.');
  }

  const nowMs = Date.now();
  const cacheKey = `${request.method}:${pathname}:${idempotencyKey}`;
  const existing = hardening.idempotencyCache.get(cacheKey);
  if (!existing) {
    return { cacheKey, replay: null };
  }
  if (existing.expiresAtMs <= nowMs) {
    hardening.idempotencyCache.delete(cacheKey);
    return { cacheKey, replay: null };
  }
  return {
    cacheKey,
    replay: {
      statusCode: existing.statusCode,
      payload: structuredClone(existing.payload),
    },
  };
}

function cacheIdempotentResponse(
  context: { cacheKey: string; replay: { statusCode: number; payload: unknown } | null } | null,
  statusCode: number,
  payload: unknown,
  hardening: RequestHardeningState | undefined,
): void {
  if (!context || !hardening?.idempotencyEnabled || statusCode >= 500) {
    return;
  }
  hardening.idempotencyCache.set(context.cacheKey, {
    statusCode,
    payload: structuredClone(payload),
    expiresAtMs: Date.now() + hardening.idempotencyTtlSeconds * 1000,
  });
}

function buildOpsRunbookChecks(options: ApiServerOptions): {
  status: 'pass' | 'warn';
  checks: Array<{ id: string; status: 'pass' | 'warn'; message: string }>;
} {
  const checks: Array<{ id: string; status: 'pass' | 'warn'; message: string }> = [];
  const hasRepository = Boolean(options.repository);
  checks.push({
    id: 'persisted-observability',
    status: hasRepository ? 'pass' : 'warn',
    message: hasRepository
      ? 'Persistent repository configured for observability and snapshots.'
      : 'Repository not configured; runtime-only observability is active.',
  });
  const retentionEnabled = options.snapshotRetention?.enabled !== false && options.snapshotRetention !== undefined;
  checks.push({
    id: 'snapshot-retention-job',
    status: retentionEnabled ? 'pass' : 'warn',
    message: retentionEnabled
      ? 'Snapshot retention job is configured.'
      : 'Snapshot retention job is disabled or not configured.',
  });
  const hardening = options.requestHardening;
  checks.push({
    id: 'idempotency-keys',
    status: hardening?.idempotencyEnabled === false ? 'warn' : 'pass',
    message: hardening?.idempotencyEnabled === false
      ? 'Idempotency key replay protection is disabled.'
      : 'Idempotency key replay protection is enabled.',
  });
  checks.push({
    id: 'rate-limits',
    status: hardening?.rateLimitEnabled === false ? 'warn' : 'pass',
    message: hardening?.rateLimitEnabled === false
      ? 'Rate limiting is disabled for protected alert routes.'
      : 'Rate limiting is enabled for protected alert routes.',
  });
  const hasAnyAlertChannel = Boolean(
    options.alerting?.webhookUrl
    || options.alerting?.slackWebhookUrl
    || options.alerting?.emailWebhookUrl,
  );
  checks.push({
    id: 'alert-delivery-channel',
    status: hasAnyAlertChannel ? 'pass' : 'warn',
    message: hasAnyAlertChannel
      ? 'At least one alert delivery channel is configured.'
      : 'No external alert channel configured; dispatch will stay local.',
  });
  return {
    status: checks.some((check) => check.status === 'warn') ? 'warn' : 'pass',
    checks,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (body.length === 0) {
    throw new TypeError('Request body must not be empty.');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TypeError('Request body must be valid JSON.');
  }
}

function getOptionalDraftSessionId(payload: unknown): string | null {
  assertObject(payload, 'payload');
  const body = payload as { draftSessionId?: unknown };
  if (body.draftSessionId === undefined || body.draftSessionId === null) {
    return null;
  }
  assertNonEmptyString(body.draftSessionId, 'draftSessionId');
  return body.draftSessionId.trim();
}

function getSnapshotListOptions(searchParams: URLSearchParams): {
  draftSessionId?: string;
  limit?: number;
  cursor?: string;
} {
  const draftSessionId = searchParams.get('draftSessionId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const limitValue = searchParams.get('limit');
  let limit: number | undefined;
  if (limitValue !== null) {
    const parsedLimit = Number(limitValue);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new TypeError('limit must be an integer between 1 and 100.');
    }
    limit = parsedLimit;
  }

  if (draftSessionId !== undefined) {
    assertNonEmptyString(draftSessionId, 'draftSessionId');
  }
  if (cursor !== undefined) {
    assertNonEmptyString(cursor, 'cursor');
  }

  return {
    draftSessionId,
    limit,
    cursor,
  };
}

function getMetricsEventListOptions(searchParams: URLSearchParams): {
  level?: 'info' | 'error';
  eventName?: string;
  limit?: number;
  cursor?: string;
} {
  const level = searchParams.get('level') ?? undefined;
  if (level !== undefined && level !== 'info' && level !== 'error') {
    throw new TypeError('level must be "info" or "error".');
  }

  const eventName = searchParams.get('eventName') ?? undefined;
  if (eventName !== undefined) {
    assertNonEmptyString(eventName, 'eventName');
  }

  const cursor = searchParams.get('cursor') ?? undefined;
  if (cursor !== undefined) {
    assertNonEmptyString(cursor, 'cursor');
  }

  const limitValue = searchParams.get('limit');
  let limit: number | undefined;
  if (limitValue !== null) {
    const parsedLimit = Number(limitValue);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new TypeError('limit must be an integer between 1 and 100.');
    }
    limit = parsedLimit;
  }

  return {
    level,
    eventName,
    cursor,
    limit,
  };
}

function getMetricsSummaryOptions(searchParams: URLSearchParams): { sinceCreatedAt?: string } {
  const windowSecondsValue = searchParams.get('windowSeconds');
  if (windowSecondsValue === null) {
    return {};
  }
  const windowSeconds = Number(windowSecondsValue);
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
    throw new TypeError('windowSeconds must be an integer between 1 and 86400.');
  }
  return {
    sinceCreatedAt: new Date(Date.now() - windowSeconds * 1000).toISOString(),
  };
}

function summarizeEvents(events: ObservabilityEvent[]): {
  totalEvents: number;
  byLevel: Record<'info' | 'error', number>;
  byEventName: Record<string, number>;
} {
  const byLevel: Record<'info' | 'error', number> = { info: 0, error: 0 };
  const byEventName: Record<string, number> = {};
  for (const event of events) {
    byLevel[event.level] += 1;
    byEventName[event.eventName] = (byEventName[event.eventName] ?? 0) + 1;
  }
  return {
    totalEvents: events.length,
    byLevel,
    byEventName,
  };
}

function buildMetricsAlerts({
  summary,
  runtimeCounters,
  errorRateThreshold,
  minEventVolume,
}: {
  summary: { totalEvents: number; byLevel: Record<'info' | 'error', number>; byEventName: Record<string, number> };
  runtimeCounters: Record<string, number>;
  errorRateThreshold: number;
  minEventVolume: number;
}): Array<{
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
}> {
  const alerts: Array<{
    code: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    metadata: Record<string, unknown>;
  }> = [];

  const errorCount = summary.byLevel.error ?? 0;
  const totalCount = summary.totalEvents;
  const errorRate = totalCount === 0 ? 0 : errorCount / totalCount;
  if (totalCount >= minEventVolume && errorRate >= errorRateThreshold) {
    alerts.push({
      code: 'HIGH_ERROR_RATE',
      severity: errorRate >= Math.min(1, errorRateThreshold * 2) ? 'critical' : 'warning',
      message: `Observed error rate ${errorRate.toFixed(4)} exceeded threshold ${errorRateThreshold.toFixed(4)}.`,
      metadata: {
        totalEvents: totalCount,
        errorCount,
        errorRate: Number(errorRate.toFixed(4)),
        errorRateThreshold,
        minEventVolume,
      },
    });
  }

  const internalErrors = runtimeCounters['api.requests.internal_error'] ?? 0;
  if (internalErrors > 0) {
    alerts.push({
      code: 'INTERNAL_REQUEST_ERRORS',
      severity: internalErrors >= 5 ? 'critical' : 'warning',
      message: `Detected ${internalErrors} internal request errors in runtime counters.`,
      metadata: { internalErrors },
    });
  }

  return alerts;
}

function getObservabilityLevelForAlertSeverity(
  severity: 'info' | 'warning' | 'critical',
): 'info' | 'error' {
  if (severity === 'critical') {
    return 'error';
  }
  return 'info';
}

function getCleanupOptions(payload: unknown): { keepLatest: number; draftSessionId?: string } {
  assertObject(payload, 'payload');
  const body = payload as { keepLatest?: unknown; draftSessionId?: unknown };
  const keepLatest = body.keepLatest ?? 50;
  if (typeof keepLatest !== 'number' || !Number.isInteger(keepLatest) || keepLatest < 0 || keepLatest > 1000) {
    throw new TypeError('keepLatest must be an integer between 0 and 1000.');
  }

  let draftSessionId: string | undefined;
  if (body.draftSessionId !== undefined) {
    assertNonEmptyString(body.draftSessionId, 'draftSessionId');
    draftSessionId = body.draftSessionId.trim();
  }
  return { keepLatest, draftSessionId };
}

function getAlertSilenceOptions(payload: unknown): { code: string; durationSeconds: number } {
  assertObject(payload, 'payload');
  const body = payload as { code?: unknown; durationSeconds?: unknown };
  assertNonEmptyString(body.code, 'code');
  if (typeof body.durationSeconds !== 'number' || !Number.isInteger(body.durationSeconds)) {
    throw new TypeError('durationSeconds must be an integer.');
  }
  return {
    code: body.code.trim(),
    durationSeconds: body.durationSeconds,
  };
}

function getAlertAcknowledgeOptions(payload: unknown): { code: string; note?: string } {
  assertObject(payload, 'payload');
  const body = payload as { code?: unknown; note?: unknown };
  assertNonEmptyString(body.code, 'code');
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw new TypeError('note must be a string when provided.');
  }
  return {
    code: body.code.trim(),
    note: body.note?.trim() || undefined,
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
): Promise<void> {
  const observability = options.observability;
  const parsedUrl = new URL(request.url ?? '/', 'http://localhost');
  const pathname = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;
  const rateLimitResult = checkRateLimit(request, pathname, options.requestHardening);
  if (!rateLimitResult.allowed) {
    writeJson(response, 429, {
      error: 'Rate limit exceeded.',
      retryAfterSeconds: rateLimitResult.retryAfterSeconds,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/metrics') {
    writeJson(response, 200, observability?.getSnapshot() ?? { counters: {}, timings: {}, recentEvents: [] });
    return;
  }

  if (request.method === 'GET' && pathname === '/metrics/summary') {
    try {
      const summaryOptions = getMetricsSummaryOptions(searchParams);
      if (options.repository) {
        const persisted = await options.repository.getObservabilitySummary(summaryOptions);
        writeJson(response, 200, {
          persisted,
          runtime: observability?.getSnapshot() ?? { counters: {}, timings: {}, recentEvents: [] },
        });
      } else {
        const runtimeSnapshot = observability?.getSnapshot() ?? { counters: {}, timings: {}, recentEvents: [] };
        writeJson(response, 200, {
          persisted: summarizeEvents(runtimeSnapshot.recentEvents),
          runtime: runtimeSnapshot,
        });
      }
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/metrics/alerts') {
    try {
      const summaryOptions = getMetricsSummaryOptions(searchParams);
      const runtimeSnapshot = observability?.getSnapshot() ?? { counters: {}, timings: {}, recentEvents: [] };
      const persistedSummary = options.repository
        ? await options.repository.getObservabilitySummary(summaryOptions)
        : summarizeEvents(runtimeSnapshot.recentEvents);
      const errorRateThreshold = options.alerting?.errorRateThreshold ?? 0.2;
      const minEventVolume = options.alerting?.minEventVolume ?? 20;

      writeJson(response, 200, {
        thresholds: {
          errorRateThreshold,
          minEventVolume,
        },
        alerts: buildMetricsAlerts({
          summary: persistedSummary,
          runtimeCounters: runtimeSnapshot.counters,
          errorRateThreshold,
          minEventVolume,
        }),
      });
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/ops/runbook-checks') {
    writeJson(response, 200, buildOpsRunbookChecks(options));
    return;
  }

  if (request.method === 'POST' && pathname === '/metrics/alerts/dispatch') {
    try {
      const idempotencyContext = getIdempotencyContext(request, pathname, options.requestHardening);
      if (idempotencyContext?.replay) {
        writeJson(response, idempotencyContext.replay.statusCode, idempotencyContext.replay.payload);
        return;
      }
      const summaryOptions = getMetricsSummaryOptions(searchParams);
      const runtimeSnapshot = observability?.getSnapshot() ?? { counters: {}, timings: {}, recentEvents: [] };
      const persistedSummary = options.repository
        ? await options.repository.getObservabilitySummary(summaryOptions)
        : summarizeEvents(runtimeSnapshot.recentEvents);
      const errorRateThreshold = options.alerting?.errorRateThreshold ?? 0.2;
      const minEventVolume = options.alerting?.minEventVolume ?? 20;
      const dispatchEnabled = options.alerting?.dispatchEnabled ?? true;
      if (!dispatchEnabled) {
        writeJson(response, 409, { error: 'Alert dispatching is disabled.' });
        return;
      }

      const alerts = buildMetricsAlerts({
        summary: persistedSummary,
        runtimeCounters: runtimeSnapshot.counters,
        errorRateThreshold,
        minEventVolume,
      });
      const governanceResult = options.alertGovernance?.filterAlerts(alerts) ?? {
        eligible: alerts,
        suppressed: [],
      };
      const dispatchResult = options.alertDispatcher?.dispatchAlerts(governanceResult.eligible) ?? {
        dispatched: [],
        suppressed: [],
      };
      for (const dispatchedAlert of dispatchResult.dispatched) {
        observability?.logEvent(
          getObservabilityLevelForAlertSeverity(dispatchedAlert.severity),
          'metrics_alert_dispatched',
          {
            ...dispatchedAlert.metadata,
            code: dispatchedAlert.code,
            severity: dispatchedAlert.severity,
            message: dispatchedAlert.message,
          },
        );
      }
      const notificationResult = await options.alertNotifier?.notifyAlerts(dispatchResult.dispatched) ?? {
        deliveries: [],
        sentCount: 0,
        failedCount: 0,
      };
      const escalationResult = options.alertGovernance?.recordDeliveryOutcome(notificationResult.deliveries) ?? {
        escalations: [],
      };
      if (notificationResult.sentCount > 0) {
        observability?.incrementCounter('api.metrics.alerts.delivery.sent', notificationResult.sentCount);
      }
      if (notificationResult.failedCount > 0) {
        observability?.incrementCounter('api.metrics.alerts.delivery.failed', notificationResult.failedCount);
        observability?.logEvent('error', 'metrics_alert_delivery_failed', {
          failedCount: notificationResult.failedCount,
          deliveries: notificationResult.deliveries,
        });
      } else if (notificationResult.sentCount > 0) {
        observability?.logEvent('info', 'metrics_alert_delivery_sent', {
          sentCount: notificationResult.sentCount,
          deliveries: notificationResult.deliveries,
        });
      }
      if (escalationResult.escalations.length > 0) {
        observability?.incrementCounter('api.metrics.alerts.escalations', escalationResult.escalations.length);
        observability?.logEvent('error', 'metrics_alert_escalated', {
          escalations: escalationResult.escalations,
        });
      }

      if (dispatchResult.dispatched.length > 0) {
        observability?.incrementCounter(
          'api.metrics.alerts.dispatch.dispatched',
          dispatchResult.dispatched.length,
        );
      }
      if (dispatchResult.suppressed.length > 0) {
        observability?.incrementCounter(
          'api.metrics.alerts.dispatch.suppressed',
          dispatchResult.suppressed.length,
        );
      }

      const payload = {
        thresholds: {
          errorRateThreshold,
          minEventVolume,
        },
        totalAlerts: alerts.length,
        dispatched: dispatchResult.dispatched,
        suppressed: dispatchResult.suppressed,
        governance: {
          suppressed: governanceResult.suppressed,
          escalations: escalationResult.escalations,
        },
        delivery: notificationResult,
      };
      const responseStatus = notificationResult.failedCount > 0 ? 502 : 200;
      cacheIdempotentResponse(idempotencyContext, responseStatus, payload, options.requestHardening);
      writeJson(response, responseStatus, payload);
      return;
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/metrics/alerts/silence' && options.alertGovernance) {
    try {
      const idempotencyContext = getIdempotencyContext(request, pathname, options.requestHardening);
      if (idempotencyContext?.replay) {
        writeJson(response, idempotencyContext.replay.statusCode, idempotencyContext.replay.payload);
        return;
      }
      const payload = await readJsonBody(request);
      const silenceOptions = getAlertSilenceOptions(payload);
      const responsePayload = options.alertGovernance.silenceAlert(silenceOptions);
      cacheIdempotentResponse(idempotencyContext, 200, responsePayload, options.requestHardening);
      writeJson(response, 200, responsePayload);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/metrics/alerts/acknowledge' && options.alertGovernance) {
    try {
      const idempotencyContext = getIdempotencyContext(request, pathname, options.requestHardening);
      if (idempotencyContext?.replay) {
        writeJson(response, idempotencyContext.replay.statusCode, idempotencyContext.replay.payload);
        return;
      }
      const payload = await readJsonBody(request);
      const acknowledgeOptions = getAlertAcknowledgeOptions(payload);
      const responsePayload = options.alertGovernance.acknowledgeAlert(acknowledgeOptions);
      cacheIdempotentResponse(idempotencyContext, 200, responsePayload, options.requestHardening);
      writeJson(response, 200, responsePayload);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/metrics/alerts/state' && options.alertGovernance) {
    writeJson(response, 200, {
      items: options.alertGovernance.listStates(),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/metrics/events' && options.repository) {
    try {
      writeJson(response, 200, await options.repository.listObservabilityEvents(getMetricsEventListOptions(searchParams)));
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/health') {
    const dynamicHealth = options.healthTracker?.getCurrentHealth();
    writeJson(response, 200, buildHealthResponse({
      database: dynamicHealth?.database ?? options.databaseHealth,
      provider: dynamicHealth?.provider ?? options.providerHealth,
    }));
    return;
  }

  const snapshotMatch = request.method === 'GET'
    ? /^\/leagues\/([^/]+)\/snapshot$/.exec(pathname)
    : null;
  if (snapshotMatch && options.repository) {
    const snapshot = await getLeagueSnapshot(options.repository, decodeURIComponent(snapshotMatch[1]));
    if (snapshot) {
      writeJson(response, 200, snapshot);
    } else {
      writeJson(response, 404, { error: 'League not found.' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/predictions/backtest') {
    const startedAt = Date.now();
    try {
      const payload = await readJsonBody(request);
      const result = runBacktestFromPayload(payload);
      if (!options.repository) {
        observability?.incrementCounter('api.predictions.backtest.compute.success');
        observability?.recordTiming('api.predictions.backtest.compute.durationMs', Date.now() - startedAt);
        writeJson(response, 200, result);
        return;
      }
      const snapshot = await options.repository.savePredictionBacktest({
        id: randomUUID(),
        draftSessionId: getOptionalDraftSessionId(payload),
        result,
        createdAt: new Date().toISOString(),
      });
      observability?.incrementCounter('api.predictions.backtest.create.success');
      observability?.recordTiming('api.predictions.backtest.create.durationMs', Date.now() - startedAt);
      observability?.logEvent('info', 'prediction_backtest_snapshot_created', {
        snapshotId: snapshot.id,
        draftSessionId: snapshot.draftSessionId,
      });
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.predictions.backtest.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.predictions.backtest.error');
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/heuristics/score') {
    const startedAt = Date.now();
    try {
      const payload = await readJsonBody(request);
      const result = scoreHeuristicsFromPayload(payload);
      if (!options.repository) {
        observability?.incrementCounter('api.heuristics.score.compute.success');
        observability?.recordTiming('api.heuristics.score.compute.durationMs', Date.now() - startedAt);
        writeJson(response, 200, result);
        return;
      }
      const snapshot = await options.repository.saveHeuristicScore({
        id: randomUUID(),
        draftSessionId: getOptionalDraftSessionId(payload),
        weights: result.weights,
        candidates: result.candidates,
        createdAt: new Date().toISOString(),
      });
      observability?.incrementCounter('api.heuristics.score.create.success');
      observability?.recordTiming('api.heuristics.score.create.durationMs', Date.now() - startedAt);
      observability?.logEvent('info', 'heuristic_score_snapshot_created', {
        snapshotId: snapshot.id,
        draftSessionId: snapshot.draftSessionId,
      });
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.heuristics.score.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.heuristics.score.error');
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/roster/recommendations') {
    const startedAt = Date.now();
    try {
      const payload = await readJsonBody(request);
      const result = scoreRosterFromPayload(payload);
      if (!options.repository) {
        observability?.incrementCounter('api.roster.recommendations.compute.success');
        observability?.recordTiming('api.roster.recommendations.compute.durationMs', Date.now() - startedAt);
        writeJson(response, 200, result);
        return;
      }
      const snapshot = await options.repository.saveStrategyRecommendation({
        id: randomUUID(),
        draftSessionId: getOptionalDraftSessionId(payload),
        evaluation: result,
        createdAt: new Date().toISOString(),
      });
      observability?.incrementCounter('api.roster.recommendations.create.success');
      observability?.recordTiming('api.roster.recommendations.create.durationMs', Date.now() - startedAt);
      observability?.logEvent('info', 'roster_recommendation_snapshot_created', {
        snapshotId: snapshot.id,
        draftSessionId: snapshot.draftSessionId,
      });
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.roster.recommendations.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.roster.recommendations.error');
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/predictions/backtest' && options.repository) {
    const startedAt = Date.now();
    try {
      const page = await options.repository.listPredictionBacktests(getSnapshotListOptions(searchParams));
      observability?.incrementCounter('api.predictions.backtest.list.success');
      observability?.recordTiming('api.predictions.backtest.list.durationMs', Date.now() - startedAt);
      writeJson(response, 200, page);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.predictions.backtest.list.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.predictions.backtest.list.error');
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/predictions/backtest/latest' && options.repository) {
    const startedAt = Date.now();
    try {
      const snapshot = await options.repository.getLatestPredictionBacktest(searchParams.get('draftSessionId') ?? undefined);
      if (!snapshot) {
        observability?.incrementCounter('api.predictions.backtest.latest.not_found');
        writeJson(response, 404, { error: 'Backtest snapshot not found.' });
        return;
      }
      observability?.incrementCounter('api.predictions.backtest.latest.success');
      observability?.recordTiming('api.predictions.backtest.latest.durationMs', Date.now() - startedAt);
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.predictions.backtest.latest.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.predictions.backtest.latest.error');
      throw error;
    }
    return;
  }

  const backtestSnapshotMatch = request.method === 'GET'
    ? /^\/predictions\/backtest\/([^/]+)$/.exec(pathname)
    : null;
  if (backtestSnapshotMatch && options.repository) {
    const snapshot = await options.repository.getPredictionBacktest(decodeURIComponent(backtestSnapshotMatch[1]));
    if (!snapshot) {
      writeJson(response, 404, { error: 'Backtest snapshot not found.' });
      return;
    }
    writeJson(response, 200, snapshot);
    return;
  }

  if (request.method === 'GET' && pathname === '/heuristics/score' && options.repository) {
    const startedAt = Date.now();
    try {
      const page = await options.repository.listHeuristicScores(getSnapshotListOptions(searchParams));
      observability?.incrementCounter('api.heuristics.score.list.success');
      observability?.recordTiming('api.heuristics.score.list.durationMs', Date.now() - startedAt);
      writeJson(response, 200, page);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.heuristics.score.list.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.heuristics.score.list.error');
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/heuristics/score/latest' && options.repository) {
    const startedAt = Date.now();
    try {
      const snapshot = await options.repository.getLatestHeuristicScore(searchParams.get('draftSessionId') ?? undefined);
      if (!snapshot) {
        observability?.incrementCounter('api.heuristics.score.latest.not_found');
        writeJson(response, 404, { error: 'Heuristic score snapshot not found.' });
        return;
      }
      observability?.incrementCounter('api.heuristics.score.latest.success');
      observability?.recordTiming('api.heuristics.score.latest.durationMs', Date.now() - startedAt);
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.heuristics.score.latest.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.heuristics.score.latest.error');
      throw error;
    }
    return;
  }

  const heuristicSnapshotMatch = request.method === 'GET'
    ? /^\/heuristics\/score\/([^/]+)$/.exec(pathname)
    : null;
  if (heuristicSnapshotMatch && options.repository) {
    const snapshot = await options.repository.getHeuristicScore(decodeURIComponent(heuristicSnapshotMatch[1]));
    if (!snapshot) {
      writeJson(response, 404, { error: 'Heuristic score snapshot not found.' });
      return;
    }
    writeJson(response, 200, snapshot);
    return;
  }

  if (request.method === 'GET' && pathname === '/roster/recommendations' && options.repository) {
    const startedAt = Date.now();
    try {
      const page = await options.repository.listStrategyRecommendations(getSnapshotListOptions(searchParams));
      observability?.incrementCounter('api.roster.recommendations.list.success');
      observability?.recordTiming('api.roster.recommendations.list.durationMs', Date.now() - startedAt);
      writeJson(response, 200, page);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.roster.recommendations.list.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.roster.recommendations.list.error');
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/roster/recommendations/latest' && options.repository) {
    const startedAt = Date.now();
    try {
      const snapshot = await options.repository.getLatestStrategyRecommendation(searchParams.get('draftSessionId') ?? undefined);
      if (!snapshot) {
        observability?.incrementCounter('api.roster.recommendations.latest.not_found');
        writeJson(response, 404, { error: 'Roster recommendation snapshot not found.' });
        return;
      }
      observability?.incrementCounter('api.roster.recommendations.latest.success');
      observability?.recordTiming('api.roster.recommendations.latest.durationMs', Date.now() - startedAt);
      writeJson(response, 200, snapshot);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.roster.recommendations.latest.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.roster.recommendations.latest.error');
      throw error;
    }
    return;
  }

  const rosterSnapshotMatch = request.method === 'GET'
    ? /^\/roster\/recommendations\/([^/]+)$/.exec(pathname)
    : null;
  if (rosterSnapshotMatch && options.repository) {
    const snapshot = await options.repository.getStrategyRecommendation(decodeURIComponent(rosterSnapshotMatch[1]));
    if (!snapshot) {
      writeJson(response, 404, { error: 'Roster recommendation snapshot not found.' });
      return;
    }
    writeJson(response, 200, snapshot);
    return;
  }

  if (request.method === 'POST' && pathname === '/snapshots/cleanup' && options.repository) {
    const startedAt = Date.now();
    try {
      const idempotencyContext = getIdempotencyContext(request, pathname, options.requestHardening);
      if (idempotencyContext?.replay) {
        writeJson(response, idempotencyContext.replay.statusCode, idempotencyContext.replay.payload);
        return;
      }
      const payload = await readJsonBody(request);
      const cleanupOptions = getCleanupOptions(payload);
      const deletedPredictionBacktests = await options.repository.deleteStalePredictionBacktests(cleanupOptions);
      const deletedHeuristicScores = await options.repository.deleteStaleHeuristicScores(cleanupOptions);
      const deletedStrategyRecommendations = await options.repository.deleteStaleStrategyRecommendations(cleanupOptions);
      const responsePayload = {
        ...cleanupOptions,
        deletedPredictionBacktests,
        deletedHeuristicScores,
        deletedStrategyRecommendations,
      };
      cacheIdempotentResponse(idempotencyContext, 200, responsePayload, options.requestHardening);
      writeJson(response, 200, responsePayload);
      observability?.incrementCounter('api.snapshots.cleanup.success');
      observability?.recordTiming('api.snapshots.cleanup.durationMs', Date.now() - startedAt);
      observability?.logEvent('info', 'snapshot_cleanup_completed', {
        keepLatest: cleanupOptions.keepLatest,
        draftSessionId: cleanupOptions.draftSessionId ?? null,
        deletedPredictionBacktests,
        deletedHeuristicScores,
        deletedStrategyRecommendations,
      });
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        observability?.incrementCounter('api.snapshots.cleanup.bad_request');
        writeJson(response, 400, { error: error.message });
        return;
      }
      observability?.incrementCounter('api.snapshots.cleanup.error');
      throw error;
    }
    return;
  }

  writeJson(response, 404, { error: 'Route not found.' });
}

/**
 * Create the HTTP API server.
 *
 * @param options - Dependency health values exposed by the health route.
 * @returns An unstarted Node HTTP server.
 */
export function createApiServer(options: ApiServerOptions = {}): Server {
  const observability = options.observability ?? createRuntimeObservability({
    logger: (entry) => {
      const serialized = JSON.stringify(entry);
      if (entry.level === 'error') {
        console.error(serialized);
      } else {
        console.info(serialized);
      }

      if (!options.repository) {
        return;
      }
      void options.repository.saveObservabilityEvent({
        id: randomUUID(),
        level: entry.level,
        eventName: entry.eventName,
        details: entry.details,
        createdAt: entry.timestamp,
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown observability persistence failure.';
        console.error(`Failed to persist observability event: ${message}`);
      });
    },
  });
  const runtimeOptions: ApiServerOptions = {
    ...options,
    observability,
    alertDispatcher: options.alertDispatcher ?? createAlertDispatcher({
      cooldownSeconds: options.alerting?.dispatchCooldownSeconds ?? 300,
    }),
    alertNotifier: options.alertNotifier ?? createMultiChannelAlertNotifier({
      webhook: {
        webhookUrl: options.alerting?.webhookUrl,
        maxAttempts: options.alerting?.webhookMaxAttempts ?? 3,
        initialBackoffMs: options.alerting?.webhookInitialBackoffMs ?? 250,
        minSeverity: options.alerting?.webhookMinSeverity ?? 'info',
        template: options.alerting?.webhookTemplate,
      },
      slack: {
        enabled: options.alerting?.slackEnabled ?? false,
        webhookUrl: options.alerting?.slackWebhookUrl,
        maxAttempts: options.alerting?.slackMaxAttempts ?? 3,
        initialBackoffMs: options.alerting?.slackInitialBackoffMs ?? 250,
        minSeverity: options.alerting?.slackMinSeverity ?? 'warning',
        template: options.alerting?.slackTemplate,
      },
      email: {
        enabled: options.alerting?.emailEnabled ?? false,
        webhookUrl: options.alerting?.emailWebhookUrl,
        maxAttempts: options.alerting?.emailMaxAttempts ?? 3,
        initialBackoffMs: options.alerting?.emailInitialBackoffMs ?? 250,
        minSeverity: options.alerting?.emailMinSeverity ?? 'critical',
        template: options.alerting?.emailTemplate,
      },
    }),
    alertGovernance: options.alertGovernance ?? createAlertGovernance({
      maxSilenceSeconds: options.alerting?.maxSilenceSeconds ?? 86_400,
      escalationFailureThreshold: options.alerting?.escalationFailureThreshold ?? 3,
    }),
    requestHardening: options.requestHardening ?? {
      idempotencyEnabled: options.alerting?.idempotencyEnabled ?? true,
      idempotencyTtlSeconds: options.alerting?.idempotencyTtlSeconds ?? 900,
      idempotencyCache: new Map<string, IdempotencyRecord>(),
      rateLimitEnabled: options.alerting?.rateLimitEnabled ?? true,
      rateLimitWindowSeconds: options.alerting?.rateLimitWindowSeconds ?? 60,
      rateLimitMaxRequests: options.alerting?.rateLimitMaxRequests ?? 30,
      rateLimitWindows: new Map<string, RateLimitWindowState>(),
    },
  };
  const requestHardening = runtimeOptions.requestHardening;
  if (!requestHardening) {
    throw new Error('requestHardening configuration is required.');
  }
  assertNumberInRange(requestHardening.idempotencyTtlSeconds, 'idempotencyTtlSeconds', 1, 86_400);
  assertNumberInRange(requestHardening.rateLimitWindowSeconds, 'rateLimitWindowSeconds', 1, 3_600);
  assertNumberInRange(requestHardening.rateLimitMaxRequests, 'rateLimitMaxRequests', 1, 1_000);

  let retentionController: SnapshotRetentionController | undefined;
  if (options.repository && options.snapshotRetention?.enabled !== false && options.snapshotRetention !== undefined) {
    retentionController = startSnapshotRetentionJob({
      repository: options.repository,
      intervalSeconds: options.snapshotRetention.intervalSeconds,
      keepLatest: options.snapshotRetention.keepLatest,
      draftSessionId: options.snapshotRetention.draftSessionId,
      runOnStart: options.snapshotRetention.runOnStart,
      onRun: (result) => {
        observability.incrementCounter('retention.job.run.success');
        observability.logEvent('info', 'snapshot_retention_run_completed', {
          deletedPredictionBacktests: result.deletedPredictionBacktests,
          deletedHeuristicScores: result.deletedHeuristicScores,
          deletedStrategyRecommendations: result.deletedStrategyRecommendations,
        });
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown retention failure.';
        observability.incrementCounter('retention.job.run.error');
        observability.logEvent('error', 'snapshot_retention_run_failed', { message });
      },
    });
  }

  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      const staticAsset = await serveStaticAsset(request.url ?? '/');
      if (staticAsset) {
        response.writeHead(staticAsset.statusCode, { 'content-type': staticAsset.contentType });
        response.end(staticAsset.body);
        return;
      }
    }

    void handleRequest(request, response, runtimeOptions).catch((error: unknown) => {
      observability.incrementCounter('api.requests.internal_error');
      console.error('API request failed.', error);
      if (!response.headersSent) {
        writeJson(response, 500, { error: 'Internal server error.' });
      }
    });
  });
  server.on('close', () => {
    retentionController?.stop();
  });
  return server;
}
