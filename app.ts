import { DraftPick, DraftSession, League, Manager, Player } from './draft-models.js';
import { averagePickByTeam, summarizeDraftSession } from './draft-analytics.js';

const league = new League({
  providerLeagueId: 'league-42',
  name: 'Draft Sharks Bash',
  scoringFormat: 'PPR',
  rosterSettings: { starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 }, bench: 6 },
  timezone: 'America/New_York',
});

const manager = new Manager({
  leagueId: league.id,
  displayName: 'Test Manager',
});

const player = new Player({
  fullName: 'Josh Allen',
  position: 'QB',
  team: 'BUF',
  byeWeek: 11,
  metadata: { projectedPoints: 330 },
});

const pick = new DraftPick({
  leagueId: league.id,
  season: 2025,
  round: 1,
  overallPick: 1,
  managerId: manager.id,
  playerId: player.id,
  adpAtPick: 12,
  reachDelta: 11,
});

const session = new DraftSession({
  leagueId: league.id,
  season: 2025,
  status: 'LIVE',
  strategyProfile: 'BALANCED',
  currentPick: 2,
  pollingIntervalSeconds: 15,
});

const summary = averagePickByTeam([pick], { [player.id]: 'BUF' });
console.info('league', league.toJSON());
console.info('manager', manager.toJSON());
console.info('player', player.toJSON());
console.info('pick', pick.toJSON());
console.info('teamSummary', summary);
console.info('sessionSummary', summarizeDraftSession({
  leagueId: league.id,
  status: session.status,
  totalPicks: 1,
  strategyProfile: session.strategyProfile,
  currentPick: session.currentPick,
}));
