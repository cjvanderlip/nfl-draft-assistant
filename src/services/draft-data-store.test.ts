import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAdpFreshness } from './draft-data-store.js';

let directory: string;

async function writeAdp(meta: Record<string, unknown> | undefined): Promise<void> {
  await mkdir(join(directory, 'adp'), { recursive: true });
  await writeFile(
    join(directory, 'adp', 'adp-ppr-12-2026.json'),
    JSON.stringify({ status: 'Success', meta, players: [] }),
    'utf8',
  );
}

const draftDay = (): Date => new Date('2026-08-29T12:00:00.000Z');

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wingman-adp-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('loadAdpFreshness', () => {
  it('dates the feed by the drafts it sampled, not the file', async () => {
    await writeAdp({ end_date: '2026-08-22', total_drafts: 7288 });

    expect(await loadAdpFreshness(2026, { dataDirectory: directory }, draftDay)).toEqual({
      format: 'ppr',
      teams: 12,
      sampledThrough: '2026-08-22',
      ageInDays: 7,
      draftsSampled: 7288,
      stale: true,
    });
  });

  it('treats a feed sampled within three days as current', async () => {
    await writeAdp({ end_date: '2026-08-27' });
    const freshness = await loadAdpFreshness(2026, { dataDirectory: directory }, draftDay);

    expect(freshness?.ageInDays).toBe(2);
    expect(freshness?.stale).toBe(false);
  });

  it('does not call a feed stale when it cannot date it', async () => {
    await writeAdp({ total_drafts: 12 });
    const freshness = await loadAdpFreshness(2026, { dataDirectory: directory }, draftDay);

    expect(freshness?.ageInDays).toBeUndefined();
    expect(freshness?.stale).toBe(false);
  });

  it('reports the format and league size it was asked for', async () => {
    await mkdir(join(directory, 'adp'), { recursive: true });
    await writeFile(
      join(directory, 'adp', 'adp-half-ppr-10-2026.json'),
      JSON.stringify({ meta: { end_date: '2026-08-28' }, players: [] }),
      'utf8',
    );

    const freshness = await loadAdpFreshness(
      2026,
      { dataDirectory: directory, format: 'half-ppr', teams: 10 },
      draftDay,
    );
    expect(freshness).toMatchObject({ format: 'half-ppr', teams: 10, ageInDays: 1 });
  });

  it('returns undefined when the season has no cached file', async () => {
    expect(await loadAdpFreshness(2027, { dataDirectory: directory }, draftDay)).toBeUndefined();
  });

  it('never reports a negative age for a feed sampled after today', async () => {
    await writeAdp({ end_date: '2026-09-05' });
    expect((await loadAdpFreshness(2026, { dataDirectory: directory }, draftDay))?.ageInDays).toBe(0);
  });
});
