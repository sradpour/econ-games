import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, resolveStage, makeRng, allocateRationing, benchmarks, normalizeConfig } from '../supabase/functions/_shared/engine.js';

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
  const { allResults } = run('competitive', { rounds: 2, price_noise: 0 }, teams(10),
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
