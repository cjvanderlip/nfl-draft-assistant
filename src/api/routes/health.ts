export type DependencyHealth = 'ok' | 'degraded' | 'unknown';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyHealth;
    provider: DependencyHealth;
  };
  checkedAt: string;
}

/**
 * Build a serializable health response for the API.
 *
 * @param dependencies - Current dependency health values.
 * @returns Health payload for the `/health` endpoint.
 */
export function buildHealthResponse({
  database = 'ok',
  provider = 'ok',
}: {
  database?: DependencyHealth;
  provider?: DependencyHealth;
} = {}): HealthResponse {
  const status = database === 'ok' && provider === 'ok' ? 'ok' : 'degraded';
  return {
    status,
    dependencies: { database, provider },
    checkedAt: new Date().toISOString(),
  };
}
