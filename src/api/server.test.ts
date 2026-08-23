import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApiServer } from './server.js';
import { resetBoardSession } from './routes/board.js';

let server: Server;
let baseUrl: string;

async function call(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const response = await fetch(baseUrl + path, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

beforeEach(async () => {
  resetBoardSession();
  server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  resetBoardSession();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('createApiServer', () => {
  it('serves the board UI at the root', async () => {
    const response = await fetch(baseUrl + '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(await response.text()).toMatch(/War Room Wingman/);
  });

  it('refuses to serve files outside the public directory', async () => {
    const response = await fetch(baseUrl + '/../package.json');
    expect(response.status).toBe(404);
  });

  it('404s an unknown route', async () => {
    expect((await call('/nope')).status).toBe(404);
  });

  it('404s the retired prototype routes', async () => {
    for (const path of [
      '/health',
      '/metrics',
      '/metrics/alerts',
      '/ops/runbook-checks',
      '/predictions/backtest',
      '/heuristics/score',
      '/roster/recommendations',
      '/leagues/A-LEAGUE/snapshot',
    ]) {
      expect((await call(path)).status, path).toBe(404);
    }
  });

  it('reports no active board before one is started', async () => {
    const result = await call('/draft/board');
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/No draft board is active/);
  });

  it('rejects a board request with no body', async () => {
    const response = await fetch(baseUrl + '/draft/board', { method: 'POST' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/must not be empty/);
  });

  it('rejects malformed JSON as a 400 rather than a crash', async () => {
    const response = await fetch(baseUrl + '/draft/board', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/valid JSON/);
  });

  it('maps a validation failure to a 400 carrying the reason', async () => {
    const result = await call('/draft/board', { method: 'POST', body: { leagueId: '' } });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/leagueId/);
  });

  it('reports data status without an active board', async () => {
    const result = await call('/draft/data-status?season=2026');
    expect(result.status).toBe(200);
    expect(result.body.season).toBe(2026);
    expect(result.body.boardActive).toBe(false);
  });

  it('serves manager profiles and filters them by league', async () => {
    const result = await call('/draft/profiles?leagueId=A-LEAGUE');
    expect(result.status).toBe(200);
    expect(result.body.managers.length).toBeGreaterThan(0);
    expect(result.body.managers.every((m: { leagueId: string }) => m.leagueId === 'A-LEAGUE')).toBe(true);
  });

  it('requires an active board for pick entry and autocomplete', async () => {
    expect((await call('/draft/players?q=chase')).status).toBe(400);
    expect((await call('/draft/board/pick', { method: 'POST', body: { query: 'x' } })).status).toBe(400);
    expect((await call('/draft/board/undo', { method: 'POST' })).status).toBe(400);
  });

  it('reports no saved board when none was left behind', async () => {
    // discard first, so a snapshot from another run cannot make this pass or fail
    // for the wrong reason.
    await call('/draft/board/discard', { method: 'POST' });
    expect((await call('/draft/board/saved')).status).toBe(404);
    expect((await call('/draft/board/restore', { method: 'POST' })).status).toBe(404);
  });

  it('always answers the discard request', async () => {
    const result = await call('/draft/board/discard', { method: 'POST' });
    expect(result.status).toBe(200);
    expect(result.body.discarded).toBe(true);
  });
});
