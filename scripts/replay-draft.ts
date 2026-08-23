import { buildManagerProfiles } from '../src/services/manager-profile-builder.js';
import {
  loadHistoricalPicks,
  loadPlayerPool,
  loadSeasonAdpIndex,
} from '../src/services/draft-data-store.js';
import {
  createDraftBoard,
  locatePick,
  recordPick,
  type DraftBoard,
} from '../src/services/draft-board.js';
import { createSeededRandom, simulateSurvival } from '../src/services/survival-engine.js';
import { searchPlayers, type PlayerPoolEntry } from '../src/services/player-pool.js';
import { isUserTeam } from '../src/services/owner-registry.js';

interface ReplayOptions {
  leagueId: string;
  season: number;
  samples: number;
  holdOutSeason: boolean;
  temperature?: number;
}

interface CalibrationBucket {
  label: string;
  lower: number;
  upper: number;
  predicted: number[];
  survived: number;
}

function newBuckets(): CalibrationBucket[] {
  return [
    { label: '0-20%', lower: 0, upper: 0.2, predicted: [], survived: 0 },
    { label: '20-40%', lower: 0.2, upper: 0.4, predicted: [], survived: 0 },
    { label: '40-60%', lower: 0.4, upper: 0.6, predicted: [], survived: 0 },
    { label: '60-80%', lower: 0.6, upper: 0.8, predicted: [], survived: 0 },
    { label: '80-100%', lower: 0.8, upper: 1.01, predicted: [], survived: 0 },
  ];
}

/**
 * Replay one historical draft through the live board and score the survival model.
 *
 * Every pick is fed in as it actually happened. At each of the user's turns the
 * model predicts which players last until the following turn, and the replay checks
 * those predictions against what really occurred. With `holdOutSeason` the profiles
 * are trained without the replayed season, so the model is never scored on data it saw.
 *
 * @param options - League, season, sample count, and hold-out setting.
 * @returns Nothing; results are printed.
 */
