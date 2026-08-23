# War Room Wingman

A second screen for live drafts, sitting next to the Draft Sharks War Room. War Room ranks
players against the market. This answers the one thing it cannot know: **given how your
specific league-mates have drafted for the last five or six years, does this player come
back to you at your next turn?**

Built for two 12-team CBS leagues that draft on consecutive days — A-League (Northern
Virginia Vandals) and B-League (Deer Valley Vandals) — from the draft exports in
`historical-draft-data/`.

## Draft day, in order

```bash
npm install
npm run draft:prep     # download ADP + player metadata, then build manager profiles
npm start              # http://localhost:3005
```

`draft:prep` writes everything to `data/` so nothing touches the network mid-draft. Run it
the day before, not on the clock — late-August ADP moves on preseason injuries, and the
setup screen warns when the cache is more than three days old. The seasons it downloads come
from the filenames in `historical-draft-data/`, so dropping a new export there is enough.

In the browser: choose the league, set the season and your draft slot, paste the draft order
one team per line in slot order, and hit **Start draft**. Then type each pick as it happens
and press Enter — two or three letters of a surname is usually enough. When a name is
ambiguous, press `1`–`4` to choose without leaving the keyboard. A name outside the ADP pool
can still be recorded, with its position, so the board never falls out of step.

### Before it lets you start

Setup checks two things that become invisible the moment a draft is running:

- **Every team name resolves to a manager with history.** A misspelling is otherwise
  simulated as a league-average stranger with none of its own tendencies.
- **The team at your slot is actually yours.** A wrong slot makes every number on the
  screen describe somebody else.

Both are overridable, but you have to see them first.

### Buttons on the board

| Button | What it does |
| --- | --- |
| **Undo** | Removes the last pick and returns the player to the pool. |
| **Scouting report** | Every manager's measured habits — reach per position with sample sizes, first-QB and first-TE timing, full tell list. |
| **Deep sim** | Re-runs the board at 4,000 samples instead of the 600 each pick triggers. About a second, for a genuinely close call. |
| **Paste draft results** | Rebuilds the whole board from a CBS text dump, if you fall behind. |
| **New draft** | Back to setup. Replacing a board that has picks must be confirmed. |
| **Finish & clear** | Deletes the saved snapshot once a draft is over. |

### If something goes wrong mid-draft

Every pick is written to `data/live-board.json` as it is recorded. Refreshing the page
reopens the running board rather than the setup screen; if the server itself restarts, setup
offers to resume from the snapshot. `npm run start:fast` restarts without waiting for a
TypeScript build.

## What the numbers mean

The **Survives** column is the probability the player is still on the board at your next
turn. When you are on the clock it looks past the current pick, so the question it answers is
*"if I spend this pick on someone else, does he come back?"*

Each intervening manager is simulated: he scores the available pool by ADP shifted by his own
positional reach, weighted by how often he takes that position in that round, then picks with
softmax noise. A few hundred replays of that sequence turn five years of habits into a
probability.

Opponents choose from a deeper pool than the one displayed, so a manager who reaches far past
the visible board can do so in the simulation rather than being forced onto a player you are
watching. Raw output is then recalibrated against measured results — see
`CALIBRATION_ANCHORS` in `src/services/survival-engine.ts`. Both raw and calibrated values
are returned.

### Is it actually predictive?

`npm run replay` replays a historical draft through the live path with profiles trained
*without* that season, then scores the predictions against what really happened:

```bash
npm run replay -- A-LEAGUE 2025 500
```

Aggregated over eight held-out drafts (both leagues, 2022–2025):

| Predicted survival | n | predicted | actually survived |
| --- | --- | --- | --- |
| 20–40% | 410 | 35.1% | 38.3% |
| 40–60% | 484 | 48.7% | 53.5% |
| 60–80% | 603 | 71.0% | 71.2% |
| 80–100% | 5,474 | 95.0% | 94.0% |

Read that honestly. The top bucket, which is where most of the board sits on any given pick,
is accurate to about a point. The middle buckets lean conservative — players survive a few
points more often than predicted — which is the safer direction to be wrong in. And those
middle buckets are thin: within a *single* draft they swing ±20 points on 40–70 observations,
so treat a lone 45% as "genuinely uncertain", not as a precise number.

