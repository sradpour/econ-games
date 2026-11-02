// Per-game decision forms, results and charts for the student screen.
import { html, raw, store, setUi, on, money, num, pct } from '../lib/dom.js';
import { variableCost, marginalCost } from '../lib/engine.js';
import { lineChart, sample, barChart } from '../lib/chart.js';
import { serverNow } from '../app.js';
import { submit } from './play.js';

const MARKET = ['competitive', 'monopolistic', 'oligopoly', 'monopoly'];

export function roundsTotal(type, c) {
  if (MARKET.includes(type) || type === 'ultimatum') return c.rounds;
  if (type === 'public_goods') return c.rounds_no_punish + c.rounds_punish;
  return null;
}

export function stageLabel(s, g) {
  const a = g.assignment || {};
  switch (s.game_type) {
    case 'competitive': case 'monopolistic': case 'monopoly': return 'Set your price and quantity';
    case 'oligopoly': return 'Set your price';
    case 'pd_live': return a.bye ? 'You sit out this round' : `Match ${a.match} of ${a.matches}, round ${a.round_in_match}`;
    case 'public_goods': return s.stage === 'punish' ? 'Assign deduction points' : 'How much do you put in the pot?';
    case 'ultimatum':
      if (a.role === 'bye') return 'You sit out this round';
      if (s.stage === 'respond') return a.role === 'responder' ? 'Accept or reject the offer' : 'Waiting for your partner';
      return a.role === 'proposer' ? 'Make an offer' : 'Waiting for the proposer';
    default: return '';
  }
}

// Who may submit right now (captain rule, with backup in the last 30 seconds)
function canSubmit(g) {
  if (!g.me.required || g.session.status !== 'running') return false;
  if (g.session.team_mode !== 'teams' || g.me.is_captain) return true;
  const end = g.session.stage_ends_at ? new Date(g.session.stage_ends_at).getTime() : null;
  return !!end && end - serverNow() < 30000 && !g.me.decision;
}
function captainNote(g) {
  if (g.session.team_mode !== 'teams' || g.me.is_captain) return '';
  return html`<p class="note">${g.me.captain_name || 'Your captain'} submits for your team this round. Talk it over together. If nothing is in by the last 30 seconds, anyone on the team can submit.</p>`;
}
function submittedNote(g) {
  if (!g.me.decision) return '';
  return html`<p class="saved">Submitted${g.me.decision_by ? ` by ${g.me.decision_by}` : ''}. You can change it until time runs out.</p>`;
}
const lastRes = (g) => g.results[g.results.length - 1];
const lastPub = (g) => g.public[g.public.length - 1];

