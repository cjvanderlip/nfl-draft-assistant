# Draft Sharks Companion Tool - Project Plan

## 1. Project Overview
The Draft Sharks Companion Tool is a Node.js 20+ and TypeScript-based overlay platform that augments Draft Sharks during live drafts and after draft completion by combining league-specific behavior modeling, multi-league player exposure intelligence, configurable proprietary scoring signals, and roster-structure analysis; the system will ingest CBS league state plus external ADP feeds, process recommendations in near real time, and deliver actionable pick guidance and post-draft optimization reports without attempting to replace Draft Sharks rankings.

## 2. User Stories
1. As a drafter, I want live draft state updates every 10-30 seconds so that recommendations reflect the current board.
Acceptance criteria:
- Polling interval is configurable and defaults to 15 seconds.
- New pick events are detected and persisted within one polling cycle.
- Recommendation refresh completes in under 5 seconds after pick ingestion for normal league sizes.

2. As a drafter, I want league tendency predictions so that I can anticipate the next 2-3 picks.
Acceptance criteria:
- System returns top 3 predicted picks for upcoming managers with confidence values.
- Prediction response includes position-level probability distribution.
- Backtest on historical data yields at least 70% position-level accuracy for top 3 pick windows.

3. As a multi-league player, I want portfolio exposure tracking so that I avoid over-concentration risk.
Acceptance criteria:
- Exposure is computed across all configured leagues and seasons.
- Alerts trigger when player share count exceeds configurable threshold (default: 5).
- Exposure dashboard shows total shares, league breakdown, and diversification risk level.

4. As a strategy-focused drafter, I want custom heuristic scoring so that my proprietary signals influence recommendations.
Acceptance criteria:
- Five configurable signals are applied per candidate player: contract year, target-share volatility, offensive-line context, red-zone regression, and game-script leverage.
- Output includes per-signal contribution and final composite score.
- Users can tune signal weights without code changes through configuration.

5. As a drafter, I want strategy guardrails (Hero RB, Zero RB, Balanced, Anchor WR, Late QB) so that recommendations fit roster construction goals.
Acceptance criteria:
- Strategy profile is selectable per draft session.
- Off-strategy players are explicitly flagged in recommendations.
- Remaining roster slot visualization updates after each pick.

6. As a user, I want a draft board forecast view so that I can identify value pockets and urgency picks.
Acceptance criteria:
- System displays likely selection windows by round range for key players.
- Rising and falling ADP alerts are surfaced with magnitude.
- Opportunity alerts fire when value outliers are likely to be drafted within next 3 picks.

7. As a user, I want post-draft analysis so that I can improve roster structure and execute early trade or waiver moves.
Acceptance criteria:
- Roster grade is generated within 2 minutes of draft completion.
- Position-level structural audit identifies strengths, weaknesses, and severity.
- Trade targets and waiver priorities are ranked with rationale.

8. As an operator, I want robust observability and safe failure behavior so that live draft mode remains reliable.
Acceptance criteria:
- API failures degrade gracefully with last-known-good state and warning indicators.
- Structured logs capture polling latency, scoring duration, and recommendation generation outcomes.
- Critical failures emit actionable error messages and do not crash the polling loop.

## 3. Data Model
1. League
- id: string
- providerLeagueId: string
- name: string
- scoringFormat: 'PPR' | 'HALF_PPR' | 'STANDARD' | 'CUSTOM'
- rosterSettings: RosterSettings
- timezone: string
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)

2. Manager
- id: string
- leagueId: string
- displayName: string
- tendencyProfile: TendencyProfile
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)

3. Player
- id: string
- externalIds: { cbs?: string; sleeper?: string; underdog?: string }
- fullName: string
- position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST'
- team: string
- byeWeek?: number
- metadata: Record<string, unknown>
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)

4. DraftPick
- id: string
- leagueId: string
- season: number
- round: number
- overallPick: number
- managerId: string
- playerId: string
- adpAtPick?: number
- reachDelta?: number
- pickedAt: string (ISO timestamp)

