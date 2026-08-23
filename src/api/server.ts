import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBoardState,
  describeSavedBoard,
  discardSavedBoard,
  hasActiveBoard,
  restoreBoard,
  resyncFromText,
  startBoard,
  submitPick,
  suggestPlayers,
  undoPick,
} from './routes/board.js';
import { loadAdpFreshness, loadManagerProfiles } from '../services/draft-data-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the `public/` directory by walking up from this module.
 *
 * Counting a fixed number of parent directories only works from one build layout:
 * compiled, this file sits at `dist/src/api/`, but run straight from TypeScript it
 * sits at `src/api/`, one level shallower, and the same count lands outside the
 * repository entirely — the UI 404s while the API keeps answering.
 *
 * @returns Absolute path to `public/`, falling back to the compiled layout.
 */
function locatePublicDir(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'public');
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return join(__dirname, '..', '..', '..', 'public');
}

const publicDir = locatePublicDir();

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function getContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

async function serveStaticAsset(pathname: string): Promise<{ statusCode: number; contentType: string; body: Buffer } | null> {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = normalizedPath.replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) {
    return null;
  }

  const candidatePath = normalize(join(publicDir, relativePath));
  if (!candidatePath.startsWith(publicDir)) {
    return null;
  }

  try {
    const body = await readFile(candidatePath);
    return { statusCode: 200, contentType: getContentType(candidatePath), body };
  } catch {
    return null;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (body.length === 0) {
    throw new TypeError('Request body must not be empty.');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TypeError('Request body must be valid JSON.');
  }
}

/**
 * Clamp a requested simulation sample count into a sane range.
 *
 * The board runs a fresh simulation on every pick, so the default is tuned for a
 * response that lands before the next name is typed. A deliberate deep run trades
 * that latency for a steadier number on a close call.
 *
 * @param raw - Raw `samples` query parameter.
 * @returns Sample count to simulate with.
 */
function readSampleCount(raw: string | null): number {
  const parsed = Number(raw ?? '600');
  if (!Number.isFinite(parsed)) {
    return 600;
  }
  return Math.max(100, Math.min(Math.round(parsed), 5000));
}

/**
 * Route one request to the draft-day API.
 *
 * `TypeError` is the vocabulary the draft services use for bad input, so every
 * handler maps it to a 400 with the thrown message. Anything else is a genuine
 * fault and propagates to the 500 handler.
 *
 * @param request - Incoming request.
 * @param response - Response to write.
 */
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  const handle = async (run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  };

  if (request.method === 'POST' && pathname === '/draft/board') {
    await handle(async () => {
      writeJson(response, 201, await startBoard(await readJsonBody(request)));
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/draft/board') {
    if (!hasActiveBoard()) {
      writeJson(response, 404, { error: 'No draft board is active. Start one with POST /draft/board.' });
      return;
    }
    writeJson(response, 200, buildBoardState(readSampleCount(searchParams.get('samples'))));
    return;
  }

  if (request.method === 'GET' && pathname === '/draft/board/saved') {
    const saved = await describeSavedBoard();
    if (!saved) {
      writeJson(response, 404, { error: 'No saved draft board.' });
      return;
    }
    writeJson(response, 200, saved);
    return;
  }

  if (request.method === 'POST' && pathname === '/draft/board/restore') {
    const restored = await restoreBoard();
    if (!restored) {
      writeJson(response, 404, { error: 'No saved draft board could be restored.' });
      return;
    }
    writeJson(response, 200, restored);
    return;
  }

  if (request.method === 'POST' && pathname === '/draft/board/discard') {
    await discardSavedBoard();
    writeJson(response, 200, { discarded: true });
    return;
  }

  if (request.method === 'POST' && pathname === '/draft/board/pick') {
    await handle(async () => {
      const result = submitPick(await readJsonBody(request));
      if (!result.state) {
        writeJson(response, 409, {
          error: 'That query matches more than one available player.',
          candidates: result.candidates,
        });
        return;
      }
      writeJson(response, 200, result);
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/draft/board/undo') {
    await handle(() => {
      writeJson(response, 200, undoPick());
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/draft/board/resync') {
    await handle(async () => {
      writeJson(response, 200, resyncFromText(await readJsonBody(request)));
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/draft/players') {
    await handle(() => {
      writeJson(response, 200, { players: suggestPlayers(searchParams.get('q') ?? '', 8) });
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/draft/data-status') {
    const season = Number(searchParams.get('season') ?? new Date().getFullYear());
    const [adp, profileSet] = await Promise.all([
      Number.isFinite(season) ? loadAdpFreshness(season) : Promise.resolve(undefined),
      loadManagerProfiles(),
    ]);
    writeJson(response, 200, {
      season,
      adp,
      profilesGeneratedAt: profileSet?.generatedAt,
      boardActive: hasActiveBoard(),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/draft/profiles') {
    const profileSet = await loadManagerProfiles();
    if (!profileSet) {
      writeJson(response, 404, { error: 'No manager profiles on disk. Run "npm run profiles:build" first.' });
      return;
    }
    const leagueId = searchParams.get('leagueId')?.trim().toUpperCase();
    writeJson(response, 200, {
      generatedAt: profileSet.generatedAt,
      leagues: profileSet.leagues,
      managers: leagueId
        ? profileSet.managers.filter((manager) => manager.leagueId === leagueId)
        : profileSet.managers,
    });
    return;
  }

  writeJson(response, 404, { error: 'Route not found.' });
}

/**
 * Create the draft-day HTTP server.
 *
 * Serves the board UI from `public/` and the draft-day API. There is no database,
 * no scheduler and no external provider: everything the board needs was written to
 * `data/` by `npm run draft:prep`, which is what makes a live draft survivable.
 *
 * @returns An unstarted Node HTTP server.
 */
export function createApiServer(): Server {
  return createServer(async (request, response) => {
    if (request.method === 'GET') {
      const staticAsset = await serveStaticAsset(request.url ?? '/');
      if (staticAsset) {
        response.writeHead(staticAsset.statusCode, { 'content-type': staticAsset.contentType });
        response.end(staticAsset.body);
        return;
      }
    }

    void handleRequest(request, response).catch((error: unknown) => {
      console.error('API request failed.', error);
      if (!response.headersSent) {
        writeJson(response, 500, { error: 'Internal server error.' });
      }
    });
  });
}
