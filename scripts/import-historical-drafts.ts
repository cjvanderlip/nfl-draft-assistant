import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importHistoricalDraftCsv } from '../src/services/historical-draft-importer.js';

interface ImportFileResult {
  sourceFile: string;
  season: number;
  leagueId: string;
  pickCount: number;
  managerCount: number;
  playerCount: number;
  picks: Record<string, unknown>[];
  managers: Record<string, string>;
  players: Record<string, { fullName: string; position: string; team: string }>;
}

export function getSeason(fileName: string): number {
  const seasonMatch = /(20\d{2})/.exec(fileName);
  if (!seasonMatch) {
    throw new Error(`Unable to find a season in historical file name: ${fileName}`);
  }

  return Number(seasonMatch[1]);
}

function getLeagueId(fileName: string): string {
  const sourceName = path.parse(fileName).name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `historical-${sourceName}`;
}

/**
 * Import every historical CSV in a directory into a deterministic JSON snapshot.
 *
 * @param inputDirectory - Directory containing exported historical draft CSV files.
 * @param outputFile - JSON file to create with normalized import results.
 * @returns Import summaries for each processed source file.
 */
export async function importHistoricalDraftFiles(
  inputDirectory: string,
  outputFile: string,
): Promise<ImportFileResult[]> {
  const fileNames = (await readdir(inputDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith('.csv'))
    .sort();
  if (fileNames.length === 0) {
    throw new Error(`No CSV files found in historical draft directory: ${path.resolve(inputDirectory)}`);
  }
  const results: ImportFileResult[] = [];

  for (const fileName of fileNames) {
    const csvText = await readFile(path.join(inputDirectory, fileName), 'utf8');
    const season = getSeason(fileName);
    const leagueId = getLeagueId(fileName);
    const imported = importHistoricalDraftCsv(csvText, leagueId, season);

    results.push({
      sourceFile: fileName,
      season,
      leagueId,
      pickCount: imported.picks.length,
      managerCount: Object.keys(imported.managers).length,
      playerCount: Object.keys(imported.players).length,
      picks: imported.picks.map((pick) => pick.toJSON()),
      managers: imported.managers,
      players: imported.players,
    });
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputDirectory = process.argv[2] ?? 'historical-draft-data';
  const outputFile = process.argv[3] ?? 'data/historical-drafts.json';
  const resolvedOutputFile = path.resolve(outputFile);

  importHistoricalDraftFiles(inputDirectory, outputFile)
    .then((results) => {
      const pickCount = results.reduce((total, result) => total + result.pickCount, 0);
      console.log(`Imported ${pickCount} picks from ${results.length} historical files into ${resolvedOutputFile}.`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Historical draft import failed.');
      process.exitCode = 1;
    });
}
