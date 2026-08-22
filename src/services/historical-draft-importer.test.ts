import { describe, expect, it } from 'vitest';

import { importHistoricalDraftCsv } from './historical-draft-importer.js';

const csv = `Round 1
Pick,Team,Player,Elig,Elapsed Time,
1,Roswell Aliens,Saquon Barkley RB | PHI ,,
2,Espanola Hornets,Jahmyr Gibbs RB | DET ,,10 sec

Round 2
Pick,Team,Player,Elig,Elapsed Time,
3,Roswell Aliens,Saquon Barkley RB | PHI ,,`;

describe('importHistoricalDraftCsv', () => {
  it('parses rounds and normalizes manager and player identities', () => {
    const result = importHistoricalDraftCsv(csv, ' league-1 ', 2025);

    expect(result.picks).toHaveLength(3);
    expect(result.picks.map((pick) => pick.round)).toEqual([1, 1, 2]);
    expect(result.picks.map((pick) => pick.overallPick)).toEqual([1, 2, 15]);
    expect(result.picks[0]).toMatchObject({
      leagueId: 'league-1',
      overallPick: 1,
      managerId: 'manager-roswell-aliens',
      playerId: 'player-saquon-barkley',
    });
    expect(result.players['player-saquon-barkley']).toEqual({
      fullName: 'Saquon Barkley',
      position: 'RB',
      team: 'PHI',
    });
    expect(Object.keys(result.managers)).toEqual(['manager-roswell-aliens', 'manager-espanola-hornets']);
  });

  it('rejects rows with an invalid player descriptor', () => {
    expect(() => importHistoricalDraftCsv(
      'Round 1\nPick,Team,Player\n1,Manager,Unknown Player',
      'league-1',
      2025,
    )).toThrow('must match "Name POS | TEAM"');
  });

  it('normalizes historical rows with a missing team', () => {
    const result = importHistoricalDraftCsv(
      'Round 1\nPick,Team,Player\n1,Manager,Dalvin Cook RB |',
      'league-1',
      2025,
    );

    expect(result.players['player-dalvin-cook']).toMatchObject({ team: 'UNKNOWN' });
  });

  it('accepts multi-position player descriptors', () => {
    const result = importHistoricalDraftCsv(
      'Round 1\nPick,Team,Player\n1,Manager,"Taysom Hill QB,TE | NO"',
      'league-1',
      2025,
    );

    expect(result.players['player-taysom-hill']).toMatchObject({ position: 'QB', team: 'NO' });
  });
});
