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
    throw new Error('No draft board is active. Open http://localhost:3005 and start a draft first.');
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

await server.connect(new StdioServerTransport());
