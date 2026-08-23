import { describe, expect, it } from 'vitest';

import { parseDraftResultsText } from './board.js';

describe('parseDraftResultsText', () => {
  it('reads the CBS CSV export rows in order', () => {
    const text = [
      'Round 1',
      'Pick,Team,Player,Elig,Elapsed Time,',
      '1,Roswell Aliens,Saquon Barkley RB | PHI ,,',
      '2,Espanola Hornets,Jahmyr Gibbs RB | DET ,,10 sec',
      "3,Oakland Blue Meanies,Ja'Marr Chase WR | CIN ,,18 sec",
    ].join('\n');

    expect(parseDraftResultsText(text)).toEqual([
      { name: 'Saquon Barkley', position: 'RB', team: 'PHI' },
      { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' },
      { name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
    ]);
  });

  it('handles kickers and defenses', () => {
    const text = [
      '1,Tulsa Trailer Trash,Eagles DST | PHI ,,33 sec',
      '2,Roswell Aliens,Brandon Aubrey K | DAL ,,11 sec',
    ].join('\n');

    expect(parseDraftResultsText(text)).toEqual([
      { name: 'Eagles', position: 'DST', team: 'PHI' },
      { name: 'Brandon Aubrey', position: 'K', team: 'DAL' },
    ]);
  });

  it('ignores headers, round markers, and blank lines', () => {
    const text = 'Round 4\n\nPick,Team,Player,Elig,Elapsed Time,\n\n1,Dr Evil,Bijan Robinson RB | ATL,,';
    expect(parseDraftResultsText(text)).toHaveLength(1);
  });

  it('reads loose grid text without the CSV scaffolding', () => {
    expect(parseDraftResultsText('Puka Nacua WR | LAR')).toEqual([
      { name: 'Puka Nacua', position: 'WR', team: 'LAR' },
    ]);
  });

  it('maps the alternate DEF label onto DST', () => {
    expect(parseDraftResultsText('1,Team,Seattle DEF | SEA,,')[0].position).toBe('DST');
  });

  it('rejects empty input', () => {
    expect(() => parseDraftResultsText('   ')).toThrow(TypeError);
  });
});
