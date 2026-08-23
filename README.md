# War Room Wingman

A second screen for live drafts, sitting next to the Draft Sharks War Room. War Room ranks
players against the market. This answers the one thing it cannot know: **given how your
specific league-mates have drafted for the last four or five years, does this player come
back to you at your next turn?**

Built for two leagues that draft on consecutive days — A-League (Northern Virginia Vandals)
and B-League (Deer Valley Vandals) — from the CBS draft exports in `historical-draft-data/`.

## Draft day, in order

```bash
npm install
npm run draft:prep     # download ADP + player metadata, then build manager profiles
npm start              # http://localhost:3005
```

`draft:prep` writes everything to `data/` so nothing hits the network mid-draft. Run it the
day before, not on the clock.

In the browser: choose the league, set the season and your draft slot, paste the draft order
one team per line in slot order, and hit **Start draft**. Then type each pick as it happens
and press Enter — two or three letters of a surname is usually enough. When a name is
ambiguous, press `1`-`4` to pick from the candidates without leaving the keyboard. `Undo`
fixes a mistake, and **Paste draft results** rebuilds the whole board from a CBS text dump
if you fall behind.

Before it lets you onto the board, setup checks two things that are invisible once the
draft is running: that every team name in the pasted order resolves to a manager with
draft history, and that the team at your slot is actually yours. Both are silent failures
otherwise — a misspelled name is simulated as a league-average stranger with none of its
own tendencies, and a wrong slot makes every number on the screen describe someone else.
You can override either warning, but you have to see it first.

### If something goes wrong mid-draft

Every pick is written to `data/live-board.json` as it is recorded. Refreshing the page
reopens the running board rather than the setup screen, and if the server itself restarts,
the setup screen offers to resume from the snapshot. Starting a new draft over one that
already has picks now has to be confirmed. Use `npm run start:fast` to restart without
waiting for a TypeScript build.

## What the numbers mean

The **Survives** column is the probability the player is still on the board at your next
turn. When you are on the clock it looks past the current pick, so the question it answers
is *"if I spend this pick on someone else, does he come back?"*

Each intervening manager is simulated: he scores the available pool by ADP shifted by his own
positional reach, weighted by how often he takes that position in that round, then picks with
softmax noise. A few hundred replays of that sequence turn four years of habits into a
probability.

Opponents choose from a deeper pool than the one displayed (`simulationDepth`, default
twice `candidateDepth`), so a manager who reaches far past the visible board can do so in
the simulation instead of being forced onto a player you are watching.

Raw simulation output is recalibrated against measured results — see `CALIBRATION_ANCHORS`
in `src/services/survival-engine.ts`. Both raw and calibrated values are returned.

### Is it actually predictive?

`npm run replay` replays a historical draft through the live path with profiles trained
*without* that season, then scores the predictions against what really happened:

```bash
node dist/scripts/replay-draft.js A-LEAGUE 2025 500
node dist/scripts/replay-draft.js B-LEAGUE 2025 500
```

Across five held-out drafts (A-League 2023–2025, B-League 2024–2025) predicted survival
tracks actual survival within a few points per bucket, and name resolution against the ADP
pool runs at about 99%. Re-run it if the league or scoring format changes.

## Roster requirements

Across the 108 team-seasons in `historical-draft-data/`, every roster finished with exactly
one kicker (108 of 108) and one defense (106 of 108), and none finished without a
quarterback. Those three are treated as mandatory slots: the top bar counts them down
against your remaining turns and warns while there is still slack, rather than letting you
discover in round 12 that the last two picks are already spoken for. See
`src/services/roster-requirements.ts`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADP_FORMAT` | `ppr` | `ppr`, `half-ppr`, `standard`, `2qb`, `dynasty` |
| `LEAGUE_TEAMS` | `12` | League size for the ADP feed |
| `SEASON` | current year | Season to download |
| `PORT` | `3005` | API and UI port |

**The scoring format is not recorded anywhere in the draft exports.** Everything defaults to
12-team PPR. If the leagues are half-PPR or standard, set `ADP_FORMAT` before `draft:prep`,
or every reach number will be measured against the wrong market. The format in use is now
shown on the setup screen and in the board footer so the assumption is at least visible —
but confirming it against the league settings is still a manual step, and it is the single
highest-leverage thing to check before draft day.

The setup screen also shows how old the cached ADP is, dated by the window of real drafts
the feed averaged rather than by the file's timestamp, and warns past three days. Late-August
ADP moves on preseason injuries, so re-run `npm run draft:prep` the day before each draft.

## How the pieces fit

- `src/services/player-pool.ts` — merges the ADP feed with Sleeper metadata. Name matching
  strips punctuation and generational suffixes; team defenses match on team abbreviation
  because the feeds disagree on the name ("Seattle Defense" versus "Seahawks DST").
- `src/services/owner-registry.ts` — maps team names to owners, pooling the three people who
  play in both leagues (you, Roswell Aliens, and Espanola — whose team is spelled "chile" in
  2021 and "chili" after).
- `src/services/manager-profile-builder.ts` — joins every historical pick to that season's
  ADP and derives reach, position-by-round mix, and first-QB/TE timing. Thin samples shrink
  toward a prior: overall reach toward the league mean, positional reach toward the manager's
  own overall reach, so a four-pick tight end habit survives instead of being averaged away.
- `src/services/draft-board.ts` — live board: snake order, available pool, rosters, turns.
- `src/services/survival-engine.ts` — the Monte Carlo simulation and its calibration.
- `src/api/routes/board.ts` — the draft-day endpoints.
- `src/services/roster-requirements.ts` — mandatory-slot countdown against remaining turns.
- `src/services/board-persistence.ts` — the live snapshot that survives a restart.
- `scripts/` — `fetch-draft-data`, `build-manager-profiles`, `replay-draft`.

## Draft-day API

- `POST /draft/board` — start a board (`leagueId`, `season`, `draftSlot`, `draftOrder`, `rounds`).
- `GET /draft/board?samples=` — current state plus a fresh survival simulation.
- `POST /draft/board/pick` — record a pick by `query` or `matchKey`. Returns `409` with
  candidates when a query is ambiguous.
- `POST /draft/board/undo` — undo the last pick.
- `POST /draft/board/resync` — rebuild the board from pasted CBS draft-results `text`.
- `GET /draft/players?q=` — autocomplete against the available pool.
- `GET /draft/profiles?leagueId=` — generated manager profiles and league shape.
- `GET /draft/data-status?season=` — cached ADP age, scoring format, and profile build time.
- `GET /draft/board/saved` — summary of a resumable draft, if one was left behind.
- `POST /draft/board/restore` — rebuild the live board from that snapshot.
- `POST /draft/board/discard` — throw the snapshot away.

`POST /draft/board` refuses with `400` when a draft with picks is already running; send
`force: true` to replace it. Every response carries a `setup` audit (unrecognised team
names, whether your slot holds your team), a `requirements` countdown, and `adp` freshness.

## Inherited endpoints

The repository also carries the earlier prototype's analytics, observability, and alerting
routes. None of it runs during a draft; the draft-day path above is self-contained.

### Legacy endpoint reference

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
