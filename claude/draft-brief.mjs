#!/usr/bin/env node
/**
 * Pre-draft scouting brief.
 *
 * Reads the manager profiles and this season's ADP that `npm run draft:prep`
 * already wrote to `data/`, and asks Claude to turn them into something readable
 * the night before the draft. Nobody reads a 119KB JSON dump on the clock; the
 * point of this script is that the reading happens beforehand, on paper.
 *
 * It is deliberately not part of the draft-day path. It runs once, writes a
 * markdown file, and is never called again — so its network dependency and its
 * API key cannot affect a live board.
 *
 * The survival probabilities stay in the simulation. This brief describes
 * measured *tendencies* and what to expect; it must not invent numbers, which is
 * why the prompt below says so explicitly and hands over sample sizes with every
 * figure.
 *
 * Usage:
 *   node draft-brief.mjs <LEAGUE_ID> [season] [draftSlot]
 *   node draft-brief.mjs A-LEAGUE 2026 10
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dataDirectory = join(repoRoot, 'data');

const MODEL = 'claude-opus-5';

/**
 * Read the arguments this brief needs, with the defaults that match the leagues.
 *
 * @returns League id, season, and optional draft slot.
 */
function readArgs() {
  const [leagueId, season, draftSlot] = process.argv.slice(2);
  if (!leagueId) {
    throw new Error('Usage: node draft-brief.mjs <LEAGUE_ID> [season] [draftSlot]   e.g. A-LEAGUE 2026 10');
  }

  const parsedSeason = Number(season ?? new Date().getFullYear());
  if (!Number.isInteger(parsedSeason)) {
    throw new Error(`Invalid season "${season}". Expected an integer year (e.g. 2026).`);
  }

  const parsedDraftSlot = draftSlot === undefined ? undefined : Number(draftSlot);
  if (parsedDraftSlot !== undefined && (!Number.isInteger(parsedDraftSlot) || parsedDraftSlot < 1)) {
    throw new Error(`Invalid draftSlot "${draftSlot}". Expected a positive integer (e.g. 10).`);
  }

  return {
    leagueId: leagueId.trim().toUpperCase(),
    season: parsedSeason,
    draftSlot: parsedDraftSlot,
  };
}

/**
 * Load the profile set and narrow it to one league.
 *
 * @param leagueId - League to brief.
 * @returns League baseline, its managers, and when the profiles were built.
 */
async function loadProfiles(leagueId) {
  const path = join(dataDirectory, 'manager-profiles.json');
  const raw = await readFile(path, 'utf8').catch(() => {
    throw new Error(`No manager profiles at ${path}. Run "npm run profiles:build" in the repo first.`);
  });
  const parsed = JSON.parse(raw);
  const league = parsed.leagues[leagueId];
  if (!league) {
    throw new Error(`No league "${leagueId}". Known leagues: ${Object.keys(parsed.leagues).join(', ')}.`);
  }
  const managers = parsed.managers.filter((manager) => manager.leagueId === leagueId);
  return { generatedAt: parsed.generatedAt, league, managers };
}

/**
 * Load this season's ADP, trimmed to the range a 13-round draft actually reaches.
 *
 * The whole feed is more than the brief needs and dilutes the part that matters:
 * a 12-team, 13-round draft ends at pick 156, so everything past roughly 180 is
 * noise for a document about who goes where.
 *
 * @param season - Season to load.
 * @param format - ADP scoring format.
 * @param depth - How many ranked players to keep.
 * @returns Feed metadata and the trimmed player list.
 */
async function loadAdp(season, format, depth) {
  const path = join(dataDirectory, 'adp', `adp-${format}-12-${season}.json`);
  const raw = await readFile(path, 'utf8').catch(() => {
    throw new Error(`No cached ADP at ${path}. Run "npm run data:fetch" in the repo first.`);
  });
  const parsed = JSON.parse(raw);
  const players = parsed.players.slice(0, depth).map((player) => ({
    name: player.name,
    position: player.position,
    team: player.team,
    adp: player.adp,
    round: player.adp_formatted,
    bye: player.bye,
    stdev: player.stdev,
  }));
  return { meta: parsed.meta, players };
}