export async function replayDraft(options: ReplayOptions): Promise<void> {
  const allPicks = await loadHistoricalPicks();
  const target = allPicks
    .filter((pick) => pick.leagueId === options.leagueId && pick.season === options.season)
    .sort((left, right) => left.overallPick - right.overallPick);

  if (target.length === 0) {
    throw new Error(`No historical picks found for ${options.leagueId} ${options.season}.`);
  }

  const trainingPicks = options.holdOutSeason
    ? allPicks.filter((pick) => !(pick.leagueId === options.leagueId && pick.season === options.season))
    : allPicks;
  const seasons = [...new Set(trainingPicks.map((pick) => pick.season))];
  const adpBySeason = await loadSeasonAdpIndex(seasons);
  const profileSet = buildManagerProfiles({ picks: trainingPicks, adpBySeason });
  const profiles = profileSet.managers.filter((manager) => manager.leagueId === options.leagueId);

  const pool = await loadPlayerPool(options.season);
  if (pool.players.length === 0) {
    throw new Error(`No ADP on disk for ${options.season}. Run "npm run data:fetch" first.`);
  }

  const teamCount = 12;
  const rounds = Math.max(...target.map((pick) => pick.round));
  const draftOrder: string[] = [];
  for (const pick of target) {
    const { round, slot } = locatePick(pick.overallPick, teamCount);
    if (round === 1) {
      draftOrder[slot - 1] = pick.teamName;
    }
  }

  const yourSlot = draftOrder.findIndex((team) => isUserTeam(team)) + 1;
  if (yourSlot === 0) {
    throw new Error('Could not find a Vandals team in this draft order.');
  }

  const board: DraftBoard = createDraftBoard({
    leagueId: options.leagueId,
    season: options.season,
    teamCount,
    rounds,
    draftSlot: yourSlot,
    draftOrder,
    pool,
    profiles,
  });

  const random = createSeededRandom(20260829);
  const buckets = newBuckets();
  const unresolved: string[] = [];
  const turnReports: string[] = [];
  let pendingPrediction: Map<string, number> | undefined;
  let pendingTargetPick: number | undefined;

  const predictNextTurn = (): void => {
    const survival = simulateSurvival({
      board,
      samples: options.samples,
      random,
      temperature: options.temperature,
      // Set REPLAY_SIM_DEPTH to re-measure calibration against a different
      // opponent-pool depth than the one the live board uses.
      simulationDepth: process.env.REPLAY_SIM_DEPTH ? Number(process.env.REPLAY_SIM_DEPTH) : undefined,
    });
    if (survival.targetPick === undefined || survival.picksSimulated === 0) {
      return;
    }
    pendingPrediction = new Map(survival.players.map((player) => [player.matchKey, player.survivalProbability]));
    pendingTargetPick = survival.targetPick;
  };

  console.log(`Replaying ${options.leagueId} ${options.season} from slot ${yourSlot} (${draftOrder[yourSlot - 1]}).`);
  console.log(`Profiles trained on ${trainingPicks.length} picks${options.holdOutSeason ? `, holding out ${options.season}` : ''}.\n`);

  for (const historical of target) {
    const nextOverall = board.picks.length + 1;

    if (pendingPrediction && pendingTargetPick === nextOverall) {
      let hits = 0;
      let total = 0;
      for (const [matchKey, probability] of pendingPrediction) {
        const survived = board.available.has(matchKey);
        total += 1;
        if (survived) {
          hits += 1;
        }
        const bucket = buckets.find((entry) => probability >= entry.lower && probability < entry.upper);
        if (bucket) {
          bucket.predicted.push(probability);
          if (survived) {
            bucket.survived += 1;
          }
        }
      }
      turnReports.push(`  pick ${nextOverall}: ${hits}/${total} predicted players still on the board`);
      pendingPrediction = undefined;
      pendingTargetPick = undefined;
    }

    const isYourPick = isUserTeam(historical.teamName);

    const key = historical.position === 'DST'
      ? `DST:${historical.playerTeam}`
      : undefined;
    let player: PlayerPoolEntry | undefined = key ? board.available.get(key) : undefined;
    if (!player) {
      player = searchPlayers(
        { ...board.pool, players: [...board.available.values()] },
        historical.playerName,
        1,
      )[0];
    }

    if (!player || player.position !== historical.position) {
      unresolved.push(`${historical.overallPick}. ${historical.playerName} (${historical.position})`);
      const filler = [...board.available.values()]
        .filter((candidate) => candidate.position === historical.position)
        .sort((left, right) => right.adp - left.adp)[0];
      if (!filler) {
        continue;
      }
      recordPick(board, filler);
      if (isYourPick) {
        predictNextTurn();
      }
      continue;
    }

    recordPick(board, player);
    if (isYourPick) {
      predictNextTurn();
    }
  }

  console.log('Your turns, prediction accuracy:');
  for (const line of turnReports) {
    console.log(line);
  }

  console.log('\nCalibration — of players given this survival chance, how many actually survived:');
  console.log('  bucket      n    predicted   actual');
  for (const bucket of buckets) {
    if (bucket.predicted.length === 0) {
      continue;
    }
    const predictedMean = bucket.predicted.reduce((sum, value) => sum + value, 0) / bucket.predicted.length;
    const actual = bucket.survived / bucket.predicted.length;
    console.log(`  ${bucket.label.padEnd(10)} ${String(bucket.predicted.length).padStart(4)}   ${(100 * predictedMean).toFixed(1).padStart(7)}%  ${(100 * actual).toFixed(1).padStart(7)}%`);
  }

  const resolvedCount = target.length - unresolved.length;
  console.log(`\nName resolution: ${resolvedCount}/${target.length} picks matched the ${options.season} ADP pool (${((100 * resolvedCount) / target.length).toFixed(1)}%).`);
  if (unresolved.length > 0) {
    console.log(`Unmatched (outside the top ${pool.players.length} by ADP):`);
    for (const entry of unresolved.slice(0, 15)) {
      console.log(`  ${entry}`);
    }
    if (unresolved.length > 15) {
      console.log(`  ...and ${unresolved.length - 15} more`);
    }
  }
}

const isDirectInvocation = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/replay-draft.js');
if (isDirectInvocation) {
  const [leagueArg, seasonArg, samplesArg] = process.argv.slice(2);
  replayDraft({
    leagueId: (leagueArg ?? 'A-LEAGUE').toUpperCase(),
    season: Number(seasonArg ?? 2025),
    samples: Number(samplesArg ?? 400),
    holdOutSeason: process.env.HOLD_OUT !== 'false',
    temperature: process.env.TEMPERATURE ? Number(process.env.TEMPERATURE) : undefined,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown failure.';
    console.error(`Replay failed: ${message}`);
    process.exitCode = 1;
  });
}
