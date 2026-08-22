# Draft Sharks Companion

This project is the initial TypeScript foundation for the Draft Sharks Companion Tool described in the project plan. It includes the core domain models, validation helpers, draft analytics, a deterministic historical CSV importer, and repository boundaries for incremental ingestion work.

## Getting started

```bash
npm install
npm run build
npm test
npm run import:historical
npm run backtest:predictions
```

## Included modules

- `draft-models.ts` - League, Manager, Player, DraftPick, and DraftSession models.
- `validators.ts` - Shared validation utilities.
- `draft-analytics.ts` - Team average pick and session summary helpers.
- `draft-service.ts` - Live draft recommendation and session snapshot services.
- `app.ts` - Small sample entry point that demonstrates the analytics in use.
- `docs/schema.md` - Domain schema and Sprint 1 architecture handoff.
- `src/services/historical-draft-importer.ts` - Normalizes historical CSV exports into draft records.
- `src/services/prediction-engine.ts` - Predicts upcoming picks and backtests prediction quality against historical drafts.
- `src/services/dependency-health.ts` - Tracks dynamic health for provider and database dependencies.
- `src/services/heuristic-scorer.ts` - Applies configurable proprietary signal weights to player recommendations.
- `src/services/roster-strategy.ts` - Enforces strategy-aware roster constraints and recommendation ordering.
- `src/storage/repositories/draft-repository.ts` - Async repository contract and in-memory implementation.

The historical import command reads `historical-draft-data/` and writes a normalized snapshot to `data/historical-drafts.json`. Custom input and output paths can be passed to the compiled script:

```bash
node dist/scripts/import-historical-drafts.js <input-directory> <output-file>
```

Historical prediction backtesting reads the normalized output and reports aggregate top-1/top-3 and position-level metrics:

```bash
node dist/scripts/backtest-predictions.js <historical-json-file>
```

Live CBS configuration is read from `CBS_BASE_URL`, `CBS_ACCESS_TOKEN`, and optional `POLLING_INTERVAL_SECONDS` environment variables. The polling interval defaults to 15 seconds and must be between 5 and 300 seconds.

Snapshot retention scheduler configuration is available through:

- `SNAPSHOT_RETENTION_ENABLED` (default `true`)
- `SNAPSHOT_RETENTION_INTERVAL_SECONDS` (default `900`, min `60`, max `86400`)
- `SNAPSHOT_RETENTION_KEEP_LATEST` (default `100`, max `1000`)

Alert threshold configuration is available through:

- `ALERT_ERROR_RATE_THRESHOLD` (default `0.2`, range `0..1`)
- `ALERT_MIN_EVENT_VOLUME` (default `20`)
- `ALERT_DISPATCH_ENABLED` (default `true`)
- `ALERT_DISPATCH_COOLDOWN_SECONDS` (default `300`, min `1`, max `86400`)
- `ALERT_WEBHOOK_URL` (optional webhook endpoint for alert delivery)
- `ALERT_WEBHOOK_MAX_ATTEMPTS` (default `3`, min `1`, max `10`)
- `ALERT_WEBHOOK_INITIAL_BACKOFF_MS` (default `250`, min `1`, max `60000`)
- `ALERT_WEBHOOK_MIN_SEVERITY` (default `info`; `info|warning|critical`)
- `ALERT_WEBHOOK_TEMPLATE` (default `[{severity}] {code}: {message} | metadata={metadata}`)
- `ALERT_SLACK_ENABLED` (default `false`)
- `ALERT_SLACK_WEBHOOK_URL` (optional Slack adapter webhook endpoint)
- `ALERT_SLACK_MAX_ATTEMPTS` (default `3`, min `1`, max `10`)
- `ALERT_SLACK_INITIAL_BACKOFF_MS` (default `250`, min `1`, max `60000`)
- `ALERT_SLACK_MIN_SEVERITY` (default `warning`; `info|warning|critical`)
- `ALERT_SLACK_TEMPLATE` (default `:rotating_light: [{severity}] {code} - {message}`)
- `ALERT_EMAIL_ENABLED` (default `false`)
- `ALERT_EMAIL_WEBHOOK_URL` (optional email adapter webhook endpoint)
- `ALERT_EMAIL_MAX_ATTEMPTS` (default `3`, min `1`, max `10`)
- `ALERT_EMAIL_INITIAL_BACKOFF_MS` (default `250`, min `1`, max `60000`)
- `ALERT_EMAIL_MIN_SEVERITY` (default `critical`; `info|warning|critical`)
- `ALERT_EMAIL_TEMPLATE` (default `[{severity}] {code}\n\n{message}\n\nmetadata={metadata}`)
- `ALERT_ESCALATION_FAILURE_THRESHOLD` (default `3`, min `1`, max `20`)
- `ALERT_MAX_SILENCE_SECONDS` (default `86400`, min `1`, max `604800`)
- `ALERT_IDEMPOTENCY_ENABLED` (default `true`)
- `ALERT_IDEMPOTENCY_TTL_SECONDS` (default `900`, min `1`, max `86400`)
- `ALERT_RATE_LIMIT_ENABLED` (default `true`)
- `ALERT_RATE_LIMIT_WINDOW_SECONDS` (default `60`, min `1`, max `3600`)
- `ALERT_RATE_LIMIT_MAX_REQUESTS` (default `30`, min `1`, max `1000`)

