# Sprint 1 Handoff

## Completed

- Domain models and validation for leagues, managers, players, picks, and sessions.
- Historical CSV importer with BOM handling, blank-team normalization, multi-position parsing, and stable IDs.
- Deterministic JSON import command: `npm run import:historical`.
- SQLite migration and driver-neutral repository contract.
- In-memory repository and `sql.js` SQLite integration coverage.
- One-cycle ingestion with new-pick detection and last-known-good fallback.
- Live polling coordinator with immediate refresh, configurable intervals, overlap protection, and completion shutdown.
- Node HTTP health endpoint: `GET /health`.
- League snapshot endpoint: `GET /leagues/:leagueId/snapshot`.
- CBS provider boundary with bearer authentication and injectable payload normalization.
- Environment configuration parsing for CBS credentials and polling interval bounds.
- CBS transient failure retries with bounded exponential backoff.
- Historical manager tendency aggregation with position rates, rounds, reach, and confidence.
- Initial prediction engine with top-three candidate probabilities and position distributions.
- Cross-league exposure aggregation with configurable concentration thresholds.

## Verification

Run from the repository root:

```powershell
npm install
npm run build
npm test
npm run import:historical
```

The import command writes `data/historical-drafts.json`.

## Next Implementation Slice

1. Supply the production CBS response normalizer behind `DraftProvider`.
2. Add dependency status tracking for the health endpoint.
3. Add prediction backtesting against imported historical drafts.
4. Add configurable heuristic scoring and strategy-aware roster constraints.

## Known Boundary

The repository adapter is intentionally driver-neutral. The current integration test uses `sql.js` to avoid native compiler requirements on Windows and Node 24. A production SQLite connection can be supplied by an application-level driver that implements `SqliteDatabase`.
