#!/usr/bin/env node
/**
 * MCP sidecar for War Room Wingman.
 *
 * Exposes the running draft board to Claude as read-only tools, by calling the
 * same HTTP API the browser UI calls. It is a separate process with a separate
 * package.json on purpose: the draft-day server keeps its zero-runtime-dependency
 * guarantee, and if this sidecar dies mid-draft the board does not notice.
 *
 * Every tool is read-only. Recording a pick stays in the UI, where a human
 * confirms it. The board refuses to draft anybody on a single stray click for
 * exactly the reason a model must not draft anybody either: one wrong pick puts
 * every later pick on the wrong team, and the mistake is invisible afterwards.
 *
 * The numbers here are measured, not reasoned. `survivalProbability` comes from
 * the calibrated Monte Carlo in src/services/survival-engine.ts. Claude should
 * read and explain these values, never estimate its own.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.WINGMAN_URL ?? `http://localhost:${process.env.PORT ?? 3005}`;

/**
 * Call the draft-day API and parse its JSON.
 *
 * The board server is on localhost and answers in milliseconds, so a hung
 * request means something is wrong rather than slow — the timeout is short so a
 * question asked on the clock fails fast enough to retry by hand.
 *
 * @param path - Path and query string, e.g. `/draft/board?samples=600`.
 * @returns Parsed body plus the status code.
 */
