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
day before, not on the clock. The seasons it downloads are read from the filenames in
`historical-draft-data/`, so dropping a new export in there is enough to have the next
`draft:prep` pick it up.

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

## League settings

`src/config/league.ts` holds what the CBS settings pages say, so the numbers live in one
place instead of being spread as defaults: half-PPR scoring, 12 teams, 13 rounds, and an
active minimum of one at every position. Both leagues run the same settings.

That last one matters more than it looks. The league scores an illegal roster as **zero
points for the week**, so finishing the draft without a kicker is not a soft mistake. The
top bar counts the unfilled minimums down against your remaining turns and warns while
there is still slack, rather than letting you find out in round 12 that both remaining
picks are already spoken for. Historical drafts agree that this binds in practice: across
108 team-seasons every roster ended with exactly one kicker (108 of 108) and one defense
(106 of 108). See `src/services/roster-requirements.ts`.

The simulation's per-position caps are behavioural rather than legal — the league sets no
roster maximum — and are the observed historical maxima, so they only stop a simulated
manager taking a fourth quarterback in the twelfth round.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADP_FORMAT` | `half-ppr` | `ppr`, `half-ppr`, `standard`, `2qb`, `dynasty` |
| `LEAGUE_TEAMS` | `12` | League size for the ADP feed |
| `SEASON` | current year | Season to download |
| `PORT` | `3005` | API and UI port |

**Both leagues are half-PPR** (`Recpt .5 points`, confirmed from the CBS settings pages),
not the full PPR everything defaulted to before. That default is now wrong-market and has
been changed: see `src/config/league.ts`. `ADP_FORMAT` still overrides it. The format in use
is shown on the setup screen and in the board footer.

Half-PPR is the right market but the shallower feed — far more people mock-draft full PPR —
so for 2026 it ranks 229 players against PPR's 266. The 38 it misses are mostly kickers,
backup quarterbacks and deep tight ends, exactly the tail a thirteen-round draft reaches at
the end. Those names are borrowed from the PPR feed purely so they resolve in the pick box
(`adpFromFallback` marks them); half-PPR still ranks everyone it covers. Without that,
name resolution on the held-out replays fell from 99% to 86%.

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
- `src/config/league.ts` — the confirmed CBS league settings, in one place.
- `src/services/roster-requirements.ts` — mandatory-slot countdown against remaining turns.
- `src/services/board-persistence.ts` — the live snapshot that survives a restart.
- `scripts/` — `fetch-draft-data`, `build-manager-profiles`, `replay-draft`.

## Draft-day API

This is the whole API. Everything the board needs was written to `data/` by
`npm run draft:prep`; there is no database, no scheduler, and no external provider
in the request path.

- `POST /draft/board` — start a board (`leagueId`, `season`, `draftSlot`, `draftOrder`,
  `rounds`). Returns `400` when a draft with picks is already running; send `force: true`
  to replace it.
- `GET /draft/board?samples=` — current state plus a fresh survival simulation.
  `samples` is clamped to 100–5000 and defaults to 600.
- `POST /draft/board/pick` — record a pick by `query` or `matchKey`, or with
  `offPool: true` and a `position` for a name outside the ADP pool. Returns `409`
  with candidates when a query is ambiguous.
- `POST /draft/board/undo` — undo the last pick.
- `POST /draft/board/resync` — rebuild the board from pasted CBS draft-results `text`.
- `GET /draft/board/saved` — summary of a resumable draft, if one was left behind.
- `POST /draft/board/restore` — rebuild the live board from that snapshot.
- `POST /draft/board/discard` — throw the snapshot away.
- `GET /draft/players?q=` — autocomplete against the available pool.
- `GET /draft/profiles?leagueId=` — manager profiles and league shape.
- `GET /draft/data-status?season=` — cached ADP age, scoring format, profile build time,
  and whether a board is live.

Every board response carries a `setup` audit (unrecognised team names, whether your slot
holds your team), a `requirements` countdown, and `adp` freshness.

## What was removed

The repository used to carry an earlier prototype's analytics, persistence, observability
and alerting stack — roughly 8,000 lines behind 20-odd documented endpoints. It has been
deleted rather than left inert, for two reasons.

Twelve of those endpoints were **already unreachable**: they were gated on an
`options.repository` that `src/start.ts` never passed, so they returned `404` from the
server anyone actually ran while the README documented them as working. Documentation that
lies is worse than no documentation, particularly at 7pm on a draft night.

The rest — CBS polling against a deprecated v3 API, SQLite snapshot persistence and
retention, webhook/Slack/email alert fanout with governance and escalation, heuristic
scoring for five signals nothing fed, exposure tracking dropped on evidence — described a
product this is not. None of it ran during a draft. Deleting it also removed the project's
only runtime dependency.

What remains is the draft-day path and the scripts that feed it.
