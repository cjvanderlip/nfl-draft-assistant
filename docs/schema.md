# Draft Sharks Companion Schema

## Design Scope

This schema turns the project plan into an implementation boundary for Sprint 1. The first implementation should preserve the current root-level prototype while introducing the planned modules incrementally under `src/`.

## Domain Entities

### League

```ts
interface League {
  id: string;
  providerLeagueId: string;
  name: string;
  scoringFormat: 'PPR' | 'HALF_PPR' | 'STANDARD' | 'CUSTOM';
  rosterSettings: RosterSettings;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}
```

### RosterSettings

```ts
interface RosterSettings {
  starters: Record<string, number>;
  bench: number;
  maxPerPosition?: Record<string, number>;
}
```

### Manager

```ts
interface Manager {
  id: string;
  leagueId: string;
  displayName: string;
  tendencyProfile?: TendencyProfile;
  createdAt: string;
  updatedAt: string;
}
```

### Player

```ts
interface Player {
  id: string;
  externalIds: { cbs?: string; sleeper?: string; underdog?: string };
  fullName: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
  team: string;
  byeWeek?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### DraftPick

```ts
interface DraftPick {
  id: string;
  leagueId: string;
  season: number;
  round: number;
  overallPick: number;
  managerId: string;
  playerId: string;
  adpAtPick?: number;
  reachDelta?: number;
  pickedAt: string;
}
```

### DraftSession

```ts
interface DraftSession {
  id: string;
  leagueId: string;
  season: number;
  status: 'PRE_DRAFT' | 'LIVE' | 'COMPLETE';
  strategyProfile: 'HERO_RB' | 'ZERO_RB' | 'BALANCED' | 'ANCHOR_WR' | 'LATE_QB';
  currentPick?: number;
  pollingIntervalSeconds: number;
  createdAt: string;
  updatedAt: string;
}
```

### TendencyProfile

```ts
interface TendencyProfile {
  managerId: string;
  positionBias: Partial<Record<Position, PositionBias>>;
  positionalRunPatterns: PositionalRunPattern[];
  averageReach: number;
  confidence: number;
  lastComputedAt: string;
}

type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
interface PositionBias { avgRound: number; avgReach: number; pickRate: number }
interface PositionalRunPattern { pattern: string; frequency: number; sampleYears: number }
```

### Intelligence and Reporting Entities

```ts
interface HeuristicWeights {
  version: string;
  contractYearBump: number;
  targetShareVolatility: number;
  olineUpgrade: number;
  rzRegression: number;
  gameScriptLeverage: number;
  exposureAlertThreshold: number;
  draftStrategyDefault: DraftStrategy;
  updatedAt: string;
}

type DraftStrategy = 'HERO_RB' | 'ZERO_RB' | 'BALANCED' | 'ANCHOR_WR' | 'LATE_QB';

interface PlayerScore {
  playerId: string;
  draftSessionId: string;
  baseRank: number;
  signalBreakdown: {
    contractYear: number;
    targetShareVolatility: number;
    olineUpgrade: number;
    rzRegression: number;
    gameScriptLeverage: number;
  };
  compositeScore: number;
  adjustedRank: number;
  tier: string;
  rationale: string[];
  computedAt: string;
}

interface PredictionSnapshot {
  id: string;
  draftSessionId: string;
  managerId: string;
  topPredictions: Array<{ playerId: string; probability: number }>;
  positionProbabilities: Record<Position, number>;
  generatedAt: string;
}

interface ExposureRecord {
  id: string;
  userId: string;
  playerId: string;
  leagueId: string;
  season: number;
  rosterSlot: string;
  draftRound?: number;
  shareCountSnapshot: number;
  diversificationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  createdAt: string;
}

