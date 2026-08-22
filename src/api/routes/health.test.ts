import { describe, expect, it } from 'vitest';

import { buildHealthResponse } from './health.js';

describe('buildHealthResponse', () => {
  it('reports healthy dependencies as healthy', () => {
    const response = buildHealthResponse();

    expect(response.status).toBe('ok');
    expect(response.dependencies).toEqual({ database: 'ok', provider: 'ok' });
    expect(Number.isNaN(Date.parse(response.checkedAt))).toBe(false);
  });

  it('reports a degraded status when a dependency is unavailable', () => {
    expect(buildHealthResponse({ provider: 'degraded' })).toMatchObject({
      status: 'degraded',
      dependencies: { database: 'ok', provider: 'degraded' },
    });
  });
});