export function decisionPanel(g, c) {
  const s = g.session;
  if (s.status === 'paused') return html`<p class="muted">The game is paused. Your saved decision stays in.</p>${submittedNote(g)}`;
  switch (s.game_type) {
    case 'competitive': case 'monopolistic': case 'oligopoly': case 'monopoly': return marketForm(g, c);
    case 'pd_live': return pdForm(g, c);
    case 'public_goods': return s.stage === 'punish' ? punishForm(g, c) : contributeForm(g, c);
    case 'ultimatum': return ugForm(g, c);
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Markets

function startValues(g) {
  const d = g.me.decision;
  if (d) return { participate: d.participate !== false, price: d.price, quantity: d.quantity, branding: d.branding ?? 0 };
  const r = lastRes(g);
  if (r && r.participated) return { participate: true, price: r.price, quantity: r.produced, branding: r.branding ?? 0 };
  return { participate: true, price: '', quantity: '', branding: 0 };
}

function marketForm(g, c) {
  const t = g.session.game_type;
  const v = startValues(g);
  const p = { ...v, ...(store.ui.preview || {}) };
  const enabled = canSubmit(g);
  const hasQty = t !== 'oligopoly';
  return html`
    ${captainNote(g)}
    <form class="market-form" data-action="submit-market">
      <fieldset ${enabled ? '' : 'disabled'}>
        <label class="switch"><input type="checkbox" name="participate" ${v.participate ? 'checked' : ''} data-input="preview"> <span>Sell this round</span></label>
        <div class="fields ${p.participate ? '' : 'off'}">
          <label>Price per unit ($)<input name="price" type="number" inputmode="decimal" min="0" max="${c.max_price}" step="0.01" value="${v.price}" data-input="preview" ${p.participate ? 'required' : ''}></label>
          ${hasQty ? html`<label>Quantity to produce<input name="quantity" type="number" inputmode="numeric" min="0" max="${c.max_quantity}" step="1" value="${v.quantity}" data-input="preview" ${p.participate ? 'required' : ''}></label>` : ''}
          ${t === 'monopolistic' ? html`<label>Branding spend ($)<input name="branding" type="number" inputmode="decimal" min="0" max="${c.max_branding}" step="1" value="${v.branding}" data-input="preview"></label>` : ''}
        </div>
        <button class="primary big" type="submit">${g.me.decision ? 'Update decision' : 'Submit decision'}</button>
      </fieldset>
    </form>
    ${submittedNote(g)}
    ${preview(g, c, p)}
    ${t === 'monopoly' ? monopolyChart(c, p) : ''}
    ${costTable(c)}`;
}

on('preview', (el) => {
  const f = el.form;
  setUi('preview', () => ({
    participate: f.participate.checked,
    price: f.price.value, quantity: f.quantity?.value ?? '', branding: f.branding?.value ?? 0,
  }));
});

on('submit-market', async (form) => {
  const t = store.game.session.game_type;
  const participate = form.participate.checked;
  const payload = { participate };
  if (participate) {
    payload.price = Number(form.price.value);
    if (t !== 'oligopoly') payload.quantity = Math.round(Number(form.quantity.value));
    if (t === 'monopolistic') payload.branding = Number(form.branding.value || 0);
  }
  await submit(payload);
  store.ui.preview = null;
});

function preview(g, c, p) {
  const t = g.session.game_type;
  const price = Number(p.price), q = Math.round(Number(p.quantity)), b = Number(p.branding || 0);
  if (!p.participate) {
    return html`<div class="preview"><p>Sitting out costs <strong>${money(c.fixed_cost * (1 - c.avoidable_share))}</strong> (the unavoidable part of your fixed cost).</p></div>`;
  }
  if (!(price > 0)) return html`<div class="preview muted">Enter a price to see what you would earn.</div>`;
  if (t === 'oligopoly') {
    const r = lastRes(g);
    const guesses = [...new Set([r?.sold, 40, 60, 80, 100].filter((x) => Number.isFinite(x) && x > 0))].sort((a, b2) => a - b2);
    return html`<div class="preview"><p class="pv-title">At ${money(price, 2)}, your profit if customers buy…</p>
      <table class="mini"><thead><tr><th>Units sold</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead><tbody>
      ${guesses.map((n) => { const cost = c.fixed_cost + variableCost(n, c); return html`<tr class="${n === r?.sold ? 'hl' : ''}"><td>${n}${n === r?.sold ? ' (last round)' : ''}</td><td>${money(price * n)}</td><td>${money(cost)}</td><td class="${price * n - cost < 0 ? 'neg' : 'pos'}">${money(price * n - cost)}</td></tr>`; })}
      </tbody></table></div>`;
  }
  if (!(q >= 0) || p.quantity === '') return html`<div class="preview muted">Enter a quantity to see what you would earn.</div>`;
  const cost = c.fixed_cost + variableCost(q, c) + b;
  let sold = q, extra = '';
  if (t === 'monopoly') {
    const D = Math.max(0, c.demand_a - c.demand_b * price);
    sold = Math.min(q, Math.floor(D));
    extra = html`<p>Buyers want <strong>${num(D)}</strong> units at this price, so you sell <strong>${num(sold)}</strong>${q > D ? html` and <span class="neg">${num(q - sold)} go unsold</span>` : ''}.</p>`;
  }
  const rev = price * sold;
  return html`<div class="preview">
    ${t === 'monopoly' ? extra : html`<p class="pv-title">If you sell all ${num(q)} units at ${money(price, 2)}:</p>`}
    <dl class="pv">
      <div><dt>Revenue</dt><dd>${money(rev)}</dd></div>
      <div><dt>Total cost</dt><dd>${money(cost)}</dd></div>
      <div class="big"><dt>Profit</dt><dd class="${rev - cost < 0 ? 'neg' : 'pos'}">${money(rev - cost)}</dd></div>
      <div><dt>Marginal cost of unit ${num(q)}</dt><dd>${money(marginalCost(q, c), 2)}</dd></div>
    </dl>
    ${t === 'competitive' ? html`<p class="hint">Unsold units still cost you. Anything priced above what buyers pay elsewhere may not sell.</p>` : ''}
  </div>`;
}

function monopolyChart(c, p) {
  const maxQ = c.demand_a;
  const pts = (f) => sample(f, 0, maxQ, 50);
  const series = [
    { name: 'Demand', color: 'demand', points: pts((q) => Math.max(0, (c.demand_a - q) / c.demand_b)) },
    { name: 'Marginal cost', color: 'supply', points: pts((q) => marginalCost(q, c)).filter(([, y]) => y <= c.max_price * 1.2) },
  ];
  const price = Number(p.price), q = Number(p.quantity);
  if (price > 0 && q >= 0 && p.quantity !== '') series.push({ name: 'Your choice', color: 'mark', dots: true, points: [[Math.min(q, maxQ), price]] });
  return lineChart({ series, xLabel: 'Quantity', yLabel: 'Price ($)', title: 'Your market' });
}

function costTable(c) {
  const qs = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150];
  return html`<details class="costs"><summary>Your cost table</summary>
    <table class="mini"><thead><tr><th>Quantity</th><th>Total cost</th><th>Average cost</th><th>Marginal cost</th></tr></thead><tbody>
    ${qs.map((q) => { const tc = c.fixed_cost + variableCost(q, c); return html`<tr><td>${q}</td><td>${money(tc)}</td><td>${q ? money(tc / q, 2) : '–'}</td><td>${money(marginalCost(q, c), 2)}</td></tr>`; })}
    </tbody></table>
    <p class="hint">Total cost = ${money(c.fixed_cost)} fixed + ${c.mc_intercept} × Q + ${c.mc_slope / 2} × Q².</p></details>`;
}

// ---------------------------------------------------------------------------
// Prisoner's dilemma (live)

function pdForm(g, c) {
  const a = g.assignment || {};
  if (a.bye) return html`<p>There's an odd number of players, so you sit out this round. You'll be paired again soon.</p>`;
  const mine = g.me.decision?.move;
  const enabled = canSubmit(g);
  return html`
    ${captainNote(g)}
    <div class="pd-buttons">
      <button class="pd c ${mine === 'C' ? 'chosen' : ''}" data-action="pd-move" data-move="C" ${enabled ? '' : 'disabled'}>Cooperate</button>
      <button class="pd d ${mine === 'D' ? 'chosen' : ''}" data-action="pd-move" data-move="D" ${enabled ? '' : 'disabled'}>Defect</button>
    </div>
    ${submittedNote(g)}
    ${a.history?.length ? html`<div class="strip-wrap"><p class="small muted">This match so far</p>${moveStrip(a.history.map((h) => h.you).join(''), a.history.map((h) => h.them).join(''), 'You', 'Partner')}</div>` : html`<p class="muted small">New partner. Nobody knows when this match will end.</p>`}
    ${payoffMatrix(c)}`;
}
on('pd-move', async (el) => submit({ move: el.dataset.move }));

export function moveStrip(a, b, la, lb) {
  return html`<div class="strip" role="img" aria-label="${la}: ${a}. ${lb}: ${b}.">
    <div class="strip-row"><span class="strip-name">${la}</span>${[...a].map((m) => html`<span class="mv ${m}">${m}</span>`)}</div>
    <div class="strip-row"><span class="strip-name">${lb}</span>${[...b].map((m) => html`<span class="mv ${m}">${m}</span>`)}</div></div>`;
}

export function payoffMatrix(c) {
  return html`<table class="matrix" aria-label="Payoffs (you, partner)"><thead><tr><th></th><th>Partner cooperates</th><th>Partner defects</th></tr></thead>
    <tbody><tr><th>You cooperate</th><td>${c.payoff_R}, ${c.payoff_R}</td><td>${c.payoff_S}, ${c.payoff_T}</td></tr>
    <tr><th>You defect</th><td>${c.payoff_T}, ${c.payoff_S}</td><td>${c.payoff_P}, ${c.payoff_P}</td></tr></tbody></table>
    <p class="small muted">Points shown as (you, partner).</p>`;
}

// ---------------------------------------------------------------------------
// Public goods

function contributeForm(g, c) {
  const a = g.assignment || {};
  const cur = store.ui.pg?.contribution ?? g.me.decision?.contribution ?? Math.round(c.endowment / 2);
  const enabled = canSubmit(g);
  return html`
    <form data-action="submit-contribution" class="pg-form">
      <fieldset ${enabled ? '' : 'disabled'}>
        <label class="slider-label">Put in <strong class="big-num">${cur}</strong> of ${c.endowment} tokens
          <input type="range" name="contribution" min="0" max="${c.endowment}" step="1" value="${cur}" data-input="pg-slide"></label>
        <p>You keep <strong>${c.endowment - cur}</strong>. Every token in the pot earns each of the ${a.group_size || c.group_size} group members ${c.mpcr}.</p>
        <button class="primary big" type="submit">${g.me.decision ? 'Update' : 'Submit'}</button>
      </fieldset>
    </form>
    ${submittedNote(g)}
    <p class="small muted">${a.matching === 'strangers' ? 'Your group is reshuffled every round.' : 'Your group stays the same all game.'}
    ${a.punishment_round ? ' This round, after contributing, you will see what each groupmate put in and can assign deduction points.' : ''}</p>`;
}
on('pg-slide', (el) => setUi('pg', { contribution: Number(el.value) }));
on('submit-contribution', async (form) => { await submit({ contribution: Number(form.contribution.value) }); });

function punishForm(g, c) {
  const a = g.assignment || {};
  const pts = store.ui.pg?.points ?? g.me.decision?.points ?? {};
  const used = Object.values(pts).reduce((s, x) => s + Number(x || 0), 0);
  const enabled = canSubmit(g);
  return html`
    <p>You put in <strong>${a.your_contribution}</strong>. Your group's pot was <strong>${a.group_total}</strong>, so you earned <strong>${num(a.base_earnings, 1)}</strong> before deductions.</p>
    <form data-action="submit-punish" class="punish">
      <fieldset ${enabled ? '' : 'disabled'}>
      <table class="mini"><thead><tr><th>Groupmate</th><th>Put in</th><th>Deduction points</th></tr></thead><tbody>
        ${(a.others || []).map((o) => html`<tr><td>Player ${o.label}</td><td>${o.contribution}</td>
          <td><input type="number" name="p_${o.label}" min="0" max="${c.max_punish_points}" step="1" value="${pts[o.label] ?? 0}" data-input="pg-points" aria-label="Points for player ${o.label}"></td></tr>`)}
      </tbody></table>
      <p class="${used > c.max_punish_points ? 'neg' : ''}">Points used: ${used} of ${c.max_punish_points}. Cost to you: ${num(used * c.punish_cost, 1)}.</p>
      <button class="primary big" type="submit">${g.me.decision ? 'Update' : 'Submit'}</button>
      </fieldset>
    </form>${submittedNote(g)}
    <p class="small muted">Each point costs you ${c.punish_cost} and takes ${c.punish_impact} from that player. Nobody learns who assigned points.</p>`;
}
on('pg-points', (el) => {
  const pts = {};
  for (const i of el.form.querySelectorAll('input[name^="p_"]')) pts[i.name.slice(2)] = Math.max(0, Math.round(Number(i.value || 0)));
  setUi('pg', { points: pts });
});
on('submit-punish', async (form) => {
  const pts = {};
  for (const i of form.querySelectorAll('input[name^="p_"]')) { const v = Math.round(Number(i.value || 0)); if (v > 0) pts[i.name.slice(2)] = v; }
  await submit({ points: pts });
});

// ---------------------------------------------------------------------------
// Ultimatum / dictator

function ugForm(g, c) {
  const a = g.assignment || {};
  const s = g.session;
  if (a.role === 'bye') return html`<p>There's an odd number of players, so you sit out this round.</p>`;
  if (s.stage === 'offer' && a.role === 'proposer') {
    const cur = store.ui.pg?.offer ?? g.me.decision?.offer ?? Math.round(c.pie / 2);
    return html`<form data-action="submit-offer" class="pg-form"><fieldset ${canSubmit(g) ? '' : 'disabled'}>
      <label class="slider-label">Offer <strong class="big-num">$${cur}</strong> of $${c.pie}
        <input type="range" name="offer" min="0" max="${c.pie}" step="1" value="${cur}" data-input="ug-slide"></label>
      <div class="split"><span>You keep <strong>$${c.pie - cur}</strong></span><span>They get <strong>$${cur}</strong></span></div>
      <p class="small muted">${a.variant === 'dictator' ? 'Your partner cannot reject.' : 'If your partner rejects, you both get nothing.'}</p>
      <button class="primary big" type="submit">${g.me.decision ? 'Update offer' : 'Send offer'}</button></fieldset></form>${submittedNote(g)}`;
  }
  if (s.stage === 'offer') return html`<p>You are the <strong>responder</strong> this round. ${a.variant === 'dictator' ? 'You will receive whatever the proposer gives.' : 'The proposer is deciding how much to offer you.'}</p>`;
  if (a.role === 'responder') {
    const mine = g.me.decision;
    return html`<p class="offer-big">Your partner offers you <strong>$${a.offer}</strong> and keeps <strong>$${c.pie - a.offer}</strong>.</p>
      <div class="pd-buttons">
        <button class="pd c ${mine?.accept === true ? 'chosen' : ''}" data-action="ug-respond" data-accept="1" ${canSubmit(g) ? '' : 'disabled'}>Accept</button>
        <button class="pd d ${mine?.accept === false ? 'chosen' : ''}" data-action="ug-respond" data-accept="0" ${canSubmit(g) ? '' : 'disabled'}>Reject</button>
      </div>${submittedNote(g)}
      <p class="small muted">If you don't answer in time, the offer is accepted.</p>`;
  }
  return html`<p>You offered <strong>$${a.offer ?? '–'}</strong>. Waiting for your partner to accept or reject.</p>`;
}
on('ug-slide', (el) => setUi('pg', { offer: Number(el.value) }));
on('submit-offer', async (form) => submit({ offer: Number(form.offer.value) }));
on('ug-respond', async (el) => submit({ accept: el.dataset.accept === '1' }));

// ---------------------------------------------------------------------------
// Last result

export function lastResult(g, c) {
  const r = lastRes(g);
  if (!r) return '';
  const t = g.session.game_type;
  let body = '';
  if (MARKET.includes(t)) {
    body = r.participated ? html`<dl class="pv result">
        <div><dt>Price</dt><dd>${money(r.price, 2)}</dd></div>
        ${t !== 'oligopoly' ? html`<div><dt>Produced</dt><dd>${num(r.produced)}</dd></div>` : ''}
        <div><dt>Sold</dt><dd>${num(r.sold)}${r.unsold ? html` <span class="neg small">(${num(r.unsold)} unsold)</span>` : ''}</dd></div>
        <div><dt>Revenue</dt><dd>${money(r.revenue)}</dd></div>
        <div><dt>Costs</dt><dd>${money(r.total_cost)}</dd></div>
        ${t === 'monopolistic' ? html`<div><dt>Brand strength</dt><dd>${num(r.brand_stock)}</dd></div>` : ''}
        <div class="big"><dt>Profit</dt><dd class="${r.profit < 0 ? 'neg' : 'pos'}">${money(r.profit)}</dd></div>
      </dl>` : html`<p>${r.auto ? 'You missed the deadline, so you sat out.' : 'You sat this round out.'} Cost: <span class="neg">${money(-r.profit)}</span>.</p>`;
    if (r.participated && r.auto) body = html`<p class="note">You missed the deadline; your previous decision was used.</p>${body}`;
  } else if (t === 'pd_live') {
    body = r.bye ? html`<p>You sat out.</p>` : html`<p class="pd-result"><span class="mv ${r.you}">${r.you}</span> you · partner <span class="mv ${r.them}">${r.them}</span> → <strong>${r.points} points</strong>${r.auto ? ' (no choice made, your last move was repeated)' : ''}</p>`;
    const pub = lastPub(g);
    if (pub?.match_over) body = html`${body}<p class="note">That match lasted ${pub.match_length} rounds. ${g.session.status === 'finished' ? '' : 'You have a new partner now.'}</p>`;
  } else if (t === 'public_goods') {
    body = html`<dl class="pv result">
      <div><dt>You put in</dt><dd>${r.contribution}${r.auto ? ' (missed)' : ''}</dd></div>
      <div><dt>Group pot</dt><dd>${r.group_total}</dd></div>
      <div><dt>Kept + from pot</dt><dd>${r.kept} + ${num(r.from_pot, 1)}</dd></div>
      ${r.punishment_round ? html`<div><dt>Points you gave</dt><dd>${r.points_given} (−${num(r.cost_of_punishing, 1)})</dd></div>
        <div><dt>Points you received</dt><dd>${r.points_received} (−${num(r.deduction, 1)})</dd></div>` : ''}
      <div class="big"><dt>Earned</dt><dd class="${r.earnings < 0 ? 'neg' : 'pos'}">${num(r.earnings, 1)}</dd></div></dl>
      <p class="small muted">Groupmates put in: ${r.others.map((o) => `${o.contribution}`).join(', ')}</p>`;
  } else if (t === 'ultimatum') {
    body = r.bye ? html`<p>You sat out.</p>` : r.no_offer ? html`<p>No offer was made in time, so both of you got nothing.</p>`
      : html`<p>${r.role === 'proposer' ? `You offered $${r.offer}` : `You were offered $${r.offer}`}${c.variant === 'dictator' ? '' : ` and it was <strong>${r.accepted ? 'accepted' : 'rejected'}</strong>`.replace(/<\/?strong>/g, '')}. You earned <strong>$${r.points}</strong>.</p>`;
  }
  return html`<section class="card result-card"><h2>Round ${r.round_no} result</h2>${body}
    <p class="total">Your total: <strong>${MARKET.includes(t) ? money(r.cumulative) : num(r.cumulative, 1)}</strong></p></section>`;
}

// ---------------------------------------------------------------------------
// Public info & history

function leaderboardTable(rows, myName, money_) {
  if (!rows?.length) return '';
  return html`<table class="board"><thead><tr><th>#</th><th>Name</th><th>Total</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="${r.name === myName ? 'me' : ''}"><td>${r.rank}</td><td>${r.name}</td><td>${money_ ? money(r.total) : num(r.total, 1)}</td></tr>`)}
  </tbody></table>`;
}

export function publicBlock(g, c) {
  const t = g.session.game_type;
  const pubs = g.public;
  if (!pubs.length) return '';
  const last = pubs[pubs.length - 1];
  let chart = '';
  if (MARKET.includes(t)) {
    const key = t === 'monopoly' ? 'average_price' : 'market_price';
    chart = lineChart({ title: t === 'monopoly' ? 'Average price across the class' : 'Market price by round', xInteger: true, xLabel: 'Round', yLabel: '$',
      series: [
        { name: t === 'monopoly' ? 'Class average' : 'Market price', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p[key]]) },
        { name: 'Your price', color: 'supply', dots: true, dashed: true, points: g.results.map((r) => [r.round_no, r.participated ? r.price : null]) },
      ] });
  } else if (t === 'pd_live') {
    chart = lineChart({ title: 'Share of players cooperating', xInteger: true, xLabel: 'Round', yLabel: '%',
      series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.cooperation_rate === null ? null : p.cooperation_rate * 100]) }] });
  } else if (t === 'public_goods') {
    chart = lineChart({ title: 'Average contribution', xInteger: true, xLabel: 'Round', yLabel: 'tokens',
      series: [
        { name: 'Class average', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_contribution]) },
        { name: 'You', color: 'supply', dashed: true, dots: true, points: g.results.map((r) => [r.round_no, r.contribution]) },
      ] });
  } else if (t === 'ultimatum') {
    chart = lineChart({ title: 'Average offer', xInteger: true, xLabel: 'Round', yLabel: '$',
      series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_offer]) }] });
  }
  return html`<section class="card public">
    ${raw(chart)}
    ${MARKET.includes(t) && last.market_price !== undefined ? html`<p class="small">Last round: ${last.active_firms} firms sold ${num(last.total_sold)} units at an average of ${money(last.market_price, 2)}.</p>` : ''}
    ${t === 'ultimatum' && last.rejection_rate !== undefined && last.rejection_rate !== null ? html`<p class="small">Offers rejected last round: ${pct(last.rejection_rate)}.</p>` : ''}
    ${last.prices ? html`<h3>Prices last round</h3><ul class="prices">${last.prices.map((p) => html`<li>${p.name}<span>${p.price === null ? 'sat out' : money(p.price, 2)}</span></li>`)}</ul>` : ''}
    ${last.leaderboard ? html`<h3>Leaderboard</h3>${leaderboardTable(last.leaderboard, g.team?.name, MARKET.includes(t))}` : ''}
  </section>`;
}

export function historyBlock(g, c) {
  const t = g.session.game_type;
  if (!g.results.length) return '';
  const rows = g.results.slice().reverse();
  let head, row;
  if (MARKET.includes(t)) {
    head = html`<tr><th>Round</th><th>Price</th>${t !== 'oligopoly' ? html`<th>Made</th>` : ''}<th>Sold</th><th>Profit</th></tr>`;
    row = (r) => html`<tr><td>${r.round_no}</td><td>${r.participated ? money(r.price, 2) : 'out'}</td>${t !== 'oligopoly' ? html`<td>${num(r.produced)}</td>` : ''}<td>${num(r.sold)}</td><td class="${r.profit < 0 ? 'neg' : ''}">${money(r.profit)}</td></tr>`;
  } else if (t === 'pd_live') {
    head = html`<tr><th>Round</th><th>Match</th><th>You</th><th>Partner</th><th>Points</th></tr>`;
    row = (r) => html`<tr><td>${r.round_no}</td><td>${r.match}</td><td>${r.bye ? '–' : r.you}</td><td>${r.bye ? '–' : r.them}</td><td>${r.points}</td></tr>`;
  } else if (t === 'public_goods') {
    head = html`<tr><th>Round</th><th>In</th><th>Pot</th><th>Deducted</th><th>Earned</th></tr>`;
    row = (r) => html`<tr><td>${r.round_no}</td><td>${r.contribution}</td><td>${r.group_total}</td><td>${r.punishment_round ? num(r.deduction + r.cost_of_punishing, 1) : '–'}</td><td>${num(r.earnings, 1)}</td></tr>`;
  } else {
    head = html`<tr><th>Round</th><th>Role</th><th>Offer</th><th>Outcome</th><th>Earned</th></tr>`;
    row = (r) => html`<tr><td>${r.round_no}</td><td>${r.role}</td><td>${r.offer ?? '–'}</td><td>${r.bye ? 'sat out' : r.no_offer ? 'no offer' : c.variant === 'dictator' ? '–' : r.accepted ? 'accepted' : 'rejected'}</td><td>$${r.points}</td></tr>`;
  }
  return html`<details class="card history" ${g.results.length <= 6 ? 'open' : ''}><summary>Your rounds</summary>
    <table class="mini"><thead>${head}</thead><tbody>${rows.map(row)}</tbody></table></details>`;
}

// ---------------------------------------------------------------------------
// End of game

export function finalBlock(g, c) {
  const t = g.session.game_type;
  const f = g.outputs.final;
  const mine = lastRes(g);
  const myName = g.team?.name;
  const myRow = f?.leaderboard?.find((r) => r.name === myName);
  const isMoney = MARKET.includes(t);
  return html`
    <div class="final-score">
      ${myRow ? html`<div class="place"><span class="place-n">${myRow.rank}</span><span class="place-of">of ${f.leaderboard.length}</span></div>` : ''}
      <div><p class="muted">Your total</p><p class="score">${isMoney ? money(mine?.cumulative ?? 0) : num(mine?.cumulative ?? 0, 1)}</p>
      ${f?.ranked_by === 'average' && myRow ? html`<p class="small muted">Ranked by average points per round played: ${num(myRow.average, 2)}</p>` : ''}</div>
    </div>
    ${f?.leaderboard ? html`<section class="card"><h2>Final standings</h2>
      <table class="board"><thead><tr><th>#</th><th>Name</th><th>Total</th>${f.ranked_by === 'average' ? html`<th>Per round</th>` : ''}</tr></thead><tbody>
      ${f.leaderboard.map((r) => html`<tr class="${r.name === myName ? 'me' : ''}"><td>${r.rank}</td><td>${r.name}</td><td>${isMoney ? money(r.total) : num(r.total, 1)}</td>${f.ranked_by === 'average' ? html`<td>${num(r.average, 2)}</td>` : ''}</tr>`)}
      </tbody></table></section>` : ''}
    ${g.all_results?.length ? revealed(g, t) : ''}
    ${publicBlock({ ...g, public: g.public.map(({ leaderboard, prices, ...rest }) => rest) }, c)}
    ${historyBlock(g, c)}`;
}

function revealed(g, t) {
  const byTeam = {};
  for (const r of g.all_results) (byTeam[r.team] ||= []).push(r);
  const names = Object.keys(byTeam);
  const palette = ['demand', 'supply', 'ink', 'mark', 'muted'];
  const chart = lineChart({ title: 'Every firm\'s price', xInteger: true, xLabel: 'Round', yLabel: '$', height: 260,
    series: names.slice(0, 40).map((n, i) => ({ color: n === g.team?.name ? 'supply' : 'muted', points: byTeam[n].map((r) => [r.round_no, r.price]) })) });
  return html`<section class="card"><h2>What everyone did</h2>${raw(chart)}
    <p class="small muted">Your firm is the red line.</p>
    <details><summary>Full table</summary><div class="scroll"><table class="mini"><thead><tr><th>Firm</th><th>Round</th><th>Price</th>${t !== 'oligopoly' ? html`<th>Made</th>` : ''}<th>Sold</th>${t === 'monopolistic' ? html`<th>Branding</th>` : ''}<th>Profit</th></tr></thead>
    <tbody>${g.all_results.map((r) => html`<tr class="${r.team === g.team?.name ? 'me' : ''}"><td>${r.team}</td><td>${r.round_no}</td><td>${r.price === null ? 'out' : money(r.price, 2)}</td>${t !== 'oligopoly' ? html`<td>${num(r.produced)}</td>` : ''}<td>${num(r.sold)}</td>${t === 'monopolistic' ? html`<td>${money(r.branding)}</td>` : ''}<td>${money(r.profit)}</td></tr>`)}</tbody></table></div></details></section>`;
}