/**
 * Work out which picks belong to a slot in a snake draft.
 *
 * @param slot - One-based draft slot.
 * @param teams - Teams in the league.
 * @param rounds - Rounds in the draft.
 * @returns Overall pick numbers for that slot, in order.
 */
function picksForSlot(slot, teams, rounds) {
  const picks = [];
  for (let round = 1; round <= rounds; round += 1) {
    const positionInRound = round % 2 === 1 ? slot : teams - slot + 1;
    picks.push((round - 1) * teams + positionInRound);
  }
  return picks;
}

const SYSTEM_PROMPT = `You are writing a pre-draft scouting brief for a fantasy football manager, from measured data about his own league.

Hard rules about the numbers:
- Every figure you cite must come from the data you are given. Never invent a probability, a projection, or a player ranking.
- This league already has a calibrated Monte Carlo simulation that computes "will this player survive to my next turn" on draft day. That is not your job and you must not approximate it. Do not produce survival percentages.
- Reach figures are picks relative to ADP, negative meaning the manager takes players EARLIER than ADP (a reach), positive meaning later. Always state a reach with its sample size.
- \`confidence\` and \`pickCount\` say how much history is behind a manager. Thin samples are shrunk toward the league mean, so a small-sample tendency is a hint, not a fact. Say which is which — the reader needs to know when to trust a tell.
- Where the data does not support a claim, say so plainly rather than filling the gap.

What the brief is for: it is read the night before the draft and kept next to the laptop. It should make the reader faster at recognising what is happening in the room, not give him a script to follow.

Write in clear prose with headers and tables where a table genuinely helps. Be specific and concrete — name managers and players. Avoid filler, hedging boilerplate, and restating the instructions. Do not open with a preamble about what you are about to do.`;

/**
 * Build the user prompt: the data, then what to do with it.
 *
 * @param context - Everything loaded from disk plus the reader's slot.
 * @returns Prompt text.
 */
function buildPrompt(context) {
  const { leagueId, season, draftSlot, league, managers, adp, yourPicks, yourTeam, teams } = context;

  // Five seasons of turnover leave more profiles than seats, and a brief that
  // scouts a manager who left in 2021 has spent the reader's attention on
  // somebody who will not be in the room.
  const mostRecentSeason = Math.max(...managers.flatMap((manager) => manager.seasons));
  const returningCount = managers.filter((manager) => manager.seasons.includes(mostRecentSeason)).length;

  const slotSection = draftSlot
    ? `\n## Your position\n\nYou draft from slot ${draftSlot} of ${teams}${yourTeam ? ` as "${yourTeam}"` : ''}. In a snake draft that is overall picks: ${yourPicks.join(', ')}.\n\nThe draft order is not known until it is posted on the day, so you cannot say which specific managers sit between your turns. Describe instead what tends to be gone by each of your early turns, based on ADP and this league's positional timing, and which manager profiles would most threaten each type of player if they happen to land there.\n`
    : '';

  return `Write a scouting brief for the ${season} ${leagueId} draft.

${slotSection}
## League baseline (${league.seasons.join(', ')}, ${league.pickCount} picks, ${league.rounds} rounds)

This is the league-wide average that each manager below is measured against.

\`\`\`json
${JSON.stringify(league, null, 2)}
\`\`\`

## Manager profiles (${managers.length} profiles, of which ${returningCount} drafted in ${mostRecentSeason})

Derived by joining every historical pick to that season's ADP. \`reachByPosition\` gives mean reach and sample size per position; \`positionByRound\` is the share of picks spent on each position in each round; \`firstPositionRound\` is the average round of their first pick at that position; \`tells\` are the habits the model already flagged.

**This is a ${teams}-team league with more than ${teams} profiles, because managers have come and gone.** A profile whose \`seasons\` does not include ${mostRecentSeason} probably is not in this year's draft. Lead with the managers who drafted in ${mostRecentSeason}; mention a departed one only if a returning manager cannot be understood without the comparison, and say plainly that they may no longer be in the league. Do not spend the reader's ten minutes on someone who quit in 2021.

\`\`\`json
${JSON.stringify(managers, null, 2)}
\`\`\`

## This season's ADP (${adp.meta ? `${adp.players.length} players` : ''}, half-PPR, 12 team)

\`\`\`json
${JSON.stringify(adp.players, null, 2)}
\`\`\`

## What to write

1. **The room at a glance** — which managers are predictable, which are volatile, and who reaches hardest. Lead with what changes the reader's behaviour.
2. **Manager by manager** — a short entry each: their shape, their strongest tell, the round to watch them, and how much to trust it given the sample. Order them by how much they affect the reader, not alphabetically.
3. **Positional timing** — when the QB run starts in this league, when tight ends go, how the RB/WR balance shifts by round. Compare the league baseline against individual outliers.
4. **What this means at your turns** — for each of your early picks, what the data says is realistically on the board and which managers ahead of you are most likely to take what you want.
5. **Traps** — where the reader's own history (find his profile in the data) shows him reaching or drifting, and the mandatory-slot squeeze: this league scores an illegal roster as zero for the week, so a kicker and a defense must both be rostered by the end of round 13.

Keep it tight enough to read in ten minutes.`;
}

