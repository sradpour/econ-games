// Game engine for the classroom economics games.
// Pure functions only: no database or network access, so it can be unit-tested in Node
// and imported by the Supabase edge function (Deno).
//
// Vocabulary
//   team      – the unit that makes decisions. In "individual" mode every student is a one-person team.
//   round     – numbered from 1. A round has one or two stages (e.g. contribute -> punish).
//   ctx       – everything the engine needs: { gameType, config, state, round_no, stage, teams, decisions }
//   result    – what a stage resolution returns: new state, rows to write, and what opens next.

export const GAME_TYPES = [
  'competitive', 'monopolistic', 'oligopoly', 'monopoly',
  'pd_live', 'pd_tournament', 'public_goods', 'ultimatum', 'commons',
];

export const GAME_LABELS = {
  competitive: 'Perfect competition',
  monopolistic: 'Monopolistic competition',
  oligopoly: 'Oligopoly (price competition)',
  monopoly: 'Monopoly',
  pd_live: "Repeated prisoner's dilemma (live)",
  pd_tournament: "Prisoner's dilemma strategy tournament",
  public_goods: 'Public goods game',
  ultimatum: 'Ultimatum / dictator game',
  commons: 'Tragedy of the commons',
};

const MARKET_COMMON = {
  rounds: 10,
  round_seconds: 180,
  team_mode: 'individual',   // 'individual' | 'teams'
  team_size: 4,
  fixed_cost: 100,
  avoidable_share: 0.5,      // share of the fixed cost saved by sitting a round out (equipment & utilities; the rest is rent)
  // Production story: labor with diminishing marginal product + ingredients per unit.
  // Marginal cost = material_qty*material_price + wage / MP(q), with MP(q) = base_productivity / (1 + q / productivity_half)
  story: 'bakery',
  business: 'bakery', product: 'loaf', product_plural: 'loaves',
  material_name: 'flour and ingredients', material_unit: 'lb',
  wage: 15,                  // $ per labor hour
  base_productivity: 10,     // units produced by the first hour of labor
  productivity_half: 15,     // output level at which an extra hour adds half as much as the first hour
  material_qty: 0.25,        // units of material per unit of output
  material_price: 2,         // $ per unit of material
  difficulty: 'normal',      // 'normal' shows the full cost table; 'hard' shows only the production data
  mc_intercept: 2,           // derived from the production story (kept for older games)
  mc_slope: 0.1,
  missed: 'sit_out',         // 'sit_out' | 'keep_last' when a team misses the deadline
  leaderboard: 'live',       // 'live' | 'end' | 'never'
  show_prices: false,        // show every firm's price after each round
  reveal_at_end: true,       // reveal everyone's prices and quantities when the game ends
  auto_advance: true,        // end the round early once every team has submitted
};

export const DEFAULTS = {
  competitive: {
    ...MARKET_COMMON,
    demand_a: 100, demand_b: 5,      // demand per firm: q = a - b*P (market demand scales with number of firms)
    market_rule: 'fixed',            // 'fixed': a given market price; firms are price takers | 'cheapest': buyers go to the cheapest sellers first
    market_price: 0,                 // 'fixed' rule: the market price; 0 = the competitive equilibrium for these costs
    price_range: 2,                  // 'fixed' rule: each round's price is drawn within ± this of the market price (0 = same every round)
    price_step: 0.5,                 // ... in steps of this many dollars, so prices stay round
    above_market_k: 30,              // share sold above the market price = exp(-k × fraction above): 2% → 55%, 5% → 22%, 10% → 5%
    price_noise: 0.02,               // 'cheapest' rule only: buyers perceive prices with ±2% noise, so near-ties get mixed
    max_price: 20, max_quantity: 200,
  },
  monopolistic: {
    ...MARKET_COMMON,
    buyers_per_firm: 100,
    appeal: 3, price_sensitivity: 0.4, outside_weight: 0.1, demand_noise: 0.1,
    brand_decay: 0.7,                // brand stock carried to next round
    brand_appeal: 0.6,               // extra appeal from brand stock
    brand_loyalty: 0.5,              // max cut in price sensitivity from brand stock
    brand_scale: 50,
    max_price: 40, max_quantity: 300, max_branding: 200,
  },
  oligopoly: {
    ...MARKET_COMMON,
    team_mode: 'teams',
    buyers_per_firm: 100,
    appeal: 3, price_sensitivity: 0.4, outside_weight: 0.1, demand_noise: 0.1,
    max_price: 40,
  },
  monopoly: {
    ...MARKET_COMMON,
    demand_a: 100, demand_b: 5, demand_noise: 0,
    max_price: 20, max_quantity: 200,
  },
  pd_live: {
    team_mode: 'individual', team_size: 4,
    matches: 3, min_rounds: 10, max_rounds: 20,
    round_seconds: 30,
    payoff_T: 5, payoff_R: 3, payoff_P: 1, payoff_S: 0,
    leaderboard: 'end', auto_advance: true,
  },
  pd_tournament: {
    team_mode: 'teams', team_size: 4,
    min_rounds: 10, max_rounds: 20, repeats: 3,
    payoff_T: 5, payoff_R: 3, payoff_P: 1, payoff_S: 0,
    include_house: false,
    writing_seconds: 0,
    leaderboard: 'end', auto_advance: false,
  },
  public_goods: {
    team_mode: 'individual', team_size: 1,
    group_size: 4, matching: 'partners',   // 'partners' (fixed groups) | 'strangers' (reshuffled every round)
    endowment: 20, mpcr: 0.4,              // each member earns mpcr × group total contributions
    rounds_no_punish: 10, rounds_punish: 10,
    contribute_seconds: 60, punish_seconds: 60,
    punish_cost: 1, punish_impact: 3, max_punish_points: 10,
    leaderboard: 'end', auto_advance: true,
  },
  ultimatum: {
    team_mode: 'individual', team_size: 1,
    variant: 'ultimatum',                  // 'ultimatum' | 'dictator'
    pie: 10, rounds: 6,
    offer_seconds: 60, respond_seconds: 45,
    leaderboard: 'end', auto_advance: true,
  },
  commons: {
    team_mode: 'individual', team_size: 1,
    variant: 'fishery',                    // 'fishery' (choose how many fish, lake regrows) | 'simple' (extract or wait)
    group_size: 3,
    matching: 'partners',                  // 'partners' (same group) | 'strangers' (new random group every season/round)
    chat: 'on',                            // 'on' | 'off' | 'later' (off in the first half, on in the second)
    chat_seconds: 60, decide_seconds: 45,
    // Fishery
    matches: 2,                            // fishing games, each with full lakes and new groups
    min_seasons: 6, max_seasons: 10,       // hidden length of each fishing game
    fish_per_member: 20,                   // lake capacity = this × group size (and the lake starts full)
    growth: 2,                             // fish left after a season multiply by this, up to capacity
    max_catch: 20,                         // most one fisher can catch in a season
    fish_price: 1,                         // $ per fish
    // Simple (extract or wait)
    rounds: 6,
    pool_per_member: 10,                   // pool = this × group size
    multiplier: 2,                         // the pool grows by this if everyone waits
    leaderboard: 'end', auto_advance: true,
  },
};