Template placeholders supported by all alert channels: `{severity}`, `{code}`, `{message}`, `{metadata}`.

## API endpoints

- `GET /health` - dependency health snapshot.
- `GET /leagues/:leagueId/snapshot` - persisted league/session/pick state.
- `POST /predictions/backtest` - historical prediction backtesting metrics.
- `GET /predictions/backtest?draftSessionId=&limit=&cursor=` - list persisted backtest snapshots (newest first).
- `GET /predictions/backtest/latest?draftSessionId=` - retrieve the latest backtest snapshot.
- `GET /predictions/backtest/:snapshotId` - retrieve a persisted prediction backtest snapshot.
- `POST /heuristics/score` - configurable heuristic scoring for player candidates.
- `GET /heuristics/score?draftSessionId=&limit=&cursor=` - list persisted heuristic snapshots (newest first).
- `GET /heuristics/score/latest?draftSessionId=` - retrieve the latest heuristic scoring snapshot.
- `GET /heuristics/score/:snapshotId` - retrieve a persisted heuristic scoring snapshot.
- `POST /roster/recommendations` - strategy-aware roster constraints and recommendation ordering.
- `GET /roster/recommendations?draftSessionId=&limit=&cursor=` - list persisted roster recommendation snapshots (newest first).
- `GET /roster/recommendations/latest?draftSessionId=` - retrieve the latest roster recommendation snapshot.
- `GET /roster/recommendations/:snapshotId` - retrieve a persisted roster recommendation snapshot.
- `POST /snapshots/cleanup` - retention endpoint (`keepLatest`, optional `draftSessionId`) to delete stale snapshots.
- `GET /metrics` - in-memory counters, timings, and recent structured events for runtime observability.
- `GET /metrics/events?eventName=&level=&limit=&cursor=` - persisted observability event stream.
- `GET /metrics/summary?windowSeconds=` - aggregated persisted event counts by level and event name, plus runtime metrics snapshot.
- `GET /metrics/alerts?windowSeconds=` - threshold-based alert evaluation over observability summaries.
- `POST /metrics/alerts/dispatch?windowSeconds=` - dispatches currently active alerts with cooldown-based duplicate suppression.
  - Fanout supports webhook, Slack adapter, and email adapter channels with per-channel severity routing and templated message payloads.
  - Includes governance metadata for silenced/acknowledged suppressions and escalation events.
  - Supports idempotency via `idempotency-key` request header.
  - Returns `502` when one or more external deliveries fail after retries.
- `POST /metrics/alerts/silence` - silence one alert code for `durationSeconds` (`{ code, durationSeconds }`).
- `POST /metrics/alerts/acknowledge` - acknowledge one alert code (`{ code, note? }`).
- `GET /metrics/alerts/state` - current alert governance state (silences, acknowledgements, escalation counters).
- `GET /ops/runbook-checks` - operational readiness checklist for persistence, retention, alert delivery channels, idempotency, and rate limits.
