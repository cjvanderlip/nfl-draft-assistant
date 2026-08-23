import { describe, expect, it } from 'vitest';

import { isUserTeam, normalizeTeamName, resolveOwner } from './owner-registry.js';

describe('resolveOwner', () => {
  it('pools the user across both leagues', () => {
    expect(resolveOwner('Northern Virginia Vandals').ownerId).toBe('owner-vandals');
    expect(resolveOwner('Deer Valley Vandals').ownerId).toBe('owner-vandals');
    expect(resolveOwner('Deer Valley Vandals').crossLeague).toBe(true);
  });

  it('pools Espanola across the leagues despite the spelling drift', () => {
    const hornets = resolveOwner('Espanola Hornets');
    expect(resolveOwner('Espanola chili').ownerId).toBe(hornets.ownerId);
    expect(resolveOwner('Espanola chile').ownerId).toBe(hornets.ownerId);
  });

  it('tolerates the trailing whitespace in the exports', () => {
    expect(resolveOwner('Roswell Aliens ').ownerId).toBe('owner-roswell-aliens');
  });

  it('gives single-league teams their own owner identity', () => {
    const owner = resolveOwner('Springfield Psycho Chickens');
    expect(owner.ownerId).toBe('owner-springfield-psycho-chickens');
    expect(owner.crossLeague).toBe(false);
    expect(owner.displayName).toBe('Springfield Psycho Chickens');
  });

  it('does not collide unrelated teams that share a word', () => {
    expect(resolveOwner('Colorado Caribou').ownerId).not.toBe(resolveOwner('Muscle Beach').ownerId);
  });
});

describe('isUserTeam', () => {
  it('recognises both Vandals teams and nobody else', () => {
    expect(isUserTeam('Northern Virginia Vandals')).toBe(true);
    expect(isUserTeam('Deer Valley Vandals')).toBe(true);
    expect(isUserTeam('Dr Evil')).toBe(false);
  });
});

describe('normalizeTeamName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTeamName('  Bear  with me ')).toBe('bear with me');
  });
});