async function main() {
  const { leagueId, season, draftSlot } = readArgs();
  const dryRun = process.argv.includes('--dry-run');

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com/settings/keys, then:\n' +
      '  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
      '  bash:        export ANTHROPIC_API_KEY="sk-ant-..."',
    );
  }

  const { generatedAt, league, managers } = await loadProfiles(leagueId);
  const format = process.env.ADP_FORMAT ?? 'half-ppr';
  const adp = await loadAdp(season, format, 180);

  const teams = 12;
  const rounds = league.rounds ?? 13;
  const yourPicks = draftSlot ? picksForSlot(draftSlot, teams, rounds) : [];

  const ownerId = process.env.BRIEF_OWNER_ID;
  const yourTeam = draftSlot && ownerId
    ? managers.find((manager) => manager.ownerId === ownerId)?.teamNames[0]
    : undefined;

  const prompt = buildPrompt({ leagueId, season, draftSlot, league, managers, adp, yourPicks, yourTeam, teams });

  console.error(`Profiles built ${generatedAt}. ${managers.length} managers, ${adp.players.length} ranked players.`);

  if (dryRun) {
    console.error(`\nDry run — no API call made.`);
    console.error(`System prompt: ${SYSTEM_PROMPT.length} chars. User prompt: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens).`);
    console.error(`Your picks at slot ${draftSlot ?? '(unset)'}: ${yourPicks.join(', ') || '(no slot given)'}`);
    const full = process.env.BRIEF_FULL === '1';
    console.error(`\n--- ${full ? 'the whole user prompt' : 'first 1200 chars of the user prompt (BRIEF_FULL=1 for all of it)'} ---\n`);
    console.error(full ? prompt : prompt.slice(0, 1200));
    return;
  }

  console.error(`Asking ${MODEL} for the ${season} ${leagueId} brief…\n`);

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  stream.on('text', (text) => process.stdout.write(text));
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request (${message.stop_details?.category ?? 'unknown'}).`);
  }

  const brief = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const outputFile = join(dataDirectory, `draft-brief-${leagueId}-${season}.md`);
  const header = `# ${season} ${leagueId} scouting brief\n\n_Generated ${new Date().toISOString()} from profiles built ${generatedAt}. Tendencies are measured; survival probabilities stay in the live board._\n\n`;
  await writeFile(outputFile, header + brief, 'utf8');

  const { input_tokens: input, output_tokens: output } = message.usage;
  console.error(`\n\nWrote ${outputFile}`);
  console.error(`Tokens: ${input} in, ${output} out. Roughly $${((input * 5 + output * 25) / 1_000_000).toFixed(2)}.`);
}

main().catch((error) => {
  console.error(`\nBrief failed: ${error instanceof Error ? error.message : 'Unknown failure.'}`);
  process.exitCode = 1;
});
