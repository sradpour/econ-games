// Demo mode: play any game alone in the browser against simulated players.
// Uses the same engine as real games; nothing is sent to the server.
import { startGame, resolveStage, normalizeConfig, benchmarks, GAME_LABELS } from './engine.js';
import { store, rerender } from './dom.js';

const BOTS = { competitive: 11, monopolistic: 9, oligopoly: 5, monopoly: 0, pd_live: 3, public_goods: 3, ultimatum: 3 };
const DEMO_CONFIG = {
  competitive: { rounds: 6 }, monopolistic: { rounds: 6 }, oligopoly: { rounds: 6 }, monopoly: { rounds: 5 },
  pd_live: { matches: 2, min_rounds: 5, max_rounds: 8 },
  public_goods: { rounds_no_punish: 3, rounds_punish: 3, group_size: 4 },
  ultimatum: { rounds: 6 },
};
const MARKETS = ['competitive', 'monopolistic', 'oligopoly', 'monopoly'];
const U = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;

let demo = null;

export function startDemo(gameType, options = {}) {
  const base = { ...DEMO_CONFIG[gameType], ...options, team_mode: 'individual', round_seconds: 0,
    contribute_seconds: 0, punish_seconds: 0, offer_seconds: 0, respond_seconds: 0 };
  const cfg = normalizeConfig(gameType, base);
  const n = BOTS[gameType];
  const letters = 'ABCDEFGHIJKLMNOP';
  const botName = (i) => (MARKETS.includes(gameType) ? `${cfg.business.charAt(0).toUpperCase() + cfg.business.slice(1)} ${letters[i]}` : `Computer player ${i + 1}`);
  const teams = [{ id: 'me', name: 'You' }, ...Array.from({ length: n }, (_, i) => ({ id: `bot${i}`, name: botName(i) }))];
  const g = startGame(gameType, cfg, teams, Math.random);
  demo = {
    type: gameType, config: g.config, state: g.state, open: g.open, teams,
    results: [], public: [], outputs: {}, finished: false, passed: false, myDecision: null,
    bench: benchmarks(gameType, g.config, teams.length),
    bots: Object.fromEntries(teams.slice(1).map((t, i) => [t.id, botProfile(gameType, i)])),
  };
  for (const o of g.outputs) if (o.visibility === 'students') demo.outputs[o.kind] = o.payload;
  autoAdvance();
  publish();
}

export const demoActive = () => !!demo;
export function demoPass() { if (demo) { demo.passed = true; publish(); } }

export function demoSubmit(payload) {
  if (!demo || demo.finished || !demo.open.required.includes('me')) return;
  demo.myDecision = payload;
  resolveOnce();
  autoAdvance();
  publish();
}

// ---------------------------------------------------------------------------

function resolveOnce() {
  const d = demo;
  const decisions = {};
  for (const id of d.open.required) {
    decisions[id] = id === 'me' ? d.myDecision : botDecide(id, d.open.assignments.find((a) => a.team_id === id)?.info || {});
  }
  const r = resolveStage({
    gameType: d.type, config: d.config, state: d.state, round_no: d.open.round_no, stage: d.open.stage,
    teams: d.teams, decisions,
  }, Math.random);
  d.state = r.state;
  d.results.push(...r.results);
  d.public.push(...r.round_public);
  for (const o of r.outputs) if (o.visibility === 'students') d.outputs[o.kind] = o.payload;
  d.myDecision = null;
  if (r.finished) { d.finished = true; return; }
  d.open = r.open;
}

// Stages where you have nothing to do (a bye, or the other side's turn) resolve on their own.
function autoAdvance() {
  let guard = 0;
  while (!demo.finished && !demo.open.required.includes('me') && guard++ < 200) resolveOnce();
}

function publish() {
  const d = demo;
  const name = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  const mine = d.results.filter((r) => r.team_id === 'me');
  const g = {
    demo: true,
    server_now: new Date().toISOString(),
    session: {
      id: `demo-${d.type}`, title: `${GAME_LABELS[d.type]} (demo)`, game_type: d.type, config: d.config,
      status: d.finished ? 'finished' : 'running', round_no: d.open.round_no, stage: d.open.stage,
      stage_ends_at: null, team_mode: 'individual', team_cap: 1, class_name: 'Demo', player_count: d.teams.length,
    },
    joined: true,
    me: { passed_check: d.passed, team_id: 'me', is_captain: true, required: !d.finished && d.open.required.includes('me'), decision: null },
    team: { id: 'me', name: 'You', members: [{ name: 'You', is_me: true }] },
    assignment: d.open.assignments.find((a) => a.team_id === 'me')?.info || null,
    results: mine.map((r) => ({ ...r.payload, round_no: r.round_no })),
    public: d.public.map((p) => ({ ...p.payload, round_no: p.round_no })),
    outputs: d.outputs,
  };
  if (d.finished && MARKETS.includes(d.type)) {
    g.all_results = d.results.map((r) => ({ team: name[r.team_id], round_no: r.round_no, price: r.payload.price,
      produced: r.payload.produced, sold: r.payload.sold, branding: r.payload.branding, profit: r.payload.profit }));
  }
  store.game = g;
  store.ui.preview = null; store.ui.pg = null;
  rerender();
}

