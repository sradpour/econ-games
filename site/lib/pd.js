// Prisoner's dilemma helpers for the browser: house strategies, sandboxed test runs and the tournament.

export const HOUSE = [
  { id: 'house:tft', name: 'Tit for Tat', blurb: 'Cooperates first, then copies your last move.',
    code: `function strategy(myMoves, theirMoves, round) {\n  if (round === 1) return "C";\n  return theirMoves[theirMoves.length - 1];\n}` },
  { id: 'house:alld', name: 'Always Defect', blurb: 'Defects every round.',
    code: `function strategy() { return "D"; }` },
  { id: 'house:allc', name: 'Always Cooperate', blurb: 'Cooperates every round.',
    code: `function strategy() { return "C"; }` },
  { id: 'house:grim', name: 'Grim Trigger', blurb: 'Cooperates until you defect once, then defects forever.',
    code: `function strategy(myMoves, theirMoves) {\n  return theirMoves.includes("D") ? "D" : "C";\n}` },
  { id: 'house:random', name: 'Random', blurb: 'Flips a coin every round.',
    code: `function strategy() { return Math.random() < 0.5 ? "C" : "D"; }` },
  { id: 'house:tf2t', name: 'Tit for Two Tats', blurb: 'Only defects after you defect twice in a row.',
    code: `function strategy(myMoves, theirMoves) {\n  const n = theirMoves.length;\n  return n >= 2 && theirMoves[n - 1] === "D" && theirMoves[n - 2] === "D" ? "D" : "C";\n}` },
  { id: 'house:stft', name: 'Suspicious Tit for Tat', blurb: 'Defects first, then copies your last move.',
    code: `function strategy(myMoves, theirMoves, round) {\n  if (round === 1) return "D";\n  return theirMoves[theirMoves.length - 1];\n}` },
  { id: 'house:pavlov', name: 'Pavlov', blurb: 'Repeats its last move if it scored well, switches if not.',
    code: `function strategy(myMoves, theirMoves, round) {\n  if (round === 1) return "C";\n  const me = myMoves[myMoves.length - 1], them = theirMoves[theirMoves.length - 1];\n  return me === them ? "C" : "D";\n}` },
  { id: 'house:alt', name: 'Alternator', blurb: 'Alternates C, D, C, D…',
    code: `function strategy(myMoves, theirMoves, round) { return round % 2 === 1 ? "C" : "D"; }` },
];

/** Students never see the built-in strategies' names: they are "Computer 1", "Computer 2"… */
export const computerName = (i) => `Computer ${i + 1}`;

export const payoffsFrom = (cfg = {}) => ({
  T: Number(cfg.payoff_T ?? 5), R: Number(cfg.payoff_R ?? 3), P: Number(cfg.payoff_P ?? 1), S: Number(cfg.payoff_S ?? 0),
});

const workerUrl = new URL('../worker/strategy-worker.js', import.meta.url);
let seq = 0;

/** Run matches in a fresh worker, killing it if it takes too long (e.g. an infinite loop). */
export function runInWorker(entrants, matches, payoffs, { timeoutMs = 8000, onProgress, type = 'run' } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl);
    const id = ++seq;
    const timer = setTimeout(() => { w.terminate(); reject(new Error('The strategy took too long (possible endless loop).')); }, timeoutMs);
    w.onmessage = (ev) => {
      if (ev.data.id !== id) return;
      if (ev.data.progress !== undefined) { onProgress?.(ev.data.progress); return; }
      clearTimeout(timer); w.terminate();
      if (ev.data.ok) resolve(ev.data.results ?? true); else reject(new Error(ev.data.error));
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'Worker error')); };
    w.postMessage({ id, type, entrants, matches, payoffs });
  });
}

export const randomLength = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/** Test a team's code against house strategies (and itself). */
export async function testStrategy(code, cfg, opponents = HOUSE.map((h) => h.id)) {
  const p = payoffsFrom(cfg);
  const min = Number(cfg.min_rounds ?? 10), max = Number(cfg.max_rounds ?? 20);
  await runInWorker([{ id: 'me', code }], [], p, { type: 'check', timeoutMs: 3000 });
  const entrants = [{ id: 'me', code }, { id: 'me2', code }, ...HOUSE.filter((h) => opponents.includes(h.id))];
  const matches = opponents.map((o) => ({ a: 'me', b: o, length: randomLength(min, max) }));
  matches.push({ a: 'me', b: 'me2', length: randomLength(min, max) });
  return runInWorker(entrants, matches, p, { timeoutMs: 5000 });
}

/**
 * Official round-robin tournament. entrants: [{id, name, code}].
 * Every pair plays `repeats` matches; each repetition uses one random length shared by all pairs.
 */
export async function runTournament(entrants, cfg, onProgress) {
  const p = payoffsFrom(cfg);
  const min = Number(cfg.min_rounds ?? 10), max = Number(cfg.max_rounds ?? 20);
  const repeats = Math.max(1, Number(cfg.repeats ?? 3));

  // 1. Screen each strategy alone so one broken entry cannot spoil the whole run.
  const screened = [];
  for (const e of entrants) {
    let problem = null;
    try {
      await runInWorker([{ id: 'x', code: e.code }, HOUSE[0]], [{ a: 'x', b: HOUSE[0].id, length: max }], p, { timeoutMs: 3000 });
    } catch (err) { problem = err.message; }
    screened.push({ ...e, disqualified: problem, code: problem ? HOUSE[2].code : e.code });
  }

  // 2. Round robin
  const lengths = Array.from({ length: repeats }, () => randomLength(min, max));
  const matches = [];
  for (let rep = 0; rep < repeats; rep++) {
    for (let i = 0; i < screened.length; i++) {
      for (let j = i + 1; j < screened.length; j++) {
        matches.push({ a: screened[i].id, b: screened[j].id, rep: rep + 1, length: lengths[rep] });
      }
    }
  }
  const results = matches.length
    ? await runInWorker(screened.map((e) => ({ id: e.id, code: e.code })), matches, p, { timeoutMs: 60000, onProgress })
    : [];

  // 3. Scores
  const score = Object.fromEntries(screened.map((e) => [e.id, { total: 0, rounds: 0, matches: 0, wins: 0, losses: 0, ties: 0, errors: 0 }]));
  for (const m of results) {
    const A = score[m.a], B = score[m.b];
    A.total += m.scoreA; B.total += m.scoreB;
    A.rounds += m.length; B.rounds += m.length;
    A.matches++; B.matches++;
    if (m.scoreA > m.scoreB) { A.wins++; B.losses++; } else if (m.scoreA < m.scoreB) { B.wins++; A.losses++; } else { A.ties++; B.ties++; }
    A.errors += m.errorsA.length; B.errors += m.errorsB.length;
  }
  const ranking = screened.map((e) => ({
    team_id: e.team_id ?? null, entrant_id: e.id, name: e.name, team: e.team ?? null, house: !e.team_id, house_name: e.house_name ?? null,
    disqualified: e.disqualified, ...score[e.id],
    average: score[e.id].rounds ? Math.round((score[e.id].total / score[e.id].rounds) * 1000) / 1000 : 0,
  })).sort((a, b) => b.total - a.total);
  ranking.forEach((r, i) => { r.rank = i + 1; });
  return { ranking, matches: results, lengths, payoffs: p, repeats, ran_at: new Date().toISOString() };
}