5. DraftSession
- id: string
- leagueId: string
- season: number
- status: 'PRE_DRAFT' | 'LIVE' | 'COMPLETE'
- strategyProfile: 'HERO_RB' | 'ZERO_RB' | 'BALANCED' | 'ANCHOR_WR' | 'LATE_QB'
- currentPick?: number
- pollingIntervalSeconds: number
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)

6. TendencyProfile
- managerId: string
- positionBias: Record<'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST', PositionBias>
- positionalRunPatterns: PositionalRunPattern[]
- averageReach: number
- confidence: number
- lastComputedAt: string (ISO timestamp)

7. ExposureRecord
- id: string
- userId: string
- playerId: string
- leagueId: string
- season: number
- rosterSlot: string
- draftRound?: number
- shareCountSnapshot: number
- diversificationRisk: 'LOW' | 'MEDIUM' | 'HIGH'
- createdAt: string (ISO timestamp)

8. HeuristicWeights
- version: string
- contractYearBump: number
- targetShareVolatility: number
- olineUpgrade: number
- rzRegression: number
- gameScriptLeverage: number
- exposureAlertThreshold: number
- draftStrategyDefault: 'HERO_RB' | 'ZERO_RB' | 'BALANCED' | 'ANCHOR_WR' | 'LATE_QB'
- updatedAt: string (ISO timestamp)

9. PlayerScore
- playerId: string
- draftSessionId: string
- baseRank: number
- signalBreakdown: {
  contractYear: number;
  targetShareVolatility: number;
  olineUpgrade: number;
  rzRegression: number;
  gameScriptLeverage: number;
}
- compositeScore: number
- adjustedRank: number
- tier: string
- rationale: string[]
- computedAt: string (ISO timestamp)

10. PredictionSnapshot
- id: string
- draftSessionId: string
- managerId: string
- topPredictions: Array<{ playerId: string; probability: number }>
- positionProbabilities: Record<'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST', number>
- generatedAt: string (ISO timestamp)

11. PostDraftReport
- id: string
- draftSessionId: string
- overallGrade: string
- positionGrades: Record<string, { grade: string; reason: string }>
- weaknesses: Array<{ position: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; action: string }>
- tradeTargets: Array<{ playerId: string; priority: number; reason: string }>
- waiverPriorities: Array<{ playerId: string; priority: number; reason: string }>
- generatedAt: string (ISO timestamp)

12. Supporting Types
- RosterSettings: { starters: Record<string, number>; bench: number; maxPerPosition?: Record<string, number> }
- PositionBias: { avgRound: number; avgReach: number; pickRate: number }
- PositionalRunPattern: { pattern: string; frequency: number; sampleYears: number }