// ---------------------------------------------------------------------------
// Simulated players

function botProfile(type, i) {
  if (type === 'public_goods') return { kind: i === 0 ? 'free-rider' : 'conditional', start: U(8, 16) };
  if (type === 'ultimatum') return { offers: pick([[4, 5], [3, 4, 5], [5], [2, 3, 4]]), threshold: pick([2, 3, 3, 4]) };
  if (type === 'monopolistic') return { brand: pick([0, 0, 15, 30, 50]), bias: U(-0.15, 0.15) };
  return { bias: U(-0.12, 0.12) };
}

const lastOf = (id) => { const rs = demo.results.filter((r) => r.team_id === id); return rs[rs.length - 1]?.payload; };
const lastPublic = () => demo.public[demo.public.length - 1]?.payload;

function botDecide(id, info) {
  const d = demo, c = d.config, bot = d.bots[id], t = d.type;
  if (t === 'competitive') {
    const ref = lastPublic()?.market_price ?? d.bench.price * (1 + U(-0.35, 0.35));
    const price = r2(clamp(ref * (1 + bot.bias * 0.5 + U(-0.06, 0.06)), c.mc_intercept, c.max_price));
    const q = Math.max(0, Math.round(((price - c.mc_intercept) / c.mc_slope) * U(0.85, 1.1)));
    return { participate: true, price, quantity: q };
  }
  if (t === 'oligopoly' || t === 'monopolistic') {
    const mine = lastOf(id);
    const ref = mine?.price != null ? 0.5 * mine.price + 0.5 * (lastPublic()?.market_price ?? mine.price) : d.bench.nash_price * (1 + bot.bias + U(-0.2, 0.25));
    const drift = mine && mine.profit < 0 ? -0.5 : U(-0.4, 0.4);
    const price = r2(clamp(ref + drift, c.mc_intercept, c.max_price));
    if (t === 'oligopoly') return { participate: true, price };
    const q = Math.round((mine?.demand ?? d.bench.nash_quantity) * U(0.95, 1.15));
    return { participate: true, price, quantity: q, branding: bot.brand };
  }
  if (t === 'pd_live') {
    const h = info.history || [];
    if (!bot.byMatch || bot.byMatch.match !== info.match) bot.byMatch = { match: info.match, strat: pick(['tft', 'tft', 'grim', 'random', 'allc', 'alld', 'pavlov', 'tf2t']) };
    const them = h.map((x) => x.them), me = h.map((x) => x.you);
    const last = them[them.length - 1];
    switch (bot.byMatch.strat) {
      case 'tft': return { move: h.length ? last : 'C' };
      case 'grim': return { move: them.includes('D') ? 'D' : 'C' };
      case 'random': return { move: Math.random() < 0.5 ? 'C' : 'D' };
      case 'allc': return { move: 'C' };
      case 'alld': return { move: 'D' };
      case 'tf2t': return { move: them.length >= 2 && them.slice(-2).every((m) => m === 'D') ? 'D' : 'C' };
      default: return { move: !h.length ? 'C' : (me[me.length - 1] === last ? 'C' : 'D') }; // pavlov
    }
  }
  if (t === 'public_goods') {
    if (d.open.stage === 'punish') {
      if (bot.kind === 'free-rider') return { points: {} };
      const pts = {};
      for (const o of info.others || []) if (o.contribution <= 4) pts[o.label] = 2;
      return { points: pts };
    }
    const mine = lastOf(id);
    if (bot.kind === 'free-rider') return { contribution: Math.round(U(0, 4)) };
    if (!mine) return { contribution: Math.round(bot.start) };
    const others = mine.others.map((o) => o.contribution);
    const avg = others.reduce((s, x) => s + x, 0) / Math.max(1, others.length);
    const punished = mine.points_received > 0 ? 3 : 0;
    return { contribution: Math.round(clamp(0.5 * mine.contribution + 0.5 * avg - U(0, 2) + punished, 0, c.endowment)) };
  }
  if (t === 'ultimatum') {
    if (d.open.stage === 'offer') return { offer: Math.min(c.pie, Math.round(pick(bot.offers) * c.pie / 10)) };
    return { accept: (info.offer ?? 0) >= Math.round(bot.threshold * c.pie / 10) };
  }
  return {};
}
