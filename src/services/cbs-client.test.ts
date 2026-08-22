import { describe, expect, it } from 'vitest';

import { createCbsDraftProvider } from './cbs-client.js';
import type { ProviderLeagueState } from './ingestion-service.js';

const normalizedState = {} as ProviderLeagueState;

describe('createCbsDraftProvider', () => {
  it('requests a league state with bearer authentication and normalizes the payload', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const provider = createCbsDraftProvider({
      baseUrl: 'https://cbs.example.test/',
      accessToken: 'token',
      fetchImplementation: async (input, init) => {
        requestUrl = input.toString();
        requestInit = init;
        return new Response(JSON.stringify({ state: 'raw' }), { status: 200 });
      },
      normalize: (payload) => {
        expect(payload).toEqual({ state: 'raw' });
        return normalizedState;
      },
    });

    await expect(provider.getLeagueState('league/1', 2025)).resolves.toBe(normalizedState);
    expect(requestUrl).toBe('https://cbs.example.test/leagues/league%2F1/draft-state?season=2025');
    expect(requestInit?.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'Bearer token',
    });
  });

  it('throws a useful error for an upstream failure', async () => {
    const provider = createCbsDraftProvider({
      baseUrl: 'https://cbs.example.test',
      accessToken: 'token',
      fetchImplementation: async () => new Response('', { status: 503 }),
      normalize: () => normalizedState,
    });

    await expect(provider.getLeagueState('league-1', 2025))
      .rejects.toThrow('HTTP 503');
  });

  it('retries transient failures with exponential backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const provider = createCbsDraftProvider({
      baseUrl: 'https://cbs.example.test',
      accessToken: 'token',
      maxRetries: 2,
      retryDelayMs: 10,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      fetchImplementation: async () => {
        attempts += 1;
        return attempts < 3
          ? new Response('', { status: 503 })
          : new Response('{}', { status: 200 });
      },
      normalize: () => normalizedState,
    });

    await expect(provider.getLeagueState('league-1', 2025)).resolves.toBe(normalizedState);
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });
});
