import { assertNonEmptyString, assertNumberInRange, assertObject } from '../../validators.js';

/**
 * One pick read out of a CBS draft export.
 *
 * A plain record rather than a modelled entity: nothing downstream mutates a pick
 * or asks it to validate itself — `loadHistoricalPicks` reads the round, the
 * overall number, and the two ids, and builds manager profiles from them.
 */
export interface HistoricalDraftPick {
  id: string;
  leagueId: string;
  season: number;
  round: number;
  overallPick: number;
  managerId: string;
  playerId: string;
  pickedAt: string;
}

export interface HistoricalDraftImport {
  picks: HistoricalDraftPick[];
  managers: Record<string, string>;
  players: Record<string, { fullName: string; position: string; team: string }>;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let insideQuotes = false;

  for (const character of line) {
    if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === ',' && !insideQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += character;
    }
  }

  if (insideQuotes) {
    throw new TypeError('Historical draft CSV contains an unterminated quoted field.');
  }

  fields.push(field.trim());
  return fields;
}

function createStableId(prefix: string, value: string): string {
  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${prefix}-${normalizedValue}`;
}

/**
 * Import a historical draft CSV into canonical draft records.
 *
 * @param csvText - CSV content exported from a historical draft.
 * @param leagueId - League identifier to assign to every imported pick.
 * @param season - Season represented by the export.
 * @returns Normalized picks plus manager and player lookup records.
 */
export function importHistoricalDraftCsv(
  csvText: string,
  leagueId: string,
  season: number,
): HistoricalDraftImport {
  assertNonEmptyString(csvText, 'csvText');
  assertNonEmptyString(leagueId, 'leagueId');
  assertNumberInRange(season, 'season', 2000, 2100);

  const picks: HistoricalDraftPick[] = [];
  const managers: Record<string, string> = {};
  const players: Record<string, { fullName: string; position: string; team: string }> = {};
  let currentRound: number | undefined;

  for (const [lineIndex, line] of csvText.split(/\r?\n/).entries()) {
    const trimmedLine = line.replace(/^\uFEFF/, '').trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    const roundMatch = /^Round\s+(\d+)$/i.exec(trimmedLine);
    if (roundMatch) {
      currentRound = Number(roundMatch[1]);
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields[0].toLowerCase() === 'pick') {
      continue;
    }

    if (currentRound === undefined || fields.length < 3) {
      throw new TypeError(`Historical draft CSV has an invalid row at line ${lineIndex + 1}.`);
    }

    const roundPick = Number(fields[0]);
    const managerName = fields[1];
    const playerDescriptor = fields[2];
    if (!Number.isInteger(roundPick) || roundPick < 1) {
      throw new TypeError(`Historical draft CSV pick at line ${lineIndex + 1} must be a positive integer.`);
    }
    const overallPick = (currentRound - 1) * 12 + roundPick;
    assertNonEmptyString(managerName, `historical CSV manager at line ${lineIndex + 1}`);
    assertNonEmptyString(playerDescriptor, `historical CSV player at line ${lineIndex + 1}`);

    const descriptorParts = playerDescriptor.split('|');
    if (descriptorParts.length !== 2) {
      throw new TypeError(`Historical draft CSV player at line ${lineIndex + 1} must match "Name POS | TEAM".`);
    }
    const [nameAndPositions, rawTeam] = descriptorParts;
    const positionMatch = /\s+(QB|RB|WR|TE|K|DST)(?:\s*,\s*(?:QB|RB|WR|TE|K|DST))*\s*$/i.exec(nameAndPositions);
    if (!positionMatch) {
      throw new TypeError(`Historical draft CSV player at line ${lineIndex + 1} must match "Name POS | TEAM".`);
    }

    const fullName = nameAndPositions.slice(0, positionMatch.index).trim();
    const position = positionMatch[1].toUpperCase();
    const team = rawTeam.trim().toUpperCase() || 'UNKNOWN';
    if (!fullName) {
      throw new TypeError(`Historical draft CSV player at line ${lineIndex + 1} must include a name.`);
    }
    const managerId = createStableId('manager', managerName);
    const playerId = createStableId('player', fullName);

    managers[managerId] = managerName;
    players[playerId] = { fullName, position, team };
    picks.push({
      id: createStableId('pick', `${leagueId}-${season}-${overallPick}`),
      leagueId: leagueId.trim(),
      season,
      round: currentRound,
      overallPick,
      managerId,
      playerId,
      pickedAt: new Date(0).toISOString(),
    });
  }

  assertObject(managers, 'managers');
  return { picks, managers, players };
}