const NUM = (v, d) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Fill in defaults and coerce types so the rest of the engine can trust the config. */
export function normalizeConfig(gameType, cfg = {}) {
  const base = DEFAULTS[gameType];
  if (!base) throw new Error(`Unknown game type: ${gameType}`);
  const out = {};
  for (const [k, def] of Object.entries(base)) {
    const v = cfg[k];
    if (typeof def === 'number') out[k] = NUM(v, def);
    else if (typeof def === 'boolean') out[k] = v === undefined || v === null ? def : (v === true || v === 'true');
    else out[k] = v === undefined || v === null || v === '' ? def : String(v);
  }
  if (gameType === 'pd_live' || gameType === 'pd_tournament') {
    out.min_rounds = Math.max(1, Math.round(out.min_rounds));
    out.max_rounds = Math.max(out.min_rounds, Math.round(out.max_rounds));
  }
  if (gameType === 'competitive' && out.market_rule !== 'cheapest') out.market_rule = 'fixed';
  if (gameType === 'commons') {
    if (out.variant !== 'simple') out.variant = 'fishery';
    if (out.matching !== 'strangers') out.matching = 'partners';
    if (!['on', 'off', 'later'].includes(out.chat)) out.chat = 'on';
    out.group_size = Math.max(2, Math.round(out.group_size));
    out.matches = Math.max(1, Math.round(out.matches));
    out.min_seasons = Math.max(1, Math.round(out.min_seasons));
    out.max_seasons = Math.max(out.min_seasons, Math.round(out.max_seasons));
    out.rounds = Math.max(1, Math.round(out.rounds));
    out.fish_per_member = Math.max(1, Math.round(out.fish_per_member));
    out.max_catch = Math.max(1, Math.round(out.max_catch));
    out.growth = Math.max(0, out.growth);
  }
  if (out.team_mode !== 'teams') out.team_mode = 'individual';
  if ('wage' in base && (cfg.wage !== undefined || cfg.mc_intercept === undefined)) {
    out.base_productivity = Math.max(0.01, out.base_productivity);
    out.productivity_half = Math.max(0.01, out.productivity_half);
    out.mc_intercept = out.material_qty * out.material_price + out.wage / out.base_productivity;
    out.mc_slope = out.wage / (out.base_productivity * out.productivity_half);
  }
  if (out.difficulty !== 'hard') out.difficulty = out.difficulty === undefined ? 'normal' : (out.difficulty === 'hard' ? 'hard' : 'normal');
  return out;
}

// ---------------------------------------------------------------------------
// Randomness helpers (rng is injectable for tests)

export function makeRng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(lo, hi, rng) { return lo + Math.floor(rng() * (hi - lo + 1)); }

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Market primitives

export function variableCost(q, c) {
  return c.mc_intercept * q + (c.mc_slope / 2) * q * q;
}
export function marginalCost(q, c) { return c.mc_intercept + c.mc_slope * q; }

/** Labor hours needed to produce q units (inverse of the production function). */
export function laborHours(q, c) {
  if (!c.wage) return null;
  const l1 = 1 / c.base_productivity;
  const l2 = 1 / (c.base_productivity * c.productivity_half);
  return l1 * q + (l2 / 2) * q * q;
}
/** Extra units from one more hour of labor when already producing q (marginal product of labor). */
export function marginalProduct(q, c) { return c.base_productivity / (1 + q / c.productivity_half); }
/** Units produced with L hours of labor (the production function). */
export function outputFromHours(L, c) {
  const l1 = 1 / c.base_productivity, l2 = 1 / (c.base_productivity * c.productivity_half);
  return (-l1 + Math.sqrt(l1 * l1 + 2 * l2 * L)) / l2;
}

function costBreakdown(produced, c, participating) {
  const rent = round2(c.fixed_cost * (1 - c.avoidable_share));
  const equipment = participating ? round2(c.fixed_cost * c.avoidable_share) : 0;
  if (!participating) return { labor_hours: 0, labor_cost: 0, material_cost: 0, rent, equipment };
  const hours = laborHours(produced, c);
  return {
    labor_hours: hours === null ? null : round2(hours),
    labor_cost: hours === null ? null : round2(hours * c.wage),
    material_cost: round2(produced * (c.material_qty ?? 0) * (c.material_price ?? 0)),
    rent, equipment,
  };
}

/** The given market price in perfect competition: set by the instructor, or the competitive equilibrium. */
export function fixedMarketPrice(c) {
  if (c.market_rule !== 'cheapest' && c.market_price > 0) return c.market_price;
  return (c.demand_a + c.mc_intercept / c.mc_slope) / (c.demand_b + 1 / c.mc_slope);
}

/**
 * Perfect competition with a given market price P that no firm can influence. Each firm faces nearly perfectly
 * elastic demand: priced at or below P it sells everything it made (at its own price); priced above P it sells
 * only the share exp(-k × fraction above P). Returns { price, sales: {id: units} }.
 */
export function clearMarket(offers, price, k) {
  const sales = {};
  for (const o of offers) {
    if (!(o.quantity > 0)) continue;
    const f = o.price <= price ? 1 : Math.exp(-k * (o.price - price) / Math.max(price, 0.01));
    sales[o.id] = Math.floor(o.quantity * f + 1e-9);
  }
  return { price: round2(price), sales };
}

/** Posted-offer market with efficient rationing: cheapest sellers are served first. */
export function allocateRationing(offers, demandAt, noise, rng) {
  const perceived = offers.map((o) => ({ ...o, pp: o.price * (1 + (2 * rng() - 1) * noise) }));
  perceived.sort((a, b) => a.pp - b.pp);
  const sales = {};
  let sold = 0;
  let i = 0;
  while (i < perceived.length) {
    let j = i;
    while (j + 1 < perceived.length && perceived[j + 1].pp === perceived[i].pp) j++;
    const group = perceived.slice(i, j + 1);
    const price = Math.max(...group.map((g) => g.price));
    const avail = Math.max(0, demandAt(price) - sold);
    const groupQ = group.reduce((s, g) => s + g.quantity, 0);
    const take = Math.min(groupQ, avail);
    for (const g of group) sales[g.id] = groupQ > 0 ? (g.quantity * take) / groupQ : 0;
    sold += take;
    i = j + 1;
  }
  for (const id of Object.keys(sales)) sales[id] = Math.floor(sales[id] + 1e-9);
  return sales;
}

/** Logit demand: every buyer picks the firm with the best appeal − price, or buys nothing. */
// The "buy nothing" option is weighted by the number of firms in the market, so adding firms
// intensifies competition (lower prices) rather than just growing the market.
export function logitDemand(firms, buyers, outsideWeight = 1) {
  // firms: [{id, price, appeal, lambda, shock}]
  const ex = firms.map((f) => Math.exp(f.appeal - f.lambda * f.price + (f.shock || 0)));
  const denom = outsideWeight + ex.reduce((s, x) => s + x, 0);
  const out = {};
  firms.forEach((f, k) => { out[f.id] = (buyers * ex[k]) / denom; });
  return out;
}

function brandEffects(stock, c) {
  const appeal = c.appeal + c.brand_appeal * Math.log(1 + stock / c.brand_scale);
  const lambda = c.price_sensitivity * (1 - c.brand_loyalty * (stock / (stock + c.brand_scale)));
  return { appeal, lambda };
}