## 4. File Structure
```text
.
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── docs/
│   └── project-plan.md
├── data/
│   ├── historical-drafts/
│   ├── heuristic-weights.json
│   └── manager-profiles.json
├── scripts/
│   ├── import-historical-drafts.ts
│   └── backtest-predictions.ts
├── src/
│   ├── app.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── defaults.ts
│   ├── models/
│   │   ├── league.ts
│   │   ├── manager.ts
│   │   ├── player.ts
│   │   ├── draft-pick.ts
│   │   ├── exposure-record.ts
│   │   └── post-draft-report.ts
│   ├── services/
│   │   ├── cbs-client.ts
│   │   ├── adp-client.ts
│   │   ├── ingestion-service.ts
│   │   ├── tendency-engine.ts
│   │   ├── exposure-service.ts
│   │   ├── heuristic-scorer.ts
│   │   ├── prediction-engine.ts
│   │   ├── roster-optimizer.ts
│   │   └── post-draft-service.ts
│   ├── storage/
│   │   ├── sqlite.ts
│   │   ├── migrations/
│   │   └── repositories/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── draft.ts
│   │   │   ├── exposure.ts
│   │   │   ├── predictions.ts
│   │   │   └── post-draft.ts
│   │   └── server.ts
│   ├── dashboard/
│   │   ├── public/
│   │   ├── views/
│   │   └── sse.ts
│   └── utils/
│       ├── logger.ts
│       ├── validators.ts
│       ├── time.ts
│       └── math.ts
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

## 5. Implementation Phases
### Sprint 1 (Weeks 1-2): Foundation and Data Ingestion
Goals:
- Establish TypeScript Node.js service skeleton, config, logging, and SQLite storage.
- Build CSV historical draft import pipeline.
- Integrate CBS authentication flow and read endpoints for draft state, members, and rosters.
- Integrate ADP ingestion from Sleeper and configurable external source adapter.

Deliverables:
- Working ingestion service with persisted draft, manager, and player records.
- Initial API endpoints: health, league snapshot, draft session snapshot.
- Seeded local data from 3+ historical seasons.

Exit criteria:
- End-to-end data refresh from CBS + ADP completes on schedule.
- Import script idempotently reprocesses historical CSVs.
- Integration tests cover ingestion happy path and API error handling.

### Sprint 2 (Weeks 3-4): Core Intelligence for Live Draft
Goals:
- Implement tendency engine, prediction engine, exposure tracker, and heuristic scorer.
- Add live recommendation pipeline triggered after each polling cycle.
- Add strategy-aware roster optimizer and alerting rules.
- Build lightweight dashboard with SSE updates for picks, recommendations, and alerts.

Deliverables:
- Live mode recommendations with reasoning and prediction confidence.
- Exposure alerts and league tendency panels in dashboard.
- Backtest script and report for prediction quality.

Exit criteria:
- Recommendations refresh in under 5 seconds after new pick detection.
- Prediction backtest reaches at least 70% position-level top-3 window accuracy.
- Unit tests cover scoring, exposure thresholds, and strategy constraints.

### Sprint 3 (Weeks 5-6): Post-Draft Intelligence and Hardening
Goals:
- Implement post-draft grading, structural audit, and ranked trade/waiver suggestions.
- Add report generation (HTML first, PDF optional) and downloadable artifacts.
- Improve reliability, retries, cache strategy, and failure recovery.
- Add production-style observability and final security controls.

Deliverables:
- Post-draft report generated within 2 minutes of draft completion.
- Full end-to-end flow from live draft to post-draft recommendations.
- Release candidate with deployment docs and containerized local runtime.

Exit criteria:
- All critical user stories accepted.
- Latency, reliability, and alert correctness targets validated.
- Test suite includes unit, integration, and one full-system scenario.

## 6. Non-Functional Requirements
1. Performance
- Live recommendation cycle must complete within 5 seconds after ingesting a new pick.
- Polling and processing should support at least 2 concurrent league sessions on a single developer machine.
- Database queries for live views should remain under 100 ms at 50k historical picks.

2. Security
- OAuth tokens and API keys stored only in environment variables and never committed.
- Input validation and output encoding applied on all API routes.
- Audit logs record auth failures, rate-limit events, and configuration changes.

3. Scalability
- Service boundaries separate ingestion, scoring, and presentation concerns.
- ADP and player metadata caching reduce external API dependency and rate-limit pressure.
- Repository pattern allows migration from SQLite to managed SQL later without service rewrites.

4. Reliability
- Polling loop uses retry with exponential backoff and circuit-breaker behavior on repeated upstream failures.
- Last-known-good recommendation state is retained during transient outages.
- Health endpoints expose upstream dependency status.

5. Maintainability
- Strict TypeScript mode enabled.
- JSDoc added to all exported functions and classes.
- Test coverage target: minimum 80% for critical scoring and prediction paths.

## 7. Risks and Mitigations
1. CBS API access or rate-limit uncertainty
- Mitigation: define provider interface with mock adapter and optional CSV replay mode.

2. Data quality mismatch across CBS and ADP sources
- Mitigation: canonical player identity map and validation reports for unresolved mappings.

3. Prediction accuracy below target early in season
- Mitigation: start with interpretable weighted model, add confidence calibration, and continuously backtest.

4. Live latency drift during draft spikes
- Mitigation: precompute tendency aggregates and cache top-N candidate pools.

## 8. Definition of Done
- Live mode, prediction, exposure, heuristics, and post-draft modules are functional end-to-end.
- All acceptance criteria in user stories are met and verified by tests or measurable scripts.
- Setup documentation enables a fresh environment to run ingestion, live mode, and post-draft analysis.
- Operational runbook includes fallback behavior for API outages.