interface PostDraftReport {
  id: string;
  draftSessionId: string;
  overallGrade: string;
  positionGrades: Record<string, { grade: string; reason: string }>;
  weaknesses: Array<{ position: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; action: string }>;
  tradeTargets: Array<{ playerId: string; priority: number; reason: string }>;
  waiverPriorities: Array<{ playerId: string; priority: number; reason: string }>;
  generatedAt: string;
}
```

## Provider Boundaries

External providers must be hidden behind interfaces so local CSV replay and tests do not require network access or credentials.

```ts
interface DraftProvider {
  getLeagueState(leagueId: string): Promise<ProviderLeagueState>;
}

interface AdpProvider {
  getAdp(season: number): Promise<AdpEntry[]>;
}

interface ProviderLeagueState {
  league: League;
  managers: Manager[];
  picks: DraftPick[];
  players: Player[];
}

interface AdpEntry {
  playerId: string;
  overallAdp: number;
  source: string;
  season: number;
}
```

CBS and ADP adapters implement these interfaces. Authentication, retries, rate limiting, and response normalization belong inside adapters or a shared provider client, not in scoring or presentation services.

## Repository Contracts

Repositories own persistence and query boundaries. Services receive repository interfaces and must not depend on SQLite details.

```ts
interface DraftRepository {
  saveLeague(league: League): Promise<League>;
  getLeague(leagueId: string): Promise<League | null>;
  saveManagers(managers: Manager[]): Promise<void>;
  savePlayers(players: Player[]): Promise<void>;
  savePicks(picks: DraftPick[]): Promise<void>;
  getPicksForLeague(leagueId: string, season?: number): Promise<DraftPick[]>;
  saveSession(session: DraftSession): Promise<DraftSession>;
  getLatestSession(leagueId: string): Promise<DraftSession | null>;
}
```

The initial SQLite implementation should use parameterized queries, explicit migrations, and unique keys for provider IDs and pick IDs. An in-memory implementation remains useful for unit tests.

## Service Responsibilities

- `ingestion-service`: poll a `DraftProvider`, normalize state, detect new picks, persist the update, and return a refresh result.
- `tendency-engine`: calculate manager position bias and positional run patterns from historical picks.
- `heuristic-scorer`: apply configured signal weights and return per-signal contributions plus composite scores.
- `prediction-engine`: generate top-three player predictions and position probabilities for upcoming managers.
- `exposure-service`: aggregate player shares across configured leagues and classify diversification risk.
- `roster-optimizer`: compare a roster against its selected strategy and remaining slots.
- `post-draft-service`: generate grades, structural weaknesses, trade targets, and waiver priorities.

Each service validates inputs at its public boundary and returns serializable result objects. External failures should be represented as typed service errors so the polling loop can retain last-known-good state.

## Sprint 1 File Map

```text
src/
  app.ts
  config/{env.ts,defaults.ts}
  models/{league.ts,manager.ts,player.ts,draft-pick.ts,exposure-record.ts,post-draft-report.ts}
  services/{cbs-client.ts,adp-client.ts,ingestion-service.ts}
  storage/{sqlite.ts,repositories/draft-repository.ts}
  api/{server.ts,routes/health.ts,routes/draft.ts}
  utils/{logger.ts,validators.ts,time.ts,math.ts}
scripts/{import-historical-drafts.ts,backtest-predictions.ts}
tests/{unit,integration,fixtures}
```

The first code slice should be the historical CSV import and repository contract, because it supplies deterministic data for tendency, prediction, and post-draft work while exercising the identity and validation rules early.

## Data Integrity Rules

- Provider identifiers are stored as strings and normalized at ingestion boundaries.
- A pick is unique by provider pick ID when available; otherwise use `(leagueId, season, overallPick)`.
- Player identity resolution must preserve all known external IDs and report unresolved mappings instead of silently merging records.
- Timestamps are ISO strings in the domain layer and are generated at mutation boundaries.
- Probabilities are numbers from 0 through 1. Signal weights and scores must be finite numbers.
- Secrets and provider tokens are configuration inputs only; they must never be persisted with domain records or logged.