// ---------------------------------------------------------------------------
// Benchmarks (for the instructor's debrief panel)

function goldenMax(f, lo, hi, iters = 80) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  let f1 = f(x1), f2 = f(x2);
  for (let k = 0; k < iters; k++) {
    if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = f(x2); }
    else { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = f(x1); }
  }
  return (a + b) / 2;
}

export function benchmarks(gameType, config, nFirms) {
  const c = normalizeConfig(gameType, config);
  const N = Math.max(1, nFirms);
  if (gameType === 'competitive') {
    // per-firm supply q = (P - c0)/s ; per-firm demand a - bP (or the fixed market price, if the instructor set one)
    const P = fixedMarketPrice(c);
    const q = (P - c.mc_intercept) / c.mc_slope;
    const profit = P * q - variableCost(q, c) - c.fixed_cost;
    return { kind: 'competitive', price: round2(P), quantity_per_firm: round2(q), profit_per_firm: round2(profit),
      note: 'Competitive equilibrium: market price equals each firm\'s marginal cost.' };
  }
  if (gameType === 'monopoly') {
    // MR = a/b - 2Q/b ; MC = c0 + sQ
    const Q = (c.demand_a / c.demand_b - c.mc_intercept) / (2 / c.demand_b + c.mc_slope);
    const P = (c.demand_a - Q) / c.demand_b;
    const profit = P * Q - variableCost(Q, c) - c.fixed_cost;
    const Pc = (c.demand_a + c.mc_intercept / c.mc_slope) / (c.demand_b + 1 / c.mc_slope);
    return { kind: 'monopoly', price: round2(P), quantity: round2(Q), profit: round2(profit),
      competitive_price: round2(Pc), note: 'Profit-maximising monopoly: marginal revenue equals marginal cost.' };
  }
  if (gameType === 'oligopoly' || gameType === 'monopolistic') {
    const M = c.buyers_per_firm * N;
    const profitAt = (p, pOthers) => {
      const firms = [{ id: 'me', price: p, appeal: c.appeal, lambda: c.price_sensitivity }];
      for (let k = 1; k < N; k++) firms.push({ id: `o${k}`, price: pOthers, appeal: c.appeal, lambda: c.price_sensitivity });
      const q = logitDemand(firms, M, N * c.outside_weight).me;
      return p * q - variableCost(q, c) - c.fixed_cost;
    };
    let p = c.max_price / 2;
    for (let it = 0; it < 200; it++) {
      const br = goldenMax((x) => profitAt(x, p), 0, c.max_price);
      if (Math.abs(br - p) < 1e-6) { p = br; break; }
      p = br;
    }
    const pJoint = goldenMax((x) => profitAt(x, x), 0, c.max_price);
    const qAt = (x) => logitDemand(Array.from({ length: N }, (_, k) => ({ id: k, price: x, appeal: c.appeal, lambda: c.price_sensitivity })), M, N * c.outside_weight)[0];
    return {
      kind: gameType,
      firms: N,
      nash_price: round2(p), nash_quantity: round2(qAt(p)), nash_profit: round2(profitAt(p, p)),
      joint_price: round2(pJoint), joint_quantity: round2(qAt(pJoint)), joint_profit: round2(profitAt(pJoint, pJoint)),
      note: gameType === 'monopolistic'
        ? 'Benchmarks assume no branding and output equal to demand.'
        : 'Nash: every firm best-responds to the others. Joint: the price that would maximise total profit (collusion).',
    };
  }
  if (gameType === 'commons') {
    if (c.variant === 'simple') {
      const n = c.group_size, pool = c.pool_per_member * n;
      return { kind: 'commons', variant: 'simple', group_size: n, pool,
        all_wait_each: round2(pool * c.multiplier / n), all_extract_each: round2(pool / n), lone_extractor: round2(pool),
        note: 'Extracting is the better choice whatever the others do, yet everyone does better if all wait.' };
    }
    const n = c.group_size, cap = c.fish_per_member * n;
    const sustainable = c.growth > 1 ? Math.floor(cap * (1 - 1 / c.growth)) : 0;
    return { kind: 'commons', variant: 'fishery', group_size: n, capacity: cap,
      sustainable_group_catch: sustainable, sustainable_per_person: round2(sustainable / n),
      greedy_group_catch: Math.min(cap, c.max_catch * n),
      note: 'Sustainable: the most a group can catch every season and still have a full lake next season.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Start a game. teams: [{id, name}] (already finalised).
 * Returns { state, open: {round_no, stage, seconds, required, assignments}, outputs }
 */
export function startGame(gameType, rawConfig, teams, rng = Math.random) {
  const config = normalizeConfig(gameType, rawConfig);
  const ids = teams.map((t) => t.id);
  const state = { n_start: ids.length, cum: Object.fromEntries(ids.map((id) => [id, 0])), rounds_played: Object.fromEntries(ids.map((id) => [id, 0])) };
  const outputs = [];
  if (['competitive', 'monopolistic', 'oligopoly', 'monopoly'].includes(gameType)) {
    state.last = {};
    if (gameType === 'monopolistic') state.brand = Object.fromEntries(ids.map((id) => [id, 0]));
    const b = benchmarks(gameType, config, ids.length);
    if (b) outputs.push({ kind: 'benchmarks', visibility: 'instructor', payload: b });
    if (gameType === 'competitive' && config.market_rule !== 'cheapest') state.round_prices = {};
    return { config, state, open: openMarketRound(1, config, ids, state, rng), outputs };
  }
  if (gameType === 'pd_live') {
    state.match = 0; state.byes = {}; state.last_move = {}; state.prev_partner = {};
    return { config, state, open: startPdMatch(state, config, ids, 1, rng), outputs };
  }
  if (gameType === 'pd_tournament') {
    return { config, state, open: { round_no: 0, stage: 'writing', seconds: config.writing_seconds, required: ids, assignments: [] }, outputs };
  }
  if (gameType === 'public_goods') {
    state.groups = null; state.labels = {};
    return { config, state, open: openPgRound(state, config, ids, 1, rng), outputs };
  }
  if (gameType === 'ultimatum') {
    state.byes = {};
    return { config, state, open: openUgRound(state, config, ids, 1, rng), outputs };
  }
  if (gameType === 'commons') {
    state.groups = null; state.labels = {}; state.last_catch = {};
    outputs.push({ kind: 'benchmarks', visibility: 'instructor', payload: benchmarks(gameType, config, ids.length) });
    if (config.variant === 'simple') return { config, state, open: openSimpleRound(state, config, ids, 1, rng), outputs };
    state.match = 0;
    return { config, state, open: startFishingGame(state, config, ids, 1, rng), outputs };
  }
  throw new Error(`Unknown game type ${gameType}`);
}

/**
 * Resolve the stage that is currently open.
 * ctx: { gameType, config, state, round_no, stage, teams:[{id,name}], decisions:{team_id: payload} }
 * Returns { state, results:[{round_no, team_id, payload, earnings}], round_public:[{round_no,payload}],
 *           assignments:[...] (updates for the next stage), open | finished:true, outputs:[] }
 */
export function resolveStage(ctx, rng = Math.random) {
  const config = normalizeConfig(ctx.gameType, ctx.config);
  const c2 = { ...ctx, config, state: structuredClone(ctx.state || {}) };
  let out;
  switch (ctx.gameType) {
    case 'competitive': case 'monopolistic': case 'oligopoly': case 'monopoly':
      out = resolveMarket(c2, rng); break;
    case 'pd_live': out = resolvePd(c2, rng); break;
    case 'public_goods': out = resolvePg(c2, rng); break;
    case 'ultimatum': out = resolveUg(c2, rng); break;
    case 'commons': out = resolveCommons(c2, rng); break;
    case 'pd_tournament':
      out = { state: c2.state, results: [], round_public: [], assignments: [], finished: true, outputs: [] }; break;
    default: throw new Error(`Unknown game type ${ctx.gameType}`);
  }
  out.outputs = out.outputs || [];
  if (out.finished) out.outputs.push(finalOutput(c2, out));
  return out;
}

/** Final standings when the instructor ends a game early. */
export function finishGame(gameType, rawConfig, state, teams) {
  const config = normalizeConfig(gameType, rawConfig);
  return finalOutput({ gameType, config, state: state || {}, teams }, {});
}

/** Leaderboard and (optionally) a full history for the end-of-game debrief. */
function finalOutput(ctx, out) {
  const { state, teams, config } = ctx;
  const board = teams.map((t) => {
    const total = round2(state.cum?.[t.id] || 0);
    const played = state.rounds_played?.[t.id] || 0;
    return { team_id: t.id, name: t.name, total, rounds: played, average: played ? round2(total / played) : 0 };
  });
  const byAvg = ctx.gameType === 'pd_live';
  board.sort((a, b) => (byAvg ? b.average - a.average : b.total - a.total));
  board.forEach((r, i) => { r.rank = i + 1; });
  return {
    kind: 'final',
    visibility: config.leaderboard === 'never' ? 'instructor' : 'students',
    payload: { leaderboard: board, ranked_by: byAvg ? 'average' : 'total', reveal: !!config.reveal_at_end },
  };
}

// ---------------------------------------------------------------------------
// Markets

/** This round's market price in perfect competition: a round number near the base price (or the base price). */
function drawRoundPrice(c, prev, rng) {
  const base = fixedMarketPrice(c);
  const step = c.price_step > 0 ? c.price_step : 0.5;
  const n = Math.floor((c.price_range + 1e-9) / step);
  if (!(c.price_range > 0) || n < 1) return round2(base);
  const center = Math.round(base / step) * step;
  const lo = c.mc_intercept + step, hi = c.max_price;
  let p = center;
  for (let tries = 0; tries < 10; tries++) {
    p = round2(center + randInt(-n, n, rng) * step);
    if (p >= lo && p <= hi && p !== prev) break;
  }
  return round2(Math.min(hi, Math.max(lo, p)));
}

function openMarketRound(roundNo, config, ids, state, rng = Math.random) {
  let info = { round_no: roundNo };
  if (state?.round_prices) {
    const price = drawRoundPrice(config, state.round_prices[roundNo - 1], rng);
    state.round_prices[roundNo] = price;
    info = { round_no: roundNo, market_price: price };
  }
  return {
    round_no: roundNo, stage: 'decide', seconds: config.round_seconds, required: ids,
    assignments: ids.map((id) => ({ team_id: id, info })),
  };
}

function sanitizeMarketDecision(gameType, d, c) {
  const participate = d.participate !== false && d.participate !== 'false';
  const price = round2(clamp(NUM(d.price, 0), 0, c.max_price));
  const quantity = gameType === 'oligopoly' ? null : Math.round(clamp(NUM(d.quantity, 0), 0, c.max_quantity));
  const branding = gameType === 'monopolistic' ? round2(clamp(NUM(d.branding, 0), 0, c.max_branding)) : 0;
  return { participate, price, quantity, branding };
}

function resolveMarket(ctx, rng) {
  const { gameType, config: c, state, round_no, teams } = ctx;
  const decisions = ctx.decisions || {};
  const eff = {};
  for (const t of teams) {
    let d = decisions[t.id];
    let auto = false;
    if (!d) {
      auto = true;
      if (c.missed === 'keep_last' && state.last?.[t.id]) d = { ...state.last[t.id] };
      else d = { participate: false };
    }
    const s = sanitizeMarketDecision(gameType, d, c);
    if (s.participate && gameType !== 'oligopoly' && s.quantity <= 0 && gameType !== 'monopolistic') s.participate = s.quantity > 0;
    eff[t.id] = { ...s, auto };
  }
  const active = teams.filter((t) => eff[t.id].participate);
  const N = Math.max(1, state.n_start || teams.length);
  const sold = {};
  let shocks = {};
  let cleared = null;
  if (gameType === 'competitive') {
    const offers = active.map((t) => ({ id: t.id, price: eff[t.id].price, quantity: eff[t.id].quantity }));
    const demandAt = (p) => Math.max(0, N * (c.demand_a - c.demand_b * p));
    if (c.market_rule === 'cheapest') Object.assign(sold, allocateRationing(offers, demandAt, c.price_noise, rng));
    else {
      cleared = clearMarket(offers, state.round_prices?.[round_no] ?? fixedMarketPrice(c), c.above_market_k);
      Object.assign(sold, cleared.sales);
    }
  } else if (gameType === 'monopoly') {
    for (const t of active) {
      const shock = c.demand_noise ? gaussian(rng) * c.demand_noise : 0;
      const D = Math.max(0, c.demand_a * (1 + shock) - c.demand_b * eff[t.id].price);
      sold[t.id] = Math.floor(Math.min(eff[t.id].quantity, D));
    }
  } else {
    // oligopoly & monopolistic competition: logit demand
    if (gameType === 'monopolistic') {
      for (const t of teams) {
        state.brand[t.id] = round2(c.brand_decay * (state.brand[t.id] || 0) + (eff[t.id].participate ? eff[t.id].branding : 0));
      }
    }
    const firms = active.map((t) => {
      const shock = gaussian(rng) * c.demand_noise;
      shocks[t.id] = shock;
      if (gameType === 'monopolistic') {
        const { appeal, lambda } = brandEffects(state.brand[t.id] || 0, c);
        return { id: t.id, price: eff[t.id].price, appeal, lambda, shock };
      }
      return { id: t.id, price: eff[t.id].price, appeal: c.appeal, lambda: c.price_sensitivity, shock };
    });
    const dem = logitDemand(firms, c.buyers_per_firm * N, N * c.outside_weight);
    for (const t of active) {
      const demand = Math.floor(dem[t.id]);
      sold[t.id] = gameType === 'oligopoly' ? demand : Math.min(eff[t.id].quantity, demand);
      eff[t.id].demand = demand;
    }
  }

  const results = [];
  for (const t of teams) {
    const e = eff[t.id];
    let payload;
    if (e.participate) {
      const produced = gameType === 'oligopoly' ? sold[t.id] : e.quantity;
      const units = sold[t.id] || 0;
      const revenue = round2(units * e.price);
      const vc = round2(variableCost(produced, c));
      const fixed = c.fixed_cost;
      const branding = e.branding || 0;
      const total = round2(vc + fixed + branding);
      const profit = round2(revenue - total);
      payload = {
        participated: true, auto: e.auto, price: e.price, produced, sold: units, unsold: produced - units,
        revenue, variable_cost: vc, fixed_cost: fixed, branding, total_cost: total, profit,
        ...costBreakdown(produced, c, true),
      };
      if (gameType === 'monopolistic') { payload.brand_stock = state.brand[t.id]; payload.demand = e.demand; }
      if (cleared) { payload.market_price = cleared.price; payload.above_market = cleared.price !== null && e.price > cleared.price; }
    } else {
      const fixed = round2(c.fixed_cost * (1 - c.avoidable_share));
      payload = {
        participated: false, auto: e.auto, price: null, produced: 0, sold: 0, unsold: 0,
        revenue: 0, variable_cost: 0, fixed_cost: fixed, branding: 0, total_cost: fixed, profit: -fixed,
        ...costBreakdown(0, c, false),
      };
      if (gameType === 'monopolistic') payload.brand_stock = state.brand[t.id];
    }
    state.cum[t.id] = round2((state.cum[t.id] || 0) + payload.profit);
    state.rounds_played[t.id] = (state.rounds_played[t.id] || 0) + 1;
    payload.cumulative = state.cum[t.id];
    if (!e.auto) state.last[t.id] = { participate: e.participate, price: e.price, quantity: e.quantity, branding: e.branding };
    results.push({ round_no, team_id: t.id, payload, earnings: payload.profit });
  }

  // Public information for this round
  const sellers = results.filter((r) => r.payload.participated);
  const totalSold = sellers.reduce((s, r) => s + r.payload.sold, 0);
  const marketPrice = totalSold ? round2(sellers.reduce((s, r) => s + r.payload.sold * r.payload.price, 0) / totalSold) : null;
  const avgPrice = sellers.length ? round2(sellers.reduce((s, r) => s + r.payload.price, 0) / sellers.length) : null;
  const pub = { round_no, active_firms: sellers.length, total_sold: totalSold, average_price: avgPrice };
  if (gameType !== 'monopoly') pub.market_price = cleared ? cleared.price : marketPrice;
  if (cleared) { pub.average_selling_price = marketPrice; pub.market_rule = 'fixed'; }
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);
  if (c.show_prices) {
    pub.prices = teams.map((t) => ({ name: t.name, price: eff[t.id].participate ? eff[t.id].price : null }))
      .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  }

  const finished = round_no >= c.rounds;
  return {
    state, results, round_public: [{ round_no, payload: pub }], assignments: [],
    ...(finished ? { finished: true } : { open: openMarketRound(round_no + 1, c, teams.map((t) => t.id), state, rng) }),
  };
}

function leaderboard(teams, state) {
  return teams.map((t) => ({ name: t.name, total: round2(state.cum[t.id] || 0) }))
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Pairing helper (shared by PD and ultimatum)

function makePairs(ids, state, rng) {
  let pool = ids.slice();
  let bye = null;
  if (pool.length % 2 === 1) {
    const minByes = Math.min(...pool.map((id) => state.byes[id] || 0));
    const candidates = pool.filter((id) => (state.byes[id] || 0) === minByes);
    bye = candidates[Math.floor(rng() * candidates.length)];
    state.byes[bye] = (state.byes[bye] || 0) + 1;
    pool = pool.filter((id) => id !== bye);
  }
  // try a few shuffles to avoid repeating last partner
  let best = null, bestRepeats = Infinity;
  for (let k = 0; k < 25; k++) {
    const s = shuffle(pool, rng);
    const pairs = [];
    let repeats = 0;
    for (let i = 0; i < s.length; i += 2) {
      pairs.push([s[i], s[i + 1]]);
      if (state.prev_partner && state.prev_partner[s[i]] === s[i + 1]) repeats++;
    }
    if (repeats < bestRepeats) { best = pairs; bestRepeats = repeats; }
    if (repeats === 0) break;
  }
  return { pairs: best || [], bye };
}

// ---------------------------------------------------------------------------
// Repeated prisoner's dilemma (live)

function startPdMatch(state, c, ids, roundNo, rng) {
  state.match += 1;
  state.match_length = randInt(c.min_rounds, c.max_rounds, rng); // hidden from players
  state.round_in_match = 1;
  const { pairs, bye } = makePairs(ids, state, rng);
  state.pairs = pairs; state.bye = bye;
  state.prev_partner = {};
  for (const [a, b] of pairs) { state.prev_partner[a] = b; state.prev_partner[b] = a; }
  state.history = {}; // team -> [{you, them}] for the current match
  for (const id of ids) state.history[id] = [];
  return openPdRound(state, c, ids, roundNo);
}

function openPdRound(state, c, ids, roundNo) {
  const assignments = ids.map((id) => ({
    team_id: id,
    info: {
      match: state.match, matches: c.matches, round_in_match: state.round_in_match,
      bye: state.bye === id, history: state.history[id] || [],
    },
  }));
  const required = ids.filter((id) => state.bye !== id);
  return { round_no: roundNo, stage: 'move', seconds: c.round_seconds, required, assignments };
}

function pdPayoff(me, them, c) {
  if (me === 'C' && them === 'C') return c.payoff_R;
  if (me === 'C' && them === 'D') return c.payoff_S;
  if (me === 'D' && them === 'C') return c.payoff_T;
  return c.payoff_P;
}

function resolvePd(ctx, rng) {
  const { config: c, state, round_no, teams } = ctx;
  const decisions = ctx.decisions || {};
  const ids = teams.map((t) => t.id);
  const moveOf = (id) => {
    const d = decisions[id];
    const m = d && (d.move === 'C' || d.move === 'D') ? d.move : null;
    if (m) return { move: m, auto: false };
    return { move: state.last_move[id] || 'C', auto: true };
  };
  const results = [];
  for (const [a, b] of state.pairs) {
    const ma = moveOf(a), mb = moveOf(b);
    for (const [me, them, id] of [[ma, mb, a], [mb, ma, b]]) {
      const pts = pdPayoff(me.move, them.move, c);
      state.cum[id] = (state.cum[id] || 0) + pts;
      state.rounds_played[id] = (state.rounds_played[id] || 0) + 1;
      state.last_move[id] = me.move;
      state.history[id].push({ you: me.move, them: them.move });
      results.push({ round_no, team_id: id, earnings: pts, payload: {
        match: state.match, round_in_match: state.round_in_match, you: me.move, them: them.move,
        auto: me.auto, points: pts, cumulative: state.cum[id],
      } });
    }
  }
  if (state.bye && ids.includes(state.bye)) {
    results.push({ round_no, team_id: state.bye, earnings: 0, payload: {
      match: state.match, round_in_match: state.round_in_match, bye: true, points: 0, cumulative: state.cum[state.bye] || 0,
    } });
  }
  const matchOver = state.round_in_match >= state.match_length;
  const pub = { round_no, match: state.match, round_in_match: state.round_in_match, match_over: matchOver };
  const coop = results.filter((r) => r.payload.you);
  pub.cooperation_rate = coop.length ? round2(coop.filter((r) => r.payload.you === 'C').length / coop.length) : null;
  if (matchOver) pub.match_length = state.match_length;
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);

  let next;
  if (!matchOver) {
    state.round_in_match += 1;
    next = { open: openPdRound(state, c, ids, round_no + 1) };
  } else if (state.match < c.matches) {
    next = { open: startPdMatch(state, c, ids, round_no + 1, rng) };
  } else {
    next = { finished: true };
  }
  return { state, results, round_public: [{ round_no, payload: pub }], assignments: [], ...next };
}

// ---------------------------------------------------------------------------
// Public goods with optional punishment stage

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function formGroups(ids, size, rng) {
  const s = shuffle(ids, rng);
  const nGroups = Math.max(1, Math.floor(s.length / size));
  const groups = Array.from({ length: nGroups }, () => []);
  s.forEach((id, i) => groups[i % nGroups].push(id));
  return groups;
}

function openPgRound(state, c, ids, roundNo, rng) {
  if (!state.groups || c.matching === 'strangers') {
    state.groups = formGroups(ids, Math.max(2, c.group_size), rng);
    state.labels = {};
    for (const g of state.groups) shuffle(g, rng).forEach((id, i) => { state.labels[id] = LETTERS[i]; });
  }
  const punishRound = roundNo > c.rounds_no_punish;
  const groupOf = {};
  state.groups.forEach((g, gi) => g.forEach((id) => { groupOf[id] = gi; }));
  state.group_of = groupOf;
  return {
    round_no: roundNo, stage: 'contribute', seconds: c.contribute_seconds, required: ids,
    assignments: ids.map((id) => ({ team_id: id, info: {
      round_no: roundNo, group_size: state.groups[groupOf[id]].length, label: state.labels[id],
      punishment_round: punishRound, phase: punishRound ? 2 : 1, matching: c.matching,
    } })),
  };
}

function resolvePg(ctx, rng) {
  const { config: c, state, round_no, stage, teams } = ctx;
  const decisions = ctx.decisions || {};
  const ids = teams.map((t) => t.id);
  const totalRounds = c.rounds_no_punish + c.rounds_punish;
  const punishRound = round_no > c.rounds_no_punish;

  if (stage === 'contribute') {
    const contrib = {};
    for (const id of ids) {
      const d = decisions[id];
      contrib[id] = d ? Math.round(clamp(NUM(d.contribution, 0), 0, c.endowment)) : 0;
    }
    const base = {};
    const groupTotal = {};
    state.groups.forEach((g, gi) => {
      const G = g.reduce((s, id) => s + (contrib[id] ?? 0), 0);
      groupTotal[gi] = G;
      for (const id of g) base[id] = round2(c.endowment - contrib[id] + c.mpcr * G);
    });
    state.pending = { contrib, base, auto: Object.fromEntries(ids.map((id) => [id, !decisions[id]])) };
    if (!punishRound) return finishPgRound(ctx, {}, rng, totalRounds);
    // open punishment stage: everyone sees their group's contributions (anonymous letters)
    const assignments = ids.map((id) => {
      const gi = state.group_of[id];
      const others = state.groups[gi].filter((x) => x !== id).map((x) => ({ label: state.labels[x], contribution: contrib[x] }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return { team_id: id, info: {
        round_no, group_size: state.groups[gi].length, label: state.labels[id], punishment_round: true, phase: 2,
        matching: c.matching, your_contribution: contrib[id], group_total: groupTotal[gi], base_earnings: base[id], others,
      } };
    });
    return {
      state, results: [], round_public: [], assignments,
      open: { round_no, stage: 'punish', seconds: c.punish_seconds, required: ids, assignments },
    };
  }
  // stage === 'punish'
  return finishPgRound(ctx, decisions, rng, totalRounds);
}

function finishPgRound(ctx, punishDecisions, rng, totalRounds) {
  const { config: c, state, round_no, teams } = ctx;
  const ids = teams.map((t) => t.id);
  const { contrib, base, auto } = state.pending;
  const given = Object.fromEntries(ids.map((id) => [id, 0]));
  const received = Object.fromEntries(ids.map((id) => [id, 0]));
  const punishRound = round_no > c.rounds_no_punish;
  if (punishRound) {
    for (const id of ids) {
      const d = punishDecisions[id];
      if (!d || !d.points) continue;
      const gi = state.group_of[id];
      const byLabel = Object.fromEntries(state.groups[gi].filter((x) => x !== id).map((x) => [state.labels[x], x]));
      let budget = c.max_punish_points;
      for (const [label, raw] of Object.entries(d.points)) {
        const target = byLabel[label];
        if (!target) continue;
        const pts = Math.min(budget, Math.max(0, Math.round(NUM(raw, 0))));
        budget -= pts;
        given[id] += pts;
        received[target] += pts;
      }
    }
  }
  const results = [];
  const groupTotals = state.groups.map((g) => g.reduce((s, id) => s + (contrib[id] ?? 0), 0));
  for (const id of ids) {
    const gi = state.group_of[id];
    const cost = round2(given[id] * c.punish_cost);
    const deduction = round2(received[id] * c.punish_impact);
    const earnings = round2(base[id] - cost - deduction);
    state.cum[id] = round2((state.cum[id] || 0) + earnings);
    state.rounds_played[id] = (state.rounds_played[id] || 0) + 1;
    const others = state.groups[gi].filter((x) => x !== id).map((x) => ({ label: state.labels[x], contribution: contrib[x] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    results.push({ round_no, team_id: id, earnings, payload: {
      contribution: contrib[id], auto: auto[id], group_total: groupTotals[gi], group_size: state.groups[gi].length,
      kept: c.endowment - contrib[id], from_pot: round2(c.mpcr * groupTotals[gi]), base_earnings: base[id],
      punishment_round: punishRound, points_given: given[id], cost_of_punishing: cost,
      points_received: received[id], deduction, earnings, cumulative: state.cum[id], label: state.labels[id], others,
    } });
  }
  const allContrib = ids.map((id) => contrib[id] ?? 0);
  const pub = {
    round_no, phase: punishRound ? 2 : 1,
    average_contribution: round2(allContrib.reduce((s, x) => s + x, 0) / Math.max(1, allContrib.length)),
    average_share: round2(allContrib.reduce((s, x) => s + x, 0) / Math.max(1, allContrib.length) / c.endowment),
  };
  if (punishRound) pub.punishment_points = ids.reduce((s, id) => s + given[id], 0);
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);
  delete state.pending;
  const finished = round_no >= totalRounds;
  return {
    state, results, round_public: [{ round_no, payload: pub }], assignments: [],
    ...(finished ? { finished: true } : { open: openPgRound(state, c, ids, round_no + 1, rng) }),
  };
}

// ---------------------------------------------------------------------------
// Ultimatum / dictator

function openUgRound(state, c, ids, roundNo, rng) {
  const { pairs, bye } = makePairs(ids, state, rng);
  state.pairs = pairs.map(([a, b]) => (rng() < 0.5 ? { proposer: a, responder: b } : { proposer: b, responder: a }));
  state.bye = bye;
  const roleOf = {};
  for (const p of state.pairs) { roleOf[p.proposer] = 'proposer'; roleOf[p.responder] = 'responder'; }
  const assignments = ids.map((id) => ({ team_id: id, info: {
    round_no: roundNo, role: roleOf[id] || 'bye', pie: c.pie, variant: c.variant,
  } }));
  return { round_no: roundNo, stage: 'offer', seconds: c.offer_seconds, required: state.pairs.map((p) => p.proposer), assignments };
}

function resolveUg(ctx, rng) {
  const { config: c, state, round_no, stage, teams } = ctx;
  const decisions = ctx.decisions || {};
  const ids = teams.map((t) => t.id);
  if (stage === 'offer') {
    state.offers = {};
    for (const p of state.pairs) {
      const d = decisions[p.proposer];
      state.offers[p.proposer] = d && d.offer !== undefined && d.offer !== null ? Math.round(clamp(NUM(d.offer, 0), 0, c.pie)) : null;
    }
    if (c.variant === 'dictator') return finishUg(ctx, {}, rng);
    const assignments = ids.map((id) => {
      const pair = state.pairs.find((p) => p.proposer === id || p.responder === id);
      const role = pair ? (pair.proposer === id ? 'proposer' : 'responder') : 'bye';
      const info = { round_no, role, pie: c.pie, variant: c.variant };
      if (pair) info.offer = state.offers[pair.proposer];
      return { team_id: id, info };
    });
    const required = state.pairs.filter((p) => state.offers[p.proposer] !== null).map((p) => p.responder);
    if (required.length === 0) return finishUg(ctx, {}, rng);
    return { state, results: [], round_public: [], assignments,
      open: { round_no, stage: 'respond', seconds: c.respond_seconds, required, assignments } };
  }
  return finishUg(ctx, decisions, rng);
}

function finishUg(ctx, responses, rng) {
  const { config: c, state, round_no, teams } = ctx;
  const ids = teams.map((t) => t.id);
  const results = [];
  let accepted = 0, rejected = 0;
  const offerList = [];
  for (const p of state.pairs) {
    const offer = state.offers[p.proposer];
    let accept, autoResp = false;
    if (offer === null) accept = false;
    else if (c.variant === 'dictator') accept = true;
    else {
      const r = responses[p.responder];
      if (r && (r.accept === true || r.accept === false)) accept = r.accept;
      else { accept = true; autoResp = true; }
    }
    if (offer !== null) { offerList.push(offer); if (c.variant !== 'dictator') (accept ? accepted++ : rejected++); }
    const propPts = offer !== null && accept ? c.pie - offer : 0;
    const respPts = offer !== null && accept ? offer : 0;
    for (const [id, role, pts] of [[p.proposer, 'proposer', propPts], [p.responder, 'responder', respPts]]) {
      state.cum[id] = (state.cum[id] || 0) + pts;
      state.rounds_played[id] = (state.rounds_played[id] || 0) + 1;
      results.push({ round_no, team_id: id, earnings: pts, payload: {
        role, offer, accepted: offer === null ? null : accept, no_offer: offer === null,
        auto_response: role === 'responder' ? autoResp : undefined, points: pts, cumulative: state.cum[id], pie: c.pie,
      } });
    }
  }
  if (state.bye && ids.includes(state.bye)) {
    results.push({ round_no, team_id: state.bye, earnings: 0, payload: { role: 'bye', bye: true, points: 0, cumulative: state.cum[state.bye] || 0 } });
  }
  const pub = {
    round_no, variant: c.variant,
    average_offer: offerList.length ? round2(offerList.reduce((s, x) => s + x, 0) / offerList.length) : null,
    offers: offerList.slice().sort((a, b) => a - b),
  };
  if (c.variant !== 'dictator') pub.rejection_rate = accepted + rejected ? round2(rejected / (accepted + rejected)) : null;
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);
  delete state.offers;
  const finished = round_no >= c.rounds;
  return { state, results, round_public: [{ round_no, payload: pub }], assignments: [],
    ...(finished ? { finished: true } : { open: openUgRound(state, c, ids, round_no + 1, rng) }) };
}

// ---------------------------------------------------------------------------
// Tragedy of the commons
//   fishery: groups share a lake. Each season everyone chooses how many fish to catch; what is
//            left multiplies by `growth` (up to capacity). Fishing games have a hidden length.
//   simple:  each round everyone chooses extract or wait. If all wait, the pool multiplies and is
//            split equally; otherwise the extractors split the original pool and waiters get nothing.
// Both can open with a chat stage in which group members message each other anonymously.

function chatOn(c, match, roundNo, season) {
  if (c.chat === 'on') return true;
  if (c.chat !== 'later') return false;
  if (c.variant === 'simple') return roundNo > Math.floor(c.rounds / 2);
  if (c.matches >= 2) return match > Math.floor(c.matches / 2);
  return season > Math.floor(c.min_seasons / 2);
}

function setGroups(state, groups, rng) {
  state.groups = groups;
  state.labels = {};
  state.group_of = {};
  groups.forEach((g, gi) => {
    shuffle(g, rng).forEach((id, i) => { state.labels[id] = LETTERS[i]; });
    for (const id of g) state.group_of[id] = gi;
  });
}

/** New random groups with the same sizes as the current ones (so group i keeps lake i). */
function regroup(state, ids, rng) {
  const sizes = state.groups.map((g) => g.length);
  const s = shuffle(ids, rng);
  const groups = [];
  let k = 0;
  for (const n of sizes) { groups.push(s.slice(k, k + n)); k += n; }
  return groups;
}

function commonsRequired(state, c, ids) {
  if (c.variant === 'simple') return ids.filter((id) => state.group_of[id] !== undefined);
  return ids.filter((id) => state.group_of[id] !== undefined && state.lakes[state.group_of[id]].stock > 0);
}

function commonsAssignments(state, c, ids, roundNo, chat) {
  return ids.map((id) => {
    const gi = state.group_of[id];
    const g = state.groups[gi] || [];
    const base = {
      variant: c.variant, round_no: roundNo, chat, matching: c.matching,
      group_key: c.matching === 'partners'
        ? (c.variant === 'simple' ? `g${gi}` : `m${state.match}-g${gi}`)
        : `r${roundNo}-g${gi}`,
      group_size: g.length, label: state.labels[id],
      members: g.map((x) => state.labels[x]).sort(),
    };
    if (c.variant === 'simple') {
      return { team_id: id, info: { ...base, rounds: c.rounds, pool: c.pool_per_member * g.length, multiplier: c.multiplier } };
    }
    const lake = state.lakes[gi];
    return { team_id: id, info: {
      ...base, match: state.match, matches: c.matches, season: state.season, lake: gi + 1,
      stock: lake.stock, capacity: lake.capacity, max_catch: c.max_catch, fish_price: c.fish_price,
      history: lake.history,
    } };
  });
}

function openCommonsStage(state, c, ids, roundNo) {
  const chat = chatOn(c, state.match || 1, roundNo, state.season || roundNo);
  return {
    round_no: roundNo, stage: chat ? 'chat' : 'decide',
    seconds: chat ? c.chat_seconds : c.decide_seconds,
    required: commonsRequired(state, c, ids),
    assignments: commonsAssignments(state, c, ids, roundNo, chat),
  };
}

function startFishingGame(state, c, ids, roundNo, rng) {
  state.match += 1;
  state.match_length = randInt(c.min_seasons, c.max_seasons, rng); // hidden from players
  state.season = 1;
  setGroups(state, formGroups(ids, c.group_size, rng), rng);
  state.lakes = state.groups.map((g) => {
    const cap = c.fish_per_member * g.length;
    return { capacity: cap, stock: cap, history: [] };
  });
  return openCommonsStage(state, c, ids, roundNo);
}

function openSimpleRound(state, c, ids, roundNo, rng) {
  if (!state.groups || c.matching === 'strangers') setGroups(state, formGroups(ids, c.group_size, rng), rng);
  return openCommonsStage(state, c, ids, roundNo);
}

function resolveCommons(ctx, rng) {
  const { config: c, state, round_no, stage, teams } = ctx;
  const ids = teams.map((t) => t.id);
  if (stage === 'chat') {
    // Chat is over: the same groups now decide.
    const assignments = commonsAssignments(state, c, ids, round_no, true);
    return { state, results: [], round_public: [], assignments,
      open: { round_no, stage: 'decide', seconds: c.decide_seconds, required: commonsRequired(state, c, ids), assignments } };
  }
  return c.variant === 'simple' ? resolveSimple(ctx, rng) : resolveSeason(ctx, rng);
}

function resolveSeason(ctx, rng) {
  const { config: c, state, round_no, teams } = ctx;
  const decisions = ctx.decisions || {};
  const ids = teams.map((t) => t.id);
  const results = [];
  const lakesPub = [];
  const catches = [];
  state.groups.forEach((g, gi) => {
    const lake = state.lakes[gi];
    const start = lake.stock;
    const req = {}, auto = {};
    for (const id of g) {
      const d = decisions[id];
      const v = d && d.catch !== undefined && d.catch !== null && d.catch !== '' ? Number(d.catch) : NaN;
      if (Number.isFinite(v)) { req[id] = Math.round(clamp(v, 0, c.max_catch)); auto[id] = false; }
      else { req[id] = start > 0 ? Math.min(c.max_catch, state.last_catch[id] ?? 0) : 0; auto[id] = start > 0; }
    }
    const asked = g.reduce((s, id) => s + req[id], 0);
    const got = {};
    if (asked <= start) for (const id of g) got[id] = req[id];
    else {
      // Not enough fish for everyone: shares in proportion to what was asked (largest remainders get the leftovers).
      const exact = g.map((id) => ({ id, x: (req[id] * start) / asked }));
      for (const e of exact) got[e.id] = Math.floor(e.x);
      let left = start - exact.reduce((s, e) => s + got[e.id], 0);
      for (const e of exact.slice().sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)))) {
        if (left <= 0) break;
        got[e.id] += 1; left -= 1;
      }
    }
    const caught = g.reduce((s, id) => s + got[id], 0);
    const remaining = start - caught;
    const next = Math.min(lake.capacity, Math.floor(remaining * c.growth + 1e-9));
    lake.history.push({ season: state.season, start, caught, left: remaining, next });
    lake.stock = next;
    lakesPub.push({ lake: gi + 1, capacity: lake.capacity, start, caught, next });
    for (const id of g) {
      const earnings = round2(got[id] * c.fish_price);
      if (!auto[id] && start > 0) state.last_catch[id] = req[id];
      state.cum[id] = round2((state.cum[id] || 0) + earnings);
      state.rounds_played[id] = (state.rounds_played[id] || 0) + 1;
      if (start > 0) catches.push(got[id]);
      results.push({ round_no, team_id: id, earnings, payload: {
        variant: 'fishery', match: state.match, season: state.season, lake: gi + 1, label: state.labels[id],
        requested: req[id], catch: got[id], auto: auto[id], empty_lake: start === 0,
        stock_start: start, group_catch: caught, stock_left: remaining, stock_next: next, capacity: lake.capacity,
        others: g.filter((x) => x !== id).map((x) => ({ label: state.labels[x], catch: got[x] })).sort((a, b) => a.label.localeCompare(b.label)),
        earnings, cumulative: state.cum[id],
      } });
    }
  });
  const allEmpty = state.lakes.every((l) => l.stock === 0);
  const matchOver = state.season >= state.match_length || allEmpty;
  const pub = {
    round_no, variant: 'fishery', match: state.match, season: state.season, lakes: lakesPub,
    average_level: round2(lakesPub.reduce((s, l) => s + l.next / l.capacity, 0) / Math.max(1, lakesPub.length)),
    average_catch: catches.length ? round2(catches.reduce((s, x) => s + x, 0) / catches.length) : null,
    lakes_empty: lakesPub.filter((l) => l.next === 0).length,
    match_over: matchOver,
  };
  if (matchOver) { pub.seasons_played = state.season; pub.all_empty = allEmpty; }
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);
  let next;
  if (!matchOver) {
    state.season += 1;
    if (c.matching === 'strangers') setGroups(state, regroup(state, ids, rng), rng);
    next = { open: openCommonsStage(state, c, ids, round_no + 1) };
  } else if (state.match < c.matches) {
    next = { open: startFishingGame(state, c, ids, round_no + 1, rng) };
  } else {
    next = { finished: true };
  }
  return { state, results, round_public: [{ round_no, payload: pub }], assignments: [], ...next };
}

function resolveSimple(ctx, rng) {
  const { config: c, state, round_no, teams } = ctx;
  const decisions = ctx.decisions || {};
  const ids = teams.map((t) => t.id);
  const results = [];
  let extractN = 0, people = 0, allWaitGroups = 0;
  state.groups.forEach((g) => {
    const choice = {}, auto = {};
    for (const id of g) {
      const d = decisions[id];
      if (d && (d.choice === 'extract' || d.choice === 'wait')) { choice[id] = d.choice; auto[id] = false; }
      else { choice[id] = 'wait'; auto[id] = true; }
    }
    const pool = c.pool_per_member * g.length;
    const k = g.filter((id) => choice[id] === 'extract').length;
    const grown = k === 0 ? round2(pool * c.multiplier) : null;
    if (k === 0) allWaitGroups++;
    extractN += k; people += g.length;
    for (const id of g) {
      const earnings = k === 0 ? round2(grown / g.length) : choice[id] === 'extract' ? round2(pool / k) : 0;
      state.cum[id] = round2((state.cum[id] || 0) + earnings);
      state.rounds_played[id] = (state.rounds_played[id] || 0) + 1;
      results.push({ round_no, team_id: id, earnings, payload: {
        variant: 'simple', label: state.labels[id], choice: choice[id], auto: auto[id], group_size: g.length,
        pool, extractors: k, grown, earnings, cumulative: state.cum[id],
        others: g.filter((x) => x !== id).map((x) => ({ label: state.labels[x], choice: choice[x] })).sort((a, b) => a.label.localeCompare(b.label)),
      } });
    }
  });
  const pub = { round_no, variant: 'simple', extract_rate: people ? round2(extractN / people) : null,
    groups: state.groups.length, groups_all_waited: allWaitGroups };
  if (c.leaderboard === 'live') pub.leaderboard = leaderboard(teams, state);
  const finished = round_no >= c.rounds;
  return { state, results, round_public: [{ round_no, payload: pub }], assignments: [],
    ...(finished ? { finished: true } : { open: openSimpleRound(state, c, ids, round_no + 1, rng) }) };
}