Name resolution against the ADP pool runs 95–99% for 2023 onward, and about 88% for 2022,
where the half-PPR feed only ranked 124 players. Re-run the replays if the league or the
scoring format changes.

## League settings

`src/config/league.ts` holds what the CBS settings pages say, so the numbers live in one
place rather than spread across defaults: **half-PPR** scoring (`Recpt .5 points`), 12 teams,
13 rounds, and an active minimum of one at every position. Both leagues run the same
settings.

That last one matters more than it looks. The league scores an illegal roster as **zero
points for the week**, so finishing without a kicker is not a soft mistake. The top bar counts
unfilled minimums down against your remaining turns and warns while there is still slack,
rather than letting you discover in round 12 that both remaining picks are spoken for. The
history agrees this binds: across 108 team-seasons every roster ended with exactly one kicker
(108 of 108) and one defense (106 of 108).

The simulation's per-position caps are behavioural rather than legal — the league sets no
roster maximum — and are the observed historical maxima, so they only stop a simulated
manager taking a fourth quarterback in the twelfth round.

### A note on the ADP feed

Half-PPR is the right market but the shallower feed, because far more people mock-draft full
PPR: for 2026 it ranks 229 players against PPR's 266. The 38 it misses are mostly kickers,
backup quarterbacks and deep tight ends — exactly the tail a thirteen-round draft reaches at
the end. Those names are borrowed from the PPR feed purely so they resolve in the pick box
(`adpFromFallback` marks them); half-PPR still ranks everyone it covers. Without the
supplement, name resolution on the held-out replays fell from 99% to 86%.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADP_FORMAT` | `half-ppr` | `ppr`, `half-ppr`, `standard`, `2qb`, `dynasty` |
| `LEAGUE_TEAMS` | `12` | League size for the ADP feed |
| `SEASON` | current year | Season to download |
| `PORT` | `3005` | API and UI port |

## How the pieces fit

- `src/config/league.ts` — the confirmed CBS league settings, in one place.
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
- `src/services/roster-requirements.ts` — mandatory-slot countdown against remaining turns.
- `src/services/board-persistence.ts` — the live snapshot that survives a restart.
- `src/api/routes/board.ts` — the draft-day endpoints.
- `scripts/` — `fetch-draft-data`, `build-manager-profiles`, `replay-draft`.

## Draft-day API

This is the whole API. Everything the board needs was written to `data/` by
`npm run draft:prep`; there is no database, no scheduler, and no external service in the
request path.

- `POST /draft/board` — start a board (`leagueId`, `season`, `draftSlot`, `draftOrder`,
  `rounds`). Returns `400` when a draft with picks is already running; send `force: true`
  to replace it.
- `GET /draft/board?samples=` — current state plus a fresh survival simulation. `samples`
  is clamped to 100–5000 and defaults to 600.
- `POST /draft/board/pick` — record a pick by `query` or `matchKey`, or with `offPool: true`
  and a `position` for a name outside the ADP pool. Returns `409` with candidates when a
  query is ambiguous.
- `POST /draft/board/undo` — undo the last pick.
- `POST /draft/board/resync` — rebuild the board from pasted CBS draft-results `text`.
- `GET /draft/board/saved` — summary of a resumable draft, if one was left behind.
- `POST /draft/board/restore` — rebuild the live board from that snapshot.
- `POST /draft/board/discard` — throw the snapshot away.
- `GET /draft/players?q=` — autocomplete against the available pool.
- `GET /draft/profiles?leagueId=` — manager profiles and league shape.
- `GET /draft/data-status?season=` — cached ADP age, scoring format, profile build time,
  and whether a board is live.

Every board response also carries a `setup` audit (unrecognised team names, whether your slot
holds your team), a `requirements` countdown, and `adp` freshness.

## Development

```bash
npm test          # 129 tests, no network
npm run build     # tsc
npm run replay    # score the model against a held-out draft
```

No runtime dependencies — the server is Node's own `http` module and the UI is a single
static file. `data/` and `dist/` are generated; everything under `historical-draft-data/` is
source.
