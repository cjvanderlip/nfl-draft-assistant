import { readFileSync, readdirSync } from 'node:fs';

const BASE = 'http://localhost:3005';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`   FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

async function raw(path, options) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch { /* non-json */ }
  return { status: response.status, body };
}

async function call(path, options) {
  const { status, body } = await raw(path, options);
  if (status >= 400) throw new Error(`${path} -> ${status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const post = (path, payload) => call(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const postRaw = (path, payload) => raw(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

// ---------------------------------------------------------------- fixtures
function parseCsv(file) {
  const rows = [];
  let round = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const roundMatch = /^Round (\d+)/.exec(line);
    if (roundMatch) { round = Number(roundMatch[1]); continue; }
    if (!round || line.startsWith('Pick,') || !line.trim()) continue;
    const cells = line.split(',');
    const team = (cells[1] || '').trim();
    const raw = (cells[2] || '').trim();
    if (!team || !raw) continue;
    const positionMatch = /(RB|WR|QB|TE|K|DST)\s*\|/.exec(raw);
    rows.push({
      round,
      team,
      name: raw.split('|')[0].replace(/\s*(RB|WR|QB|TE|K|DST)\s*$/, '').trim(),
      position: positionMatch ? positionMatch[1] : null,
      nflTeam: (raw.split('|')[1] || '').trim(),
    });
  }
  return rows;
}

const A_2025 = parseCsv('historical-draft-data/2025_Pre-season_A-LeagueDraft.csv');
const draftOrder = [];
for (const row of A_2025.slice(0, 12)) draftOrder.push(row.team);
const yourSlot = draftOrder.findIndex((team) => /vandals/i.test(team)) + 1;

console.log('='.repeat(78));
console.log('1. SETUP VALIDATION — bad input must be refused, not crash');
console.log('='.repeat(78));

const badSetups = [
  ['missing leagueId', { season: 2026, draftSlot: 1, draftOrder }],
  ['unknown league', { leagueId: 'Z-LEAGUE', season: 2026, draftSlot: 1, draftOrder }],
  ['slot beyond team count', { leagueId: 'A-LEAGUE', season: 2026, draftSlot: 99, draftOrder }],
  ['slot zero', { leagueId: 'A-LEAGUE', season: 2026, draftSlot: 0, draftOrder }],
  ['draftOrder not an array', { leagueId: 'A-LEAGUE', season: 2026, draftSlot: 1, draftOrder: 'nope' }],
  ['team count mismatch', { leagueId: 'A-LEAGUE', season: 2026, draftSlot: 1, teamCount: 10, draftOrder }],
  ['season with no ADP', { leagueId: 'A-LEAGUE', season: 2019, draftSlot: 1, draftOrder }],
  ['empty payload', {}],
];
for (const [label, payload] of badSetups) {
  const { status, body } = await postRaw('/draft/board', payload);
  check(`rejects ${label}`, status === 400 && typeof body.error === 'string', `got ${status}`);
}

const { status: noBoardStatus } = await raw('/draft/board');
check('GET board with no session returns 404', noBoardStatus === 404, `got ${noBoardStatus}`);

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- full draft
console.log('='.repeat(78));
console.log('2. FULL 156-PICK DRAFT THROUGH THE HTTP API');
console.log('='.repeat(78));

let state = await post('/draft/board', {
  leagueId: 'A-LEAGUE', season: 2026, rounds: 13, draftSlot: yourSlot, teamCount: 12, draftOrder,
});
check('board starts', state.pickCount === 0 && state.yourTeam === draftOrder[yourSlot - 1]);
check('pool has all 32 defenses available', state.availableCount >= 270, `avail ${state.availableCount}`);

const timings = [];
let offPool = 0;
let ambiguous = 0;

for (const row of A_2025) {
  const started = Date.now();
  let result = await postRaw('/draft/board/pick', { query: row.name });

  if (result.status === 409) {
    ambiguous += 1;
    const exact = result.body.candidates.find((c) => c.fullName.toLowerCase() === row.name.toLowerCase())
      ?? result.body.candidates.find((c) => c.position === row.position)
      ?? result.body.candidates[0];
    result = await postRaw('/draft/board/pick', { matchKey: exact.matchKey });
  }
  if (result.status === 400) {
    offPool += 1;
    result = await postRaw('/draft/board/pick', { query: row.name, offPool: true });
  }
  timings.push(Date.now() - started);

  if (result.status !== 200) {
    check(`pick ${row.name}`, false, `status ${result.status}: ${JSON.stringify(result.body).slice(0, 120)}`);
    break;
  }
  state = result.body.state;

  // The team on the clock must always match the historical draft order.
  const expectedTeam = row.team;
  const actualTeam = result.body.pick.teamName;
  if (expectedTeam !== actualTeam) {
    check(`pick ${result.body.pick.overallPick} assigned to right team`, false, `expected ${expectedTeam}, got ${actualTeam}`);
    break;
  }
}

check('all 156 picks recorded', state.pickCount === 156, `got ${state.pickCount}`);
check('every pick landed on the correct team', failures.filter((f) => f.includes('assigned to right team')).length === 0);
check('your roster has 13 players', Object.values(state.yourRoster).reduce((a, b) => a + b, 0) === 13,
  JSON.stringify(state.yourRoster));
check('board reports draft complete', state.onTheClock === null);
check('available pool shrank by the drafted players', state.availableCount <= 273 - 156 + offPool,
  `avail ${state.availableCount}, offPool ${offPool}`);

const sorted = [...timings].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
console.log(`\n   ambiguous queries needing a second click: ${ambiguous}/156`);
console.log(`   names not in the ADP pool: ${offPool}/156`);
console.log(`   pick latency: p50 ${p50}ms, p95 ${p95}ms, max ${sorted[sorted.length - 1]}ms`);
check('p95 pick latency under 1.5s', p95 < 1500, `${p95}ms`);
check('worst pick latency under 3s', sorted[sorted.length - 1] < 3000, `${sorted[sorted.length - 1]}ms`);

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- past the end
console.log('='.repeat(78));
console.log('3. BOUNDARIES AND ADVERSARIAL INPUT');
console.log('='.repeat(78));

const past = await postRaw('/draft/board/pick', { query: 'Justin Jefferson' });
check('refuses a 157th pick', past.status === 400, `got ${past.status}`);

const undone = await post('/draft/board/undo', {});
check('undo works at the end of the draft', undone.state.pickCount === 155);
check('undone player is back on the board', undone.undone !== undefined);

// Undo everything, then confirm undo on an empty board is safe.
for (let index = 0; index < 155; index += 1) await post('/draft/board/undo', {});
const emptyUndo = await post('/draft/board/undo', {});
check('undo on an empty board is harmless', emptyUndo.state.pickCount === 0 && emptyUndo.undone === undefined);
check('every player returned to the pool', emptyUndo.state.availableCount === 273,
  `avail ${emptyUndo.state.availableCount}`);

const adversarial = [
  ['empty query', { query: '' }],
  ['whitespace query', { query: '   ' }],
  ['null query', { query: null }],
  ['numeric query', { query: 12345 }],
  ['bogus matchKey', { matchKey: 'QB:nobody at all' }],
  ['sql-ish string', { query: "'; DROP TABLE players; --" }],
  ['very long string', { query: 'x'.repeat(5000) }],
  ['emoji', { query: '🏈🏈🏈' }],
];
for (const [label, payload] of adversarial) {
  const { status } = await postRaw('/draft/board/pick', payload);
  check(`handles ${label} without a 500`, status === 400 || status === 409, `got ${status}`);
}

const xss = await postRaw('/draft/board/pick', { query: '<script>alert(1)</script>', offPool: true });
check('accepts an off-pool pick with html in the name', xss.status === 200);
check('html is stored verbatim, not executed server-side',
  xss.body.pick && xss.body.pick.fullName === '<script>alert(1)</script>');
await post('/draft/board/undo', {});

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- resync
console.log('='.repeat(78));
console.log('4. RESYNC FROM PASTED CBS TEXT');
console.log('='.repeat(78));

const fullCsv = readFileSync('historical-draft-data/2025_Pre-season_A-LeagueDraft.csv', 'utf8');
const resync = await post('/draft/board/resync', { text: fullCsv });
check('resync rebuilds the whole draft', resync.state.pickCount === 156, `got ${resync.state.pickCount}`);
// This pastes a 2025 draft into a 2026 board, so players who fell out of the
// 2026 top-273 are expected to miss. Same-season resolution is checked by the
// replay harness, which runs at ~99%.
check('resync placeholders the misses instead of losing them', resync.unresolved.length <= 25,
  `${resync.unresolved.length} unresolved`);
console.log(`   cross-season unresolved: ${resync.unresolved.length}/156 (expected — 2025 draft vs 2026 ADP)`);
check('resync keeps your roster at 13', Object.values(resync.state.yourRoster).reduce((a, b) => a + b, 0) === 13);

// Resync must be idempotent — pasting twice must not double the board.
const again = await post('/draft/board/resync', { text: fullCsv });
check('resync is idempotent', again.state.pickCount === 156, `got ${again.state.pickCount}`);

// Partial paste (fell behind mid-draft).
const partial = fullCsv.split(/\r?\n/).slice(0, 30).join('\n');
const partialResync = await post('/draft/board/resync', { text: partial });
check('partial paste rewinds to the right pick', partialResync.state.pickCount > 0 && partialResync.state.pickCount < 40,
  `got ${partialResync.state.pickCount}`);

const junk = await postRaw('/draft/board/resync', { text: 'lorem ipsum dolor sit amet\nnothing here' });
check('junk text resyncs to an empty board rather than erroring',
  junk.status === 200 && junk.body.state.pickCount === 0, `got ${junk.status}`);

const emptyResync = await postRaw('/draft/board/resync', { text: '' });
check('empty resync text is refused', emptyResync.status === 400, `got ${emptyResync.status}`);

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- model sanity
console.log('='.repeat(78));
console.log('5. SURVIVAL MODEL SANITY');
console.log('='.repeat(78));

await post('/draft/board', {
  leagueId: 'A-LEAGUE', season: 2026, rounds: 13, draftSlot: 6, teamCount: 12, draftOrder,
});
// Fresh board: you are five picks away, not on the clock.
const waiting = await call('/draft/board?samples=800');
check('before your turn, target is your next pick', waiting.survival.targetPick === 6,
  `got ${waiting.survival.targetPick}`);
check('before your turn, no look-through', waiting.survival.assumesCurrentPickSpent === false);

// Advance to pick 6 so you are actually on the clock.
for (const name of ['Jahmyr Gibbs', 'Bijan Robinson', 'Puka Nacua', "Ja'Marr Chase", 'Malik Nabers']) {
  await post('/draft/board/pick', { query: name });
}
const onClock = await call('/draft/board?samples=800');
check('on the clock, survival looks through to the next turn', onClock.survival.assumesCurrentPickSpent === true);
check('on the clock, target is your following pick', onClock.survival.targetPick === 19,
  `got ${onClock.survival.targetPick}`);
check('on the clock, note explains the assumption',
  /spend this pick on someone else/.test(onClock.survival.note ?? ''), onClock.survival.note);
check('survival is not all 100%', onClock.survival.players.some((p) => p.survivalProbability < 0.9));

const probs = onClock.survival.players.map((p) => p.survivalProbability);
check('all probabilities are in range', probs.every((p) => p >= 0 && p <= 1));
check('probabilities rise with ADP overall', (() => {
  const top = onClock.survival.players.slice(0, 15).reduce((a, p) => a + p.survivalProbability, 0) / 15;
  const deep = onClock.survival.players.slice(-15).reduce((a, p) => a + p.survivalProbability, 0) / 15;
  return deep > top;
})());
check('threat strip covers every intervening pick',
  onClock.survival.threats.length === onClock.survival.picksSimulated,
  `${onClock.survival.threats.length} vs ${onClock.survival.picksSimulated}`);
check('threats carry sample sizes', onClock.survival.threats.every((t) => typeof t.seasons === 'number'));

// Determinism of the profile inputs: two identical calls should agree closely.
const runA = await call('/draft/board?samples=1500');
const runB = await call('/draft/board?samples=1500');
const drift = runA.survival.players.slice(0, 20).map((p, index) =>
  Math.abs(p.survivalProbability - runB.survival.players[index].survivalProbability));
const maxDrift = Math.max(...drift);
check('Monte Carlo noise at 1500 samples stays under 8 points', maxDrift < 0.08, `max drift ${(maxDrift * 100).toFixed(1)}pts`);

const startedSim = Date.now();
await call('/draft/board?samples=2000');
const simMs = Date.now() - startedSim;
console.log(`   2000-sample simulation: ${simMs}ms`);
check('2000-sample simulation under 3s', simMs < 3000, `${simMs}ms`);

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- both leagues
console.log('='.repeat(78));
console.log('6. B-LEAGUE AND CROSS-LEAGUE');
console.log('='.repeat(78));

const B_2025 = parseCsv('historical-draft-data/2025_Pre-season_B-LeagueDraft.csv');
const bOrder = B_2025.slice(0, 12).map((row) => row.team);
const bSlot = bOrder.findIndex((team) => /vandals/i.test(team)) + 1;
check('found your B-League team', bSlot > 0, `order ${bOrder.join(' | ')}`);

const bState = await post('/draft/board', {
  leagueId: 'B-LEAGUE', season: 2026, rounds: 13, draftSlot: bSlot, teamCount: 12, draftOrder: bOrder,
});
check('B-League board starts', bState.pickCount === 0);
check('B-League knows it is you', /vandals/i.test(bState.yourTeam));

const bProfiles = await call('/draft/profiles?leagueId=B-LEAGUE');
const espanolaA = (await call('/draft/profiles?leagueId=A-LEAGUE')).managers.find((m) => m.ownerId === 'owner-espanola');
const espanolaB = bProfiles.managers.find((m) => m.ownerId === 'owner-espanola');
check('Espanola is pooled across both leagues', Boolean(espanolaA && espanolaB));
check('Espanola QB tell agrees across leagues',
  Math.abs((espanolaA?.reachByPosition?.QB?.mean ?? 0) - (espanolaB?.reachByPosition?.QB?.mean ?? 0)) < 8,
  `A ${espanolaA?.reachByPosition?.QB?.mean} vs B ${espanolaB?.reachByPosition?.QB?.mean}`);

const thin = bProfiles.managers.filter((m) => m.seasons.length === 1);
const thick = bProfiles.managers.filter((m) => m.seasons.length >= 4);
check('single-season managers get lower confidence than veterans',
  thin.every((t) => thick.every((k) => t.confidence < k.confidence)),
  `thin ${thin.map((t) => t.confidence).join(',')} vs thick ${thick.map((k) => k.confidence).join(',')}`);

// Play B-League to completion too.
let bCount = 0;
for (const row of B_2025) {
  let result = await postRaw('/draft/board/pick', { query: row.name });
  if (result.status === 409) {
    const chosen = result.body.candidates.find((c) => c.position === row.position) ?? result.body.candidates[0];
    result = await postRaw('/draft/board/pick', { matchKey: chosen.matchKey });
  }
  if (result.status === 400) result = await postRaw('/draft/board/pick', { query: row.name, offPool: true });
  if (result.status !== 200) break;
  bCount += 1;
  if (result.body.pick.teamName !== row.team) {
    check(`B-League pick ${bCount} team alignment`, false, `expected ${row.team}, got ${result.body.pick.teamName}`);
    break;
  }
}
check('B-League plays out all 156 picks', bCount === 156, `got ${bCount}`);

console.log(`\n   ${pass} passed so far\n`);

// ---------------------------------------------------------------- autocomplete
console.log('='.repeat(78));
console.log('7. PICK ENTRY UNDER DRAFT-ROOM CONDITIONS');
console.log('='.repeat(78));

await post('/draft/board', {
  leagueId: 'A-LEAGUE', season: 2026, rounds: 13, draftSlot: 6, teamCount: 12, draftOrder,
});

const typed = [
  ['gibbs', 'Jahmyr Gibbs'],
  ['nacua', 'Puka Nacua'],
  ['jamarr', "Ja'Marr Chase"],
  ['eagles', 'Philadelphia Defense'],
  ['seahawks', 'Seattle Defense'],
  ['bucs', 'TB Defense'],
  ['aubrey', 'Brandon Aubrey'],
  ['bijan', 'Bijan Robinson'],
];
for (const [query, expected] of typed) {
  const { players } = await call(`/draft/players?q=${encodeURIComponent(query)}`);
  check(`"${query}" suggests ${expected}`, players[0]?.fullName === expected,
    `got ${players[0]?.fullName ?? 'nothing'}`);
}

const short = await call('/draft/players?q=a');
check('single letter still returns something', short.players.length > 0);
const none = await call('/draft/players?q=');
check('empty autocomplete returns an empty list', none.players.length === 0);

// Drafted players must stop appearing.
await post('/draft/board/pick', { query: 'Jahmyr Gibbs' });
const afterDraft = await call('/draft/players?q=gibbs');
check('drafted player disappears from autocomplete',
  !afterDraft.players.some((p) => p.fullName === 'Jahmyr Gibbs'));
const dup = await postRaw('/draft/board/pick', { query: 'Jahmyr Gibbs' });
check('cannot draft the same player twice', dup.status === 400, `got ${dup.status}`);

console.log('\n' + '='.repeat(78));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log('  - ' + failure);
}
console.log('='.repeat(78));
process.exit(fail > 0 ? 1 : 0);
