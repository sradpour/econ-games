import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, resolveStage, makeRng, allocateRationing, benchmarks, normalizeConfig, costsModel, scoreSchedule } from '../supabase/functions/_shared/engine.js';

const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` }));

function run(gameType, cfg, ts, decide, seed = 1) {
  const rng = makeRng(seed);
  const s = startGame(gameType, cfg, ts, rng);
  let state = s.state, open = s.open, allResults = [], pubs = [], outputs = [...s.outputs], steps = 0;
  while (open && steps < 500) {
    steps++;
    const decisions = {};
    for (const id of open.required) {
      const a = open.assignments.find((x) => x.team_id === id)?.info;
      const d = decide(id, open, a);
      if (d !== undefined) decisions[id] = d;
    }
    const r = resolveStage({ gameType, config: s.config, state, round_no: open.round_no, stage: open.stage, teams: ts, decisions }, rng);
    state = r.state; allResults.push(...r.results); pubs.push(...r.round_public); outputs.push(...r.outputs);
    open = r.finished ? null : r.open;
  }
  return { state, allResults, pubs, outputs, config: s.config };
}

test('rationing serves cheapest sellers first and respects demand', () => {
  const sales = allocateRationing(
    [{ id: 'a', price: 5, quantity: 50 }, { id: 'b', price: 8, quantity: 50 }, { id: 'c', price: 15, quantity: 50 }],
    (p) => Math.max(0, 100 - 5 * p), 0, Math.random);
  assert.equal(sales.a, 50);       // demand at 5 is 75
  assert.equal(sales.b, 10);       // demand at 8 is 60, 50 already sold
  assert.equal(sales.c, 0);        // demand at 15 is 25, already exhausted
});

test('competitive market: price-taking at the equilibrium earns the benchmark profit', () => {
  const b = benchmarks('competitive', {}, 10);
  const { allResults } = run('competitive', { rounds: 2, price_noise: 0, price_range: 0 }, teams(10),
    () => ({ participate: true, price: b.price, quantity: b.quantity_per_firm }));
  for (const r of allResults) {
    assert.equal(r.payload.sold, 60);
    assert.equal(r.payload.profit, b.profit_per_firm);
  }
});

test('competitive market: overpriced firm sells nothing and eats its costs', () => {
  const { allResults } = run('competitive', { rounds: 1, price_noise: 0 }, teams(5),
    (id) => (id === 't1' ? { price: 15, quantity: 60 } : { price: 8, quantity: 60 }));
  const t1 = allResults.find((r) => r.team_id === 't1').payload;
  assert.equal(t1.sold, 0);
  assert.ok(t1.profit < -300);
});

test('competitive market: fixed market price; above it sells a small share, at or below it sells everything', () => {
  const ts = teams(10);
  const { allResults, pubs } = run('competitive', { rounds: 1, price_range: 0 }, ts, (id) => (
    id === 't1' ? { price: 8.4, quantity: 60 } : id === 't2' ? { price: 7, quantity: 60 } : { price: 8, quantity: 60 }));
  const by = Object.fromEntries(allResults.map((r) => [r.team_id, r.payload]));
  assert.equal(pubs[0].payload.market_price, 8);
  assert.equal(by.t2.sold, 60); assert.equal(by.t2.revenue, 420);   // below: sells everything at its own (lower) price
  assert.equal(by.t3.sold, 60);
  assert.equal(by.t1.sold, 13);                                       // 5% above: about 22%
  assert.ok(by.t1.above_market);
  // The market price does not move with firms' choices
  const glut = run('competitive', { rounds: 1, price_range: 0 }, ts, () => ({ price: 8, quantity: 150 }));
  assert.equal(glut.pubs[0].payload.market_price, 8);
  assert.ok(glut.allResults.every((r) => r.payload.sold === 150));
  const far = run('competitive', { rounds: 1, price_range: 0 }, ts, (id) => (id === 't1' ? { price: 9.6, quantity: 60 } : { price: 8, quantity: 60 }));
  assert.equal(far.allResults.find((r) => r.team_id === 't1').payload.sold, 0);
  // The instructor can set the market price; benchmarks follow it
  const set = run('competitive', { rounds: 1, market_price: 10, price_range: 0 }, ts, () => ({ price: 10, quantity: 80 }));
  assert.equal(set.pubs[0].payload.market_price, 10);
  assert.equal(benchmarks('competitive', { market_price: 10 }, 10).quantity_per_firm, 80);
  // The old rule is still available
  const old = run('competitive', { rounds: 1, market_rule: 'cheapest', price_noise: 0 }, ts, (id) => (id === 't1' ? { price: 9.6, quantity: 60 } : { price: 8, quantity: 50 }));
  assert.equal(old.allResults.find((r) => r.team_id === 't1').payload.sold, 60);
});

test('competitive market: each round has its own round-number market price near the equilibrium', () => {
  const rng = makeRng(11);
  const ts = teams(6);
  const s = startGame('competitive', { rounds: 30 }, ts, rng);
  let state = s.state, open = s.open;
  const prices = [];
  while (open) {
    const P = open.assignments[0].info.market_price;
    prices.push(P);
    assert.ok(open.assignments.every((a) => a.info.market_price === P), 'everyone sees the same price');
    // price takers: sell everything at the market price, nothing much above it
    const r = resolveStage({ gameType: 'competitive', config: s.config, state, round_no: open.round_no, stage: 'decide', teams: ts,
      decisions: Object.fromEntries(ts.map((t, i) => [t.id, { price: i === 0 ? P + 1 : P, quantity: 50 }])) }, rng);
    assert.equal(r.round_public[0].payload.market_price, P);
    assert.equal(r.results.find((x) => x.team_id === 't2').payload.sold, 50);
    assert.ok(r.results.find((x) => x.team_id === 't1').payload.sold < 5);
    state = r.state; open = r.finished ? null : r.open;
  }
  assert.ok(prices.every((p) => p >= 6 && p <= 10 && Math.abs(p * 2 - Math.round(p * 2)) < 1e-9), prices.join(' '));
  assert.ok(new Set(prices).size >= 5, 'prices vary');
  assert.ok(prices.every((p, i) => i === 0 || p !== prices[i - 1]), 'no repeats in a row');
  // range 0: the same price every round
  const fixed = run('competitive', { rounds: 3, price_range: 0 }, ts, () => ({ price: 8, quantity: 60 }));
  assert.deepEqual(fixed.pubs.map((p) => p.payload.market_price), [8, 8, 8]);
});

test('sitting out saves the avoidable share of fixed cost; missing deadline policies', () => {
  const sit = run('competitive', { rounds: 1, missed: 'sit_out' }, teams(4), (id) => (id === 't1' ? undefined : { price: 8, quantity: 60 }));
  const t1 = sit.allResults.find((r) => r.team_id === 't1').payload;
  assert.equal(t1.participated, false);
  assert.equal(t1.auto, true);
  assert.equal(t1.profit, -50);
  const keep = run('competitive', { rounds: 2, missed: 'keep_last', price_noise: 0 }, teams(4),
    (id, open) => (id === 't1' && open.round_no === 2 ? undefined : { price: 8, quantity: 60 }));
  const r2 = keep.allResults.find((r) => r.team_id === 't1' && r.round_no === 2).payload;
  assert.equal(r2.participated, true);
  assert.equal(r2.price, 8);
  assert.equal(r2.auto, true);
});

test('oligopoly: lower price sells more, overpriced firm still sells a little', () => {
  const { allResults, pubs } = run('oligopoly', { rounds: 1, demand_noise: 0 }, teams(7),
    (id) => ({ price: id === 't1' ? 9 : id === 't2' ? 16 : 11.5 }));
  const p = Object.fromEntries(allResults.map((r) => [r.team_id, r.payload]));
  assert.ok(p.t1.sold > p.t3.sold);
  assert.ok(p.t2.sold > 0 && p.t2.sold < p.t3.sold);
  assert.ok(pubs[0].payload.leaderboard.length === 7);
  assert.equal(pubs[0].payload.prices, undefined); // prices hidden by default
});

test('oligopoly: Nash benchmark is a best response (no profitable deviation)', () => {
  const b = benchmarks('oligopoly', {}, 7);
  const profitWith = (myPrice) => run('oligopoly', { rounds: 1, demand_noise: 0 }, teams(7),
    (id) => ({ price: id === 't1' ? myPrice : b.nash_price })).allResults.find((r) => r.team_id === 't1').payload.profit;
  const atNash = profitWith(b.nash_price);
  assert.ok(profitWith(b.nash_price + 1.5) < atNash);
  assert.ok(profitWith(b.nash_price - 1.5) < atNash);
  assert.ok(b.joint_price > b.nash_price);
});

test('monopolistic competition: branding builds stock and raises demand', () => {
  const { allResults } = run('monopolistic', { rounds: 4, demand_noise: 0 }, teams(10),
    (id) => ({ price: 12, quantity: 300, branding: id === 't1' ? 100 : 0 }));
  const last = Object.fromEntries(allResults.filter((r) => r.round_no === 4).map((r) => [r.team_id, r.payload]));
  assert.ok(last.t1.brand_stock > 150);
  assert.ok(last.t1.demand > last.t2.demand * 1.3);
  assert.ok(last.t1.unsold >= 0);
});

test('monopoly: benchmark choice yields benchmark profit', () => {
  const b = benchmarks('monopoly', {}, 1);
  const { allResults } = run('monopoly', { rounds: 1 }, teams(3), () => ({ price: b.price, quantity: b.quantity }));
  for (const r of allResults) assert.ok(Math.abs(r.payload.profit - b.profit) < 15);
});

test('repeated PD: matches have hidden random lengths within bounds, byes for odd counts', () => {
  const { allResults, pubs, outputs } = run('pd_live', { matches: 3, min_rounds: 10, max_rounds: 20 }, teams(7), () => ({ move: 'C' }));
  const ends = pubs.filter((p) => p.payload.match_over);
  assert.equal(ends.length, 3);
  for (const e of ends) assert.ok(e.payload.match_length >= 10 && e.payload.match_length <= 20);
  const byes = allResults.filter((r) => r.payload.bye);
  assert.equal(byes.length, pubs.length); // exactly one bye per round with 7 players
  const coop = allResults.filter((r) => !r.payload.bye);
  for (const r of coop) assert.equal(r.payload.points, 3);
  const final = outputs.find((o) => o.kind === 'final');
  assert.equal(final.payload.ranked_by, 'average');
  for (const row of final.payload.leaderboard) assert.equal(row.average, 3);
});

test('repeated PD: payoffs and missing-move rule', () => {
  const { allResults } = run('pd_live', { matches: 1, min_rounds: 3, max_rounds: 3 }, teams(2),
    (id, open) => (id === 't1' ? { move: 'D' } : open.round_no === 1 ? { move: 'C' } : undefined));
  const t1 = allResults.filter((r) => r.team_id === 't1').map((r) => r.payload.points);
  const t2 = allResults.filter((r) => r.team_id === 't2').map((r) => r.payload);
  assert.deepEqual(t1, [5, 5, 5]);
  assert.equal(t2[1].auto, true);
  assert.equal(t2[1].you, 'C'); // repeats last move
});

test('public goods: earnings formula, punishment stage only in phase 2', () => {
  const { allResults, pubs } = run('public_goods', { rounds_no_punish: 2, rounds_punish: 2, group_size: 4 }, teams(8),
    (id, open, a) => {
      if (open.stage === 'contribute') return { contribution: id === 't1' ? 0 : 20 };
      const lowLabel = a.others.find((o) => o.contribution === 0)?.label;
      return lowLabel ? { points: { [lowLabel]: 3 } } : { points: {} };
    });
  const r1 = allResults.filter((r) => r.round_no === 1);
  const t1 = r1.find((r) => r.team_id === 't1').payload;
  assert.equal(t1.earnings, 20 + 0.4 * 60);       // free-rider keeps 20 and gets 0.4 × 60
  const r3 = allResults.filter((r) => r.round_no === 3);
  const p1 = r3.find((r) => r.team_id === 't1').payload;
  assert.equal(p1.points_received, 9);            // three groupmates × 3 points
  assert.equal(p1.deduction, 27);
  const punisher = r3.find((r) => r.team_id !== 't1' && r.payload.others.some((o) => o.contribution === 0)).payload;
  assert.equal(punisher.cost_of_punishing, 3);
  assert.equal(pubs.length, 4);
});

test('public goods: partners keep groups, strangers reshuffle', () => {
  const groupsSeen = (matching) => {
    const rng = makeRng(7);
    const s = startGame('public_goods', { matching, rounds_no_punish: 5, rounds_punish: 0 }, teams(12), rng);
    const seen = [JSON.stringify(s.state.groups)];
    let state = s.state, open = s.open;
    while (open) {
      const r = resolveStage({ gameType: 'public_goods', config: s.config, state, round_no: open.round_no, stage: open.stage, teams: teams(12), decisions: {} }, rng);
      state = r.state; open = r.finished ? null : r.open;
      if (open) seen.push(JSON.stringify(state.groups));
    }
    return new Set(seen).size;
  };
  assert.equal(groupsSeen('partners'), 1);
  assert.ok(groupsSeen('strangers') > 1);
});

test('ultimatum: rejection gives both zero; dictator skips response', () => {
  const ug = run('ultimatum', { rounds: 3 }, teams(6),
    (id, open, a) => (open.stage === 'offer' ? { offer: 1 } : { accept: false }));
  for (const r of ug.allResults) assert.equal(r.payload.points, 0);
  const dg = run('ultimatum', { rounds: 3, variant: 'dictator' }, teams(5), () => ({ offer: 3 }));
  const props = dg.allResults.filter((r) => r.payload.role === 'proposer');
  for (const r of props) assert.equal(r.payload.points, 7);
  assert.equal(dg.allResults.filter((r) => r.payload.bye).length, 3);
});

test('final output leaderboard is ranked and respects visibility', () => {
  const { outputs } = run('competitive', { rounds: 1, leaderboard: 'never' }, teams(3), (id) => ({ price: 8, quantity: id === 't1' ? 60 : 10 }));
  const final = outputs.find((o) => o.kind === 'final');
  assert.equal(final.visibility, 'instructor');
  assert.equal(final.payload.leaderboard[0].rank, 1);
});

test('config normalisation coerces strings and clamps round bounds', () => {
  const c = normalizeConfig('pd_live', { min_rounds: '15', max_rounds: '12', team_mode: 'weird' });
  assert.equal(c.min_rounds, 15);
  assert.equal(c.max_rounds, 15);
  assert.equal(c.team_mode, 'individual');
});

import { laborHours, marginalProduct, marginalCost, outputFromHours, variableCost } from '../supabase/functions/_shared/engine.js';

test('production story reproduces the calibrated cost curve', () => {
  const c = normalizeConfig('competitive', {});
  assert.equal(c.mc_intercept, 2);
  assert.ok(Math.abs(c.mc_slope - 0.1) < 1e-12);
  for (const q of [0, 10, 60, 100]) {
    const fromStory = laborHours(q, c) * c.wage + q * c.material_qty * c.material_price;
    assert.ok(Math.abs(fromStory - variableCost(q, c)) < 1e-9, `q=${q}`);
    // MC = wage / MP + materials
    assert.ok(Math.abs(c.wage / marginalProduct(q, c) + c.material_qty * c.material_price - marginalCost(q, c)) < 1e-9);
  }
  assert.equal(marginalProduct(60, c), 2);          // at equilibrium an extra hour adds 2 loaves
  assert.ok(Math.abs(outputFromHours(laborHours(37, c), c) - 37) < 1e-9);
  assert.ok(marginalProduct(10, c) > marginalProduct(50, c)); // diminishing marginal product
});

test('older games without the production fields keep their cost curve', () => {
  const c = normalizeConfig('competitive', { mc_intercept: 3, mc_slope: 0.2 });
  assert.equal(c.mc_intercept, 3);
  assert.equal(c.mc_slope, 0.2);
});

test('results include labor hours and cost breakdown', () => {
  const r = run('competitive', { rounds: 1, price_noise: 0 }, teams(2), (id) => (id === 't1' ? { price: 8, quantity: 60 } : undefined));
  const a = r.allResults.find((x) => x.team_id === 't1').payload;
  assert.equal(a.labor_hours, 18);
  assert.equal(a.labor_cost, 270);
  assert.equal(a.material_cost, 30);
  assert.equal(a.rent + a.equipment, 100);
  assert.equal(a.labor_cost + a.material_cost, a.variable_cost);
  const b = r.allResults.find((x) => x.team_id === 't2').payload;
  assert.equal(b.rent, 50); assert.equal(b.equipment, 0);
});

test('changing wage or productivity changes marginal cost', () => {
  const c = normalizeConfig('monopoly', { wage: 20, base_productivity: 10, productivity_half: 10, material_qty: 1, material_price: 1 });
  assert.equal(c.mc_intercept, 3);
  assert.equal(c.mc_slope, 0.2);
});

test('commons fishery: sustainable catch keeps the lake full; greed empties it', () => {
  const b = benchmarks('commons', {}, 9);
  assert.equal(b.capacity, 60);
  assert.equal(b.sustainable_group_catch, 30);
  // Everyone takes 10: lake refills every season, every season pays 10.
  const fair = run('commons', { chat: 'off', matches: 1, min_seasons: 5, max_seasons: 5 }, teams(9), () => ({ catch: 10 }));
  assert.equal(fair.pubs.length, 5);
  assert.ok(fair.allResults.every((r) => r.payload.catch === 10 && r.payload.stock_next === 60));
  assert.equal(fair.state.cum.t1, 50);
  // Everyone takes 20: all lakes empty after one season and the game ends early.
  const greedy = run('commons', { chat: 'off', matches: 1, min_seasons: 5, max_seasons: 5 }, teams(9), () => ({ catch: 20 }));
  assert.equal(greedy.pubs.length, 1);
  assert.equal(greedy.pubs[0].payload.lakes_empty, 3);
  assert.equal(greedy.pubs[0].payload.match_over, true);
  assert.equal(greedy.state.cum.t1, 20);
});

test('commons fishery: over-asking is rationed, overfishing shrinks the lake, groups of three', () => {
  const rng = makeRng(3);
  const ts = teams(10);
  const s = startGame('commons', { chat: 'off', matches: 1, min_seasons: 3, max_seasons: 3 }, ts, rng);
  assert.equal(s.open.stage, 'decide');
  assert.deepEqual(s.state.groups.map((g) => g.length).sort(), [3, 3, 4]);
  const info = s.open.assignments[0].info;
  assert.equal(info.capacity, info.group_size * 20);
  assert.ok(['A', 'B', 'C', 'D'].includes(info.label));
  // One person takes 20, the rest 10, in every group
  const decisions = {};
  for (const g of s.state.groups) g.forEach((id, i) => { decisions[id] = { catch: i === 0 ? 20 : 10 }; });
  const r = resolveStage({ gameType: 'commons', config: s.config, state: s.state, round_no: 1, stage: 'decide', teams: ts, decisions }, rng);
  const three = r.round_public[0].payload.lakes.find((l) => l.capacity === 60);
  assert.deepEqual([three.start, three.caught, three.next], [60, 40, 40]);
  const me = r.results.find((x) => x.payload.capacity === 60 && x.payload.catch === 20);
  assert.equal(me.payload.others.length, 2);
  // Lake of 10 fish, three people ask 20 each: they share all 10
  const st = structuredClone(r.state);
  st.lakes.forEach((l) => { l.stock = 10; });
  const d2 = Object.fromEntries(ts.map((t) => [t.id, { catch: 20 }]));
  const r2 = resolveStage({ gameType: 'commons', config: s.config, state: st, round_no: 2, stage: 'decide', teams: ts, decisions: d2 }, rng);
  for (const l of r2.round_public[0].payload.lakes) assert.equal(l.caught, 10);
  assert.ok(r2.finished, 'all lakes empty ends the last fishing game');
});

test('commons: chat stage comes first, then the decision; "later" turns chat on in the second game', () => {
  const rng = makeRng(5);
  const ts = teams(6);
  const s = startGame('commons', { chat: 'later', matches: 2, min_seasons: 1, max_seasons: 1 }, ts, rng);
  assert.equal(s.open.stage, 'decide');
  assert.equal(s.open.assignments[0].info.chat, false);
  const r = resolveStage({ gameType: 'commons', config: s.config, state: s.state, round_no: 1, stage: 'decide', teams: ts, decisions: {} }, rng);
  assert.equal(r.open.stage, 'chat');
  assert.equal(r.open.assignments[0].info.chat, true);
  assert.match(r.open.assignments[0].info.group_key, /^m2-g\d$/);
  const r2 = resolveStage({ gameType: 'commons', config: s.config, state: r.state, round_no: 2, stage: 'chat', teams: ts, decisions: {} }, rng);
  assert.equal(r2.open.stage, 'decide');
  assert.equal(r2.open.round_no, 2);
  assert.equal(r2.results.length, 0);
});

test('commons fishery strangers: new groups each season, lakes keep their stock', () => {
  const rng = makeRng(8);
  const ts = teams(9);
  const s = startGame('commons', { chat: 'off', matching: 'strangers', matches: 1, min_seasons: 4, max_seasons: 4 }, ts, rng);
  const r = resolveStage({ gameType: 'commons', config: s.config, state: s.state, round_no: 1, stage: 'decide', teams: ts,
    decisions: Object.fromEntries(ts.map((t) => [t.id, { catch: 15 }])) }, rng);
  assert.ok(r.open.assignments.every((a) => a.info.stock === 30));
  assert.match(r.open.assignments[0].info.group_key, /^r2-g\d$/);
  assert.notDeepEqual(r.state.groups, s.state.groups);
});

test('commons simple: extract or wait payoffs', () => {
  const rng = makeRng(2);
  const ts = teams(3);
  const s = startGame('commons', { variant: 'simple', chat: 'off', rounds: 3 }, ts, rng);
  const step = (state, round_no, choices) => resolveStage({ gameType: 'commons', config: s.config, state, round_no, stage: 'decide', teams: ts,
    decisions: Object.fromEntries(ts.map((t, i) => [t.id, { choice: choices[i] }])) }, rng);
  const earn = (r) => ts.map((t) => r.results.find((x) => x.team_id === t.id).earnings);
  const a = step(s.state, 1, ['wait', 'wait', 'wait']);
  assert.deepEqual(earn(a), [20, 20, 20]);
  const b = step(a.state, 2, ['extract', 'wait', 'wait']);
  assert.deepEqual(earn(b), [30, 0, 0]);
  const c = step(b.state, 3, ['extract', 'extract', 'wait']);
  assert.deepEqual(earn(c), [15, 15, 0]);
  assert.ok(c.finished);
  assert.equal(c.state.cum.t1, 65);
  const bm = benchmarks('commons', { variant: 'simple' }, 3);
  assert.deepEqual([bm.all_wait_each, bm.all_extract_each, bm.lone_extractor], [20, 10, 30]);
});

test('costs: cost table follows the bills; supply follows MC above the lowest AVC', () => {
  const m = costsModel({});
  assert.equal(m.fixed, 170);                       // rent + insurance
  assert.equal(m.opening, 140);                     // lease + income given up by opening
  assert.deepEqual(m.rows.map((r) => r.q), [0, 30, 80, 140, 190, 230, 260, 290, 310, 325, 335]);
  assert.equal(m.rows[0].vc, 0);
  assert.equal(m.rows[1].vc, 290);                  // 120 wages + 30 × $1 inputs + 140 opening
  assert.equal(m.rows[5].tc, 1140);
  assert.equal(m.rows[8].mc, 7);                    // 8th worker: (120 + 20 × $1) / 20
  assert.deepEqual(m.supply.map((x) => x.q), [0, 0, 230, 290, 290, 310, 310, 325]);
  // Below the lowest AVC the firm closes even though some workers have MC below the price
  const minAvc = Math.min(...m.rows.filter((r) => r.q).map((r) => r.avc));
  for (const x of m.supply) assert.equal(x.q === 0, x.price * m.keep < minAvc);
});

test('costs: scoring is 100 for the best schedule and punishes the classic mistakes', () => {
  const m = costsModel({});
  const best = Object.fromEntries(m.supply.map((x) => [x.price, x.workers]));
  assert.equal(scoreSchedule(m, best).score, 100);
  assert.equal(scoreSchedule(m, best).right, 8);
  const shutOnLoss = Object.fromEntries(m.supply.map((x) => [x.price, x.profit < 0 ? 0 : x.workers]));
  const s1 = scoreSchedule(m, shutOnLoss);
  assert.ok(s1.score < 100 && s1.score > 80, `closing on an accounting loss: ${s1.score}`);
  assert.equal(s1.per[2].q, 0); assert.ok(s1.per[2].lost > 0);
  const always = Object.fromEntries(m.c.price_list.map((p) => [p, m.maxWorkers]));
  assert.ok(scoreSchedule(m, always).score < 70);
  const blank = scoreSchedule(m, {});
  assert.equal(blank.filled, 0);
  assert.ok(blank.score < 50);
});

test('costs: one round, resolved by the instructor; everyone scored, class averages published', () => {
  const ts = teams(3);
  const s = startGame('costs', {}, ts, makeRng(1));
  assert.equal(s.open.stage, 'decide');
  assert.equal(s.open.seconds, 0);
  assert.equal(s.config.auto_advance, false);
  const m = costsModel(s.config);
  const best = Object.fromEntries(m.supply.map((x) => [String(x.price), x.workers]));
  const r = resolveStage({ gameType: 'costs', config: s.config, state: s.state, round_no: 1, stage: 'decide', teams: ts,
    decisions: { t1: { schedule: best, v: { 'mp:1': '30' } }, t2: { schedule: { 3: 10, 4: 10 } } } });
  assert.equal(r.finished, true);
  const by = Object.fromEntries(r.results.map((x) => [x.team_id, x]));
  assert.equal(by.t1.earnings, 100);
  assert.ok(by.t2.earnings < by.t1.earnings);
  assert.equal(by.t3.payload.auto, true);
  const pub = r.round_public[0].payload;
  assert.equal(pub.correct.length, 8);
  assert.equal(pub.class_average_q.length, 8);
  const fin = r.outputs.find((o) => o.kind === 'final');
  assert.equal(fin.payload.leaderboard[0].team_id, 't1');
});

test('costs: custom output and prices are parsed and validated', () => {
  const c = normalizeConfig('costs', { output: '10, 25, 35, 40, 40, x', prices: '9, 2, 5, 5', card_fee: 0 });
  assert.deepEqual(c.output_list, [10, 25, 35, 40]);
  assert.deepEqual(c.price_list, [2, 5, 9]);
  const m = costsModel(c);
  assert.equal(m.maxWorkers, 4);
  assert.equal(m.keep, 1);
});
