CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  provider_league_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scoring_format TEXT NOT NULL CHECK (scoring_format IN ('PPR', 'HALF_PPR', 'STANDARD', 'CUSTOM')),
  roster_settings_json TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managers (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  display_name TEXT NOT NULL,
  tendency_profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  external_ids_json TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DST')),
  team TEXT NOT NULL,
  bye_week INTEGER,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_picks (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  season INTEGER NOT NULL,
  round INTEGER NOT NULL,
  overall_pick INTEGER NOT NULL,
  manager_id TEXT NOT NULL REFERENCES managers(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  adp_at_pick REAL,
  reach_delta REAL,
  picked_at TEXT NOT NULL,
  UNIQUE (league_id, season, overall_pick)
);

CREATE TABLE IF NOT EXISTS draft_sessions (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  season INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PRE_DRAFT', 'LIVE', 'COMPLETE')),
  strategy_profile TEXT NOT NULL,
  current_pick INTEGER,
  polling_interval_seconds INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prediction_backtests (
  id TEXT PRIMARY KEY,
  draft_session_id TEXT REFERENCES draft_sessions(id),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heuristic_scores (
  id TEXT PRIMARY KEY,
  draft_session_id TEXT REFERENCES draft_sessions(id),
  weights_json TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_recommendations (
  id TEXT PRIMARY KEY,
  draft_session_id TEXT REFERENCES draft_sessions(id),
  evaluation_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observability_events (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'error')),
  event_name TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_picks_league_season
  ON draft_picks (league_id, season, overall_pick);
CREATE INDEX IF NOT EXISTS idx_managers_league
  ON managers (league_id);
CREATE INDEX IF NOT EXISTS idx_sessions_league_updated
  ON draft_sessions (league_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_prediction_backtests_session
  ON prediction_backtests (draft_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prediction_backtests_created
  ON prediction_backtests (created_at);
CREATE INDEX IF NOT EXISTS idx_heuristic_scores_session
  ON heuristic_scores (draft_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_heuristic_scores_created
  ON heuristic_scores (created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_session
  ON strategy_recommendations (draft_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_created
  ON strategy_recommendations (created_at);
CREATE INDEX IF NOT EXISTS idx_observability_events_created
  ON observability_events (created_at);
CREATE INDEX IF NOT EXISTS idx_observability_events_name
  ON observability_events (event_name, created_at);
