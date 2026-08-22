import { describe, expect, it } from 'vitest';

import { getSeason } from './import-historical-drafts.js';

describe('importHistoricalDraftFiles', () => {
  it('extracts seasons from underscore-delimited filenames', () => {
    expect(getSeason('2021_Pre-season_B-LeagueDraft.csv')).toBe(2021);
  });
});
