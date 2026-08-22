import { assertNonEmptyString, assertObject } from '../../validators.js';
import type { DraftProvider, ProviderLeagueState } from './ingestion-service.js';

export interface CbsClientOptions {
  baseUrl: string;
  accessToken: string;
  fetchImplementation?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  normalize: (payload: unknown) => ProviderLeagueState;
}

interface CbsResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Create a CBS draft provider from an authenticated JSON endpoint and normalizer.
 *
 * @param options - CBS endpoint, access token, transport, and response normalizer.
 * @returns Draft provider suitable for live ingestion.
 */
export function createCbsDraftProvider(options: CbsClientOptions): DraftProvider {
  assertObject(options, 'options');
  assertNonEmptyString(options.baseUrl, 'options.baseUrl');
  assertNonEmptyString(options.accessToken, 'options.accessToken');
  if (typeof options.normalize !== 'function') {
    throw new TypeError('options.normalize must be a function.');
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new TypeError('options.maxRetries must be an integer between 0 and 5.');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new TypeError('options.retryDelayMs must be a non-negative number.');
  }

  return {
    async getLeagueState(leagueId: string, season: number): Promise<ProviderLeagueState> {
      assertNonEmptyString(leagueId, 'leagueId');
      let response: CbsResponse | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          response = await fetchImplementation(
            `${baseUrl}/leagues/${encodeURIComponent(leagueId)}/draft-state?season=${season}`,
            {
              headers: {
                accept: 'application/json',
                authorization: `Bearer ${options.accessToken}`,
              },
            },
          ) as CbsResponse;
        } catch (error: unknown) {
          if (attempt === maxRetries) {
            throw error;
          }
        }

        const isNonRetryableHttpFailure = response !== undefined
          && response.status >= 400
          && response.status < 500
          && response.status !== 429;
        if (response?.ok || isNonRetryableHttpFailure) {
          break;
        }
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * 2 ** attempt);
        }
      }

      if (!response) {
        throw new Error('CBS draft-state request did not return a response.');
      }

      if (!response.ok) {
        throw new Error(`CBS draft-state request failed with HTTP ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('CBS draft-state response was not valid JSON.');
      }

      return options.normalize(payload);
    },
  };
}
