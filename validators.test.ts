import { describe, expect, it } from 'vitest';

import { League, Manager } from './draft-models.js';
import { assertNonEmptyString, assertPosition, assertScoringFormat } from './validators.js';

describe('assertNonEmptyString', () => {
  it('accepts a valid string value', () => {
    expect(() => assertNonEmptyString('BUF', 'team')).not.toThrow();
  });

  it('throws for empty strings', () => {
    expect(() => assertNonEmptyString('   ', 'team')).toThrow(TypeError);
  });
});

describe('assertPosition', () => {
  it('accepts valid fantasy positions', () => {
    expect(() => assertPosition('WR', 'position')).not.toThrow();
  });

  it('throws for invalid positions', () => {
    expect(() => assertPosition('PF', 'position')).toThrow(TypeError);
  });
});

describe('assertScoringFormat', () => {
  it('accepts valid scoring format string values', () => {
    expect(() => assertScoringFormat('PPR', 'scoringFormat')).not.toThrow();
  });

  it('throws for unsupported formats', () => {
    expect(() => assertScoringFormat('SUPERFLEX', 'scoringFormat')).toThrow(TypeError);
  });
});

describe('nested model validation', () => {
  it('throws when roster settings contain non-numeric starter counts', () => {
    expect(() => new League({
      providerLeagueId: 'league-1',
      name: 'League',
      scoringFormat: 'PPR',
      rosterSettings: { starters: { QB: 'bad' as never }, bench: 6 },
      timezone: 'UTC',
    })).toThrow(TypeError);
  });

  it('throws when tendency profile confidence is out of range', () => {
    expect(() => new Manager({
      leagueId: 'league-1',
      displayName: 'Manager',
      tendencyProfile: {
        managerId: 'manager-1',
        positionBias: { QB: { avgRound: 1, avgReach: 2, pickRate: 0.2 } },
        positionalRunPatterns: [{ pattern: 'late', frequency: 0.6, sampleYears: 3 }],
        averageReach: 3,
        confidence: 2,
        lastComputedAt: new Date().toISOString(),
      },
    })).toThrow(TypeError);
  });
});