async function callApi(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

/**
 * Wrap a tool body so every failure reaches Claude as actionable text.
 *
 * A dead board server and an empty board are the two states a draft-day question
 * actually hits, and both are recoverable by the user in one step — so both are
 * reported as tool errors with the step, rather than as a stack trace.
 *
 * @param run - Tool body returning a JSON-serialisable value.
 * @returns MCP tool result.
 */
async function respond(run) {
  try {
    const value = await run();
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown failure.';
    const hint = /fetch failed|ECONNREFUSED|terminated|timed out/i.test(message)
      ? `Could not reach the draft server at ${BASE_URL}. Start it with "npm start" in the repo, then retry.`
      : message;
    return { content: [{ type: 'text', text: hint }], isError: true };
  }
}

/**
 * Fetch board state, turning the "no board yet" case into a clear message.
 *
 * @param samples - Simulation samples to request.
 * @returns Board state response.
 */
async function fetchBoard(samples) {
  const { status, body } = await callApi(`/draft/board?samples=${samples}`);
  if (status === 404) {
    throw new Error(`No draft board is active. Open ${BASE_URL} and start a draft first.`);
  }
  if (status !== 200) {
    throw new Error(body?.error ?? `Draft server returned ${status}.`);
  }
  return body;
}

const server = new McpServer({ name: 'war-room-wingman', version: '0.1.0' });

server.registerTool(
  'get_board_state',
  {
    title: 'Draft board state',
    description:
      'Current live draft: who is on the clock, your roster so far, your next two turns, recent picks, mandatory-slot countdown, setup audit and ADP freshness. Returns the per-pick threat list but omits the long per-player survival table — use get_survival for that.',
    inputSchema: {
      samples: z
        .number()
        .int()
        .min(100)
        .max(5000)
        .optional()
        .describe('Monte Carlo samples. Defaults to 600, the same as each live pick triggers.'),
    },
  },
  async ({ samples = 600 }) =>
    respond(async () => {
      const board = await fetchBoard(samples);
      const { survival, ...rest } = board;
      return {
        ...rest,
        survival: {
          fromPick: survival.fromPick,
          targetPick: survival.targetPick,
          picksSimulated: survival.picksSimulated,
          samples: survival.samples,
          assumesCurrentPickSpent: survival.assumesCurrentPickSpent,
          note: survival.note,
          playerCount: survival.players.length,
          threats: survival.threats,
        },
      };
    }),
);

server.registerTool(
  'get_survival',
  {
    title: 'Survival probabilities',
    description:
      'The probability each available player is still on the board at your next turn, from the calibrated simulation. These are measured values — report them, do not re-estimate them. When you are on the clock the window starts after the current pick, so the question answered is "if I spend this pick elsewhere, does he come back?" (assumesCurrentPickSpent). Both calibrated (survivalProbability) and raw values are returned.',
    inputSchema: {
      samples: z
        .number()
        .int()
        .min(100)
        .max(5000)
        .optional()
        .describe('Monte Carlo samples. 600 is the live default; 4000 is the "deep sim" for a close call.'),
      position: z
        .enum(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
        .optional()
        .describe('Restrict to one position.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum players to return. Defaults to 40.'),
      maxProbability: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Only players at or below this survival probability — the ones at genuine risk of not returning.'),
    },
  },
  async ({ samples = 600, position, limit = 40, maxProbability }) =>
    respond(async () => {
      const board = await fetchBoard(samples);
      let players = board.survival.players;
      if (position) {
        players = players.filter((player) => player.position === position);
      }
      if (typeof maxProbability === 'number') {
        players = players.filter((player) => player.survivalProbability <= maxProbability);
      }
      return {
        fromPick: board.survival.fromPick,
        targetPick: board.survival.targetPick,
        picksSimulated: board.survival.picksSimulated,
        samples: board.survival.samples,
        assumesCurrentPickSpent: board.survival.assumesCurrentPickSpent,
        note: board.survival.note,
        yourRoster: board.yourRoster,
        requirements: board.requirements,
        returned: Math.min(players.length, limit),
        totalMatching: players.length,
        players: players.slice(0, limit),
      };
    }),
);

server.registerTool(
  'get_manager_profile',
  {
    title: 'Manager tendencies',
    description:
      'Measured draft habits for the league-mates: reach versus ADP overall and per position (with sample sizes), position mix by round, first-QB and first-TE timing, and the derived tell list. `confidence` and `pickCount` say how much history is behind each number — a thin sample is shrunk toward the league mean, so say so rather than treating it as firm.',
    inputSchema: {
      leagueId: z.string().optional().describe('A-LEAGUE or B-LEAGUE. Omit for both.'),
      manager: z
        .string()
        .optional()
        .describe('Filter to one manager by display name or team name, case-insensitive substring match.'),
    },
  },
  async ({ leagueId, manager }) =>
    respond(async () => {
      const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
      const { status, body } = await callApi(`/draft/profiles${query}`);
      if (status !== 200) {
        throw new Error(body?.error ?? `Draft server returned ${status}.`);
      }
      let managers = body.managers;
      if (manager) {
        const needle = manager.toLowerCase();
        managers = managers.filter(
          (entry) =>
            entry.displayName.toLowerCase().includes(needle) ||
            entry.teamNames.some((name) => name.toLowerCase().includes(needle)),
        );
        if (managers.length === 0) {
          throw new Error(`No manager matches "${manager}". Call get_manager_profile with no filter to list them.`);
        }
      }
      return { generatedAt: body.generatedAt, managers };
    }),
);

server.registerTool(
  'get_league_tendencies',
  {
    title: 'League shape',
    description:
      'League-wide baseline the individual managers are measured against: seasons covered, position share overall and by round, and mean reach. Use it to say whether a manager is unusual or merely typical.',
    inputSchema: {
      leagueId: z.string().optional().describe('A-LEAGUE or B-LEAGUE. Omit for both.'),
    },
  },
  async ({ leagueId }) =>
    respond(async () => {
      const { status, body } = await callApi('/draft/profiles');
      if (status !== 200) {
        throw new Error(body?.error ?? `Draft server returned ${status}.`);
      }
      // The API's leagueId filter narrows `managers` but always returns every
      // league, so narrowing `leagues` has to happen here or the filter silently
      // hands back the other league's baseline alongside the one that was asked for.
      if (!leagueId) {
        return { generatedAt: body.generatedAt, leagues: body.leagues };
      }
      const wanted = leagueId.trim().toUpperCase();
      const league = body.leagues[wanted];
      if (!league) {
        throw new Error(`No league "${leagueId}". Known leagues: ${Object.keys(body.leagues).join(', ')}.`);
      }
      return { generatedAt: body.generatedAt, leagues: { [wanted]: league } };
    }),
);

server.registerTool(
  'search_players',
  {
    title: 'Search available players',
    description: 'Autocomplete against the players still available on the live board.',
    inputSchema: {
      query: z.string().min(1).describe('Part of a player name.'),
    },
  },
  async ({ query }) =>
    respond(async () => {
      const { status, body } = await callApi(`/draft/players?q=${encodeURIComponent(query)}`);
      if (status !== 200) {
        throw new Error(body?.error ?? `Draft server returned ${status}.`);
      }
      return body;
    }),
);

server.registerTool(
  'get_data_status',
  {
    title: 'Cache freshness',
    description:
      'How old the cached ADP is, which scoring format it is, when the manager profiles were built, and whether a board is live. Stale ADP is worth flagging before trusting anything else — late-August ADP moves on preseason injuries.',
    inputSchema: {
      season: z.number().int().optional().describe('Season to check. Defaults to the current year.'),
    },
  },
  async ({ season }) =>
    respond(async () => {
      const query = season ? `?season=${season}` : '';
      const { status, body } = await callApi(`/draft/data-status${query}`);
      if (status !== 200) {
        throw new Error(body?.error ?? `Draft server returned ${status}.`);
      }
      return body;
    }),
);

/**
 * Middle value of a numeric list.
 *
 * @param values - Numbers to summarise.
 * @returns The median, or 0 for an empty list.
 */
function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Split one position's available players into tiers at their ADP gaps.
 *
 * Gaps are measured in log space, which matters more than it sounds. Raw ADP
 * spacing grows steadily down the board — the top running backs sit about a pick
 * apart while the ones around pick 60 sit five or six apart — so a single
 * absolute threshold lumps the entire top of the board into one tier and then
 * splits the tail into noise, which is precisely backwards from where the
 * reader needs resolution. Comparing ratios instead makes "three picks apart at
 * ADP 5" and "thirty apart at ADP 50" the same size of cliff.
 *
 * The absolute floor is still applied, because two players 0.8 picks apart are
 * not two tiers however large that gap looks in proportion.
 *
 * @param players - Available players at one position, any order.
 * @param multiple - How many times the position's median log gap counts as a cliff.
 * @param minAdpGap - Absolute ADP floor below which a gap is never a tier break.
 * @returns Tiers in ADP order, plus the gaps that separated them.
 */
function tieriseByAdp(players, multiple, minAdpGap) {
  const ordered = [...players].sort((left, right) => left.adp - right.adp);
  const safeAdp = (player) => Math.max(player.adp, 0.1);

  const adpGaps = ordered.slice(1).map((player, index) => player.adp - ordered[index].adp);
  const logGaps = ordered.slice(1).map((player, index) => Math.log(safeAdp(player) / safeAdp(ordered[index])));
  const typicalLogGap = median(logGaps);
  const logThreshold = typicalLogGap * multiple;

  const tiers = [];
  let current = [];
  ordered.forEach((player, index) => {
    current.push(player);
    if (index >= adpGaps.length) {
      return;
    }
    const isCliff = logGaps[index] >= logThreshold && adpGaps[index] >= minAdpGap;
    if (isCliff) {
      tiers.push({ players: current, gapAfter: Number(adpGaps[index].toFixed(1)) });
      current = [];
    }
  });
  if (current.length > 0) {
    tiers.push({ players: current, gapAfter: undefined });
  }

  return {
    tiers,
    medianAdpGap: Number(median(adpGaps).toFixed(1)),
    cliffRatio: Number(Math.exp(logThreshold).toFixed(2)),
  };
}

server.registerTool(
  'find_tier_breaks',
  {
    title: 'Positional tier breaks',
    description:
      'Where the value cliffs are: groups the available players at each position into tiers separated by unusually large ADP gaps, and reports how many are left in each tier and the survival probability of the last one. Answers "is this tier about to run out before my next turn?", which a ranked list does not show. Survival values here are the same calibrated marginals as get_survival — they are NOT independent, so never multiply them together to estimate whether a tier as a whole survives; describe the individual players instead.',
    inputSchema: {
      position: z
        .enum(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
        .optional()
        .describe('Restrict to one position. Omit for every position.'),
      samples: z.number().int().min(100).max(5000).optional().describe('Monte Carlo samples. Defaults to 600.'),
      gapMultiple: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "A gap is a cliff at this multiple of the position's median gap, measured proportionally. Defaults to 2.5. Lower splits more finely.",
        ),
      minAdpGap: z
        .number()
        .min(0)
        .optional()
        .describe('Absolute ADP floor below which a gap is never a tier break. Defaults to 1.'),
      maxTiers: z.number().int().min(1).max(20).optional().describe('Tiers to return per position. Defaults to 5.'),
      maxPlayersPerTier: z
        .number()
        .int()
        .min(1)
        .max(80)
        .optional()
        .describe('Players listed inside each tier. Defaults to 12; the rest are counted in playersOmitted.'),
    },
  },
  async ({ position, samples = 600, gapMultiple = 2.5, minAdpGap = 1, maxTiers = 5, maxPlayersPerTier = 12 }) =>
    respond(async () => {
      const board = await fetchBoard(samples);
      const pool = position
        ? board.survival.players.filter((player) => player.position === position)
        : board.survival.players;

      const positions = [...new Set(pool.map((player) => player.position))];
      const byPosition = {};

      for (const currentPosition of positions) {
        const players = pool.filter((player) => player.position === currentPosition);
        if (players.length < 2) {
          byPosition[currentPosition] = { note: 'Too few available to form tiers.', tiers: [] };
          continue;
        }
        const { tiers, medianAdpGap, cliffRatio } = tieriseByAdp(players, gapMultiple, minAdpGap);
        byPosition[currentPosition] = {
          availableInCandidatePool: players.length,
          medianAdpGap,
          cliffRatio,
          tierCount: tiers.length,
          tiers: tiers.slice(0, maxTiers).map((tier, index) => {
            const last = tier.players[tier.players.length - 1];
            const shown = tier.players.slice(0, maxPlayersPerTier);
            return {
              tier: index + 1,
              count: tier.players.length,
              adpRange: `${tier.players[0].adp}–${last.adp}`,
              gapAfterTier: tier.gapAfter,
              // A tier this wide is not really a tier: no gap in it cleared the
              // cliff test, so it is a smooth gradient. Saying so is more use
              // than implying the reader is indifferent across 24 players.
              shape: tier.players.length > 10 ? 'gradient — no cliffs inside this range' : 'tier',
              lastInTier: {
                fullName: last.fullName,
                adp: last.adp,
                survivalProbability: last.survivalProbability,
                verdict: last.verdict,
              },
              playersOmitted: tier.players.length - shown.length,
              players: shown.map((player) => ({
                fullName: player.fullName,
                team: player.team,
                adp: player.adp,
                byeWeek: player.byeWeek,
                injuryStatus: player.injuryStatus,
                survivalProbability: player.survivalProbability,
                verdict: player.verdict,
              })),
            };
          }),
        };
      }

      return {
        fromPick: board.survival.fromPick,
        targetPick: board.survival.targetPick,
        assumesCurrentPickSpent: board.survival.assumesCurrentPickSpent,
        yourRoster: board.yourRoster,
        requirements: board.requirements,
        note: 'Tiers are cut from the simulated candidate pool (top ~80 by ADP), so the deepest tier at a position may be truncated rather than genuinely ending.',
        positions: byPosition,
      };
    }),
);

server.registerTool(
  'compare_players',
  {
    title: 'Compare players side by side',
    description:
      'Line up two to five named players against each other: ADP, bye, injury status, calibrated survival to your next turn, the manager most likely to take each, and how each fits the positions your roster still needs. Use this instead of reading numbers back out of a long get_survival payload, which is where transcription mistakes happen. A name beyond the simulated candidate depth is returned with survival null rather than guessed at.',
    inputSchema: {
      players: z
        .array(z.string().min(1))
        .min(2)
        .max(5)
        .describe('Player names, or enough of a surname to be unambiguous.'),
      samples: z.number().int().min(100).max(5000).optional().describe('Monte Carlo samples. Defaults to 600.'),
    },
  },
  async ({ players, samples = 600 }) =>
    respond(async () => {
      const board = await fetchBoard(samples);
      const candidates = board.survival.players;

      const rows = [];
      for (const query of players) {
        const needle = query.trim().toLowerCase();
        const matches = candidates.filter((player) => player.fullName.toLowerCase().includes(needle));

        if (matches.length > 1) {
          rows.push({
            query,
            resolved: false,
            reason: 'Ambiguous.',
            candidates: matches.map((player) => `${player.fullName} (${player.position}, ADP ${player.adp})`),
          });
          continue;
        }

        if (matches.length === 1) {
          const player = matches[0];
          rows.push({
            query,
            resolved: true,
            fullName: player.fullName,
            position: player.position,
            team: player.team,
            adp: player.adp,
            byeWeek: player.byeWeek,
            injuryStatus: player.injuryStatus,
            survivalProbability: player.survivalProbability,
            rawSurvivalProbability: player.rawSurvivalProbability,
            verdict: player.verdict,
            topThreat: player.topThreat,
            fillsAnUnmetMinimum: (board.requirements?.needed ?? []).some(
              (requirement) => requirement.position === player.position && requirement.short > 0,
            ),
          });
          continue;
        }

        // Beyond the simulated candidate depth, already drafted, or not a name in
        // the pool at all — three very different situations, so say which.
        const { status, body } = await callApi(`/draft/players?q=${encodeURIComponent(query)}`);
        const available = status === 200 ? (body.players ?? []) : [];
        rows.push({
          query,
          resolved: false,
          reason:
            available.length > 0
              ? 'Available, but outside the simulated candidate pool, so no survival probability was computed for him.'
              : 'No available player matches — he is drafted already, or the name is not in the pool.',
          availableMatches: available.slice(0, 4).map((player) => ({
            fullName: player.fullName,
            position: player.position,
            adp: player.adp,
          })),
        });
      }

      const resolved = rows.filter((row) => row.resolved);
      const byes = resolved.map((row) => row.byeWeek).filter((bye) => typeof bye === 'number');
      const sharedByeWeeks = [...new Set(byes.filter((bye, index) => byes.indexOf(bye) !== index))];

      return {
        fromPick: board.survival.fromPick,
        targetPick: board.survival.targetPick,
        assumesCurrentPickSpent: board.survival.assumesCurrentPickSpent,
        picksUntilNext: board.picksUntilNext,
        yourRoster: board.yourRoster,
        requirements: board.requirements,
        sharedByeWeeks,
        players: rows,
      };
    }),
);

await server.connect(new StdioServerTransport());
