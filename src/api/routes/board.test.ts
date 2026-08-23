import { describe, expect, it } from 'vitest';

import { auditSetup, parseDraftResultsText } from './board.js';
import type { ManagerProfile } from '../../services/manager-profile-builder.js';

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

describe('auditSetup', () => {
  const profiles = [
    { ownerId: 'owner-vandals' },
    { ownerId: 'owner-roswell-aliens' },
    { ownerId: 'owner-dr-evil' },
  ] as ManagerProfile[];

  const order = ['Roswell Aliens', 'Dr Evil', 'Northern Virginia Vandals'];

  it('passes a draft order that resolves cleanly with your team at your slot', () => {
    const audit = auditSetup(order, 3, profiles);
    expect(audit).toEqual({ unprofiledTeams: [], slotMatchesYourTeam: true, warnings: [] });
  });

  it('names team names with no profile behind them', () => {
    const audit = auditSetup(['Roswell Alienz', 'Dr Evil', 'Northern Virginia Vandals'], 3, profiles);
    expect(audit.unprofiledTeams).toEqual(['Roswell Alienz']);
    expect(audit.warnings[0]).toMatch(/No draft history for "Roswell Alienz"/);
  });

  it('catches a slot pointing at somebody else', () => {
    const audit = auditSetup(order, 1, profiles);
    expect(audit.slotMatchesYourTeam).toBe(false);
    expect(audit.warnings[0]).toMatch(/Slot 1 is "Roswell Aliens", which is not one of your teams/);
  });

  it('recognises the other league’s Vandals team', () => {
    expect(auditSetup(['Deer Valley Vandals'], 1, profiles).slotMatchesYourTeam).toBe(true);
  });

  it('reports both problems at once', () => {
    const audit = auditSetup(['Ghost Team', 'Dr Evil'], 1, profiles);
    expect(audit.warnings).toHaveLength(2);
  });

  it('ignores blank lines left in the pasted order', () => {
    expect(auditSetup(['Dr Evil', '   ', 'Northern Virginia Vandals'], 3, profiles).unprofiledTeams).toEqual([]);
  });
});
