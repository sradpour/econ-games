// Per-game decision forms, results and charts for the student screen.
import { html, raw, store, setUi, on, money, num, pct, rerender } from '../lib/dom.js';
import { variableCost, marginalCost, laborHours, marginalProduct, normalizeConfig, benchmarks } from '../lib/engine.js';
import { lineChart, sample, barChart } from '../lib/chart.js';
import { serverNow } from '../app.js';
import { submit } from './play.js';
import { commonsStageLabel, commonsPanel, commonsLastResult, commonsPublic, commonsHistory } from './commons.js';
import { costsLive, costsFinal } from './costs.js';

const MARKET = ['competitive', 'monopolistic', 'oligopoly', 'monopoly'];

export function roundsTotal(type, c) {
  if (MARKET.includes(type) || type === 'ultimatum') return c.rounds;
  if (type === 'public_goods') return c.rounds_no_punish + c.rounds_punish;
  if (type === 'commons') return c.variant === 'simple' ? c.rounds : null;
  if (type === 'costs') return 1;
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
    case 'commons': return commonsStageLabel(s, g);
    case 'costs': return 'Work out your supply schedule';
    default: return '';
  }
}

// Who may submit right now (captain rule, with backup in the last 30 seconds)
export function canSubmit(g) {
  if (!g.me.required || g.session.status !== 'running') return false;
  if (g.session.team_mode !== 'teams' || g.me.is_captain) return true;
  const end = g.session.stage_ends_at ? new Date(g.session.stage_ends_at).getTime() : null;
  return !!end && end - serverNow() < 30000 && !g.me.decision;
}
function captainNote(g) {
  if (g.session.team_mode !== 'teams' || g.me.is_captain) return '';
  return html`<p class="note">${g.me.captain_name || 'Your captain'} submits for your team this round. Talk it over together. If nothing is in by the last 30 seconds, anyone on the team can submit.</p>`;
}
export function submittedNote(g) {
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
    case 'commons': return commonsPanel(g, c);
    case 'costs': return costsLive(g, c);
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Markets

// "Typical price" shown in perfect and monopolistic competition: the equilibrium price for this market.
const typicalCache = new Map();
function typicalPrice(g, c) {
  const t = g.session.game_type;
  if (t !== 'competitive' && t !== 'monopolistic') return null;
  if (t === 'competitive' && c.market_rule !== 'cheapest' && g.assignment?.market_price != null) return g.assignment.market_price;
  const n = Math.max(1, g.session.team_mode === 'teams' ? (g.teams?.length || g.session.player_count) : g.session.player_count);
  const key = `${t}|${n}|${JSON.stringify(c)}`;
  if (!typicalCache.has(key)) {
    const b = benchmarks(t, c, n);
    typicalCache.set(key, b ? Math.round((t === 'competitive' ? b.price : b.nash_price) * 100) / 100 : null);
  }
  return typicalCache.get(key);
}

function startValues(g, c) {
  const d = g.me.decision;
  if (d) return { participate: d.participate !== false, price: d.price, quantity: d.quantity, branding: d.branding ?? 0 };
  const r = lastRes(g);
  const fixed = g.session.game_type === 'competitive' && c && c.market_rule !== 'cheapest' ? typicalPrice(g, c) : null;
  if (r && r.participated) return { participate: true, price: fixed ?? r.price, quantity: r.produced, branding: r.branding ?? 0 };
  const typical = c ? typicalPrice(g, c) : null;
  return { participate: true, price: typical ?? '', quantity: '', branding: 0 };
}

function typicalPriceBox(g, c) {
  const typical = typicalPrice(g, c);
  if (typical === null) return '';
  if (g.session.game_type === 'competitive' && c.market_rule !== 'cheapest') {
    const unit = c.product || 'unit';
    const prev = lastPub(g)?.market_price;
    return html`<div class="typical"><div><span>Market price ${c.price_range > 0 ? 'this round' : `for ${a_an(unit)} ${unit}`}</span><strong>${money(typical, 2)}</strong></div>
      ${c.price_range > 0 && prev != null ? html`<div><span>Last round</span><strong>${money(prev, 2)}</strong></div>` : ''}
      <p class="small muted">Set by the market${c.price_range > 0 ? ' and different each round' : ''}; nothing you do changes it. Price above it and you sell little; price below it and you give money away. Your real choice is how many ${c.product_plural} to make.</p></div>`;
  }
  const last = lastPub(g)?.market_price;
  const unit = c.product || 'unit';
  return html`<div class="typical"><div><span>Typical price for ${a_an(unit)} ${unit}</span><strong>${money(typical, 2)}</strong></div>
    ${last !== undefined && last !== null ? html`<div><span>Market price last round</span><strong>${money(last, 2)}</strong></div>` : ''}
    <p class="small muted">${g.session.game_type === 'competitive'
      ? `Many ${c.business === 'bakery' ? 'bakeries' : c.business + 's'} sell the same ${unit}${c.market_rule === 'cheapest' ? ", so buyers won't pay much more than this" : ': price above the market price and you sell little; price below and you give money away'}. Your real choice is how many to make.`
      : `What similar ${c.product_plural || 'products'} usually sell for. Branding can let you charge more.`}</p></div>`;
}
const a_an = (w) => (/^[aeiou]/i.test(String(w)) ? 'an' : 'a');

function marketForm(g, c) {
  const t = g.session.game_type;
  const v = startValues(g, c);
  const p = { ...v, ...(store.ui.preview || {}) };
  const enabled = canSubmit(g);
  const hasQty = t !== 'oligopoly';
  const hard = c.difficulty === 'hard';
  return html`
    ${captainNote(g)}
    ${typicalPriceBox(g, c)}
    <form class="market-form" data-action="submit-market">
      <fieldset ${enabled ? '' : 'disabled'}>
        <label class="switch"><input type="checkbox" name="participate" ${v.participate ? 'checked' : ''} data-input="preview"> <span>Open for business this round</span></label>
        <div class="fields ${p.participate ? '' : 'off'}">
          <label>Price per ${c.product || 'unit'} ($)<input name="price" type="number" inputmode="decimal" min="0" max="${c.max_price}" step="0.01" value="${v.price}" data-input="preview" ${p.participate ? 'required' : ''}></label>
          ${hasQty ? html`<label>${cap(c.product_plural || 'units')} to make<input name="quantity" type="number" inputmode="numeric" min="0" max="${c.max_quantity}" step="1" value="${v.quantity}" data-input="preview" ${p.participate ? 'required' : ''}></label>` : ''}
          ${t === 'monopolistic' ? html`<label>Branding spend ($)<input name="branding" type="number" inputmode="decimal" min="0" max="${c.max_branding}" step="1" value="${v.branding}" data-input="preview"></label>` : ''}
        </div>
        <button class="primary big" type="submit">${g.me.decision ? 'Update decision' : 'Submit decision'}</button>
      </fieldset>
    </form>
    ${submittedNote(g)}
    ${hard ? previewHard(g, c, p) : preview(g, c, p)}
    ${t === 'monopoly' ? monopolyChart(c, p, hard) : ''}
    ${productionBlock(g, c)}`;
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

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

const rentOf = (c) => c.fixed_cost * (1 - c.avoidable_share);

function preview(g, c, p) {
  const t = g.session.game_type;
  const price = Number(p.price), q = Math.round(Number(p.quantity)), b = Number(p.branding || 0);
  const unit = c.product_plural || 'units';
  if (!p.participate) {
    return html`<div class="preview"><p>Closing this round still costs <strong>${money(rentOf(c))}</strong> in rent. You save the equipment and utilities cost.</p></div>`;
  }
  if (!(price > 0)) return html`<div class="preview muted">Enter a price to see what you would earn.</div>`;
  if (t === 'oligopoly') {
    const r = lastRes(g);
    const guesses = [...new Set([r?.sold, 40, 60, 80, 100].filter((x) => Number.isFinite(x) && x > 0))].sort((a, b2) => a - b2);
    return html`<div class="preview"><p class="pv-title">At ${money(price, 2)}, your profit if customers buy…</p>
      <table class="mini"><thead><tr><th>${cap(unit)} sold</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead><tbody>
      ${guesses.map((n) => { const cost = c.fixed_cost + variableCost(n, c); return html`<tr class="${n === r?.sold ? 'hl' : ''}"><td>${n}${n === r?.sold ? ' (last round)' : ''}</td><td>${money(price * n)}</td><td>${money(cost)}</td><td class="${price * n - cost < 0 ? 'neg' : 'pos'}">${money(price * n - cost)}</td></tr>`; })}
      </tbody></table></div>`;
  }
  if (!(q >= 0) || p.quantity === '') return html`<div class="preview muted">Enter a quantity to see what you would earn.</div>`;
  const cost = c.fixed_cost + variableCost(q, c) + b;
  let sold = q, extra = '';
  if (t === 'monopoly') {
    const D = Math.max(0, c.demand_a - c.demand_b * price);
    sold = Math.min(q, Math.floor(D));
    extra = html`<p>Buyers want <strong>${num(D)}</strong> ${unit} at this price, so you sell <strong>${num(sold)}</strong>${q > D ? html` and <span class="neg">${num(q - sold)} go unsold</span>` : ''}.</p>`;
  }
  const rev = price * sold;
  const hours = laborHours(q, c);
  return html`<div class="preview">
    ${t === 'monopoly' ? extra : html`<p class="pv-title">If you sell all ${num(q)} ${unit} at ${money(price, 2)}:</p>`}
    <dl class="pv">
      <div><dt>Revenue</dt><dd>${money(rev)}</dd></div>
      <div><dt>Total cost</dt><dd>${money(cost)}</dd></div>
      <div class="big"><dt>Profit</dt><dd class="${rev - cost < 0 ? 'neg' : 'pos'}">${money(rev - cost)}</dd></div>
      <div><dt>Cost of ${c.product ? `${c.product} #${num(q)}` : `unit ${num(q)}`} (marginal cost)</dt><dd>${money(marginalCost(q, c), 2)}</dd></div>
      ${hours !== null ? html`<div><dt>Labor needed</dt><dd>${num(hours, 1)} hours</dd></div>` : ''}
    </dl>
    ${t === 'competitive' ? html`<p class="hint">Unsold ${unit} still cost you. Anything priced above what buyers pay elsewhere may not sell.</p>` : ''}
  </div>`;
}

function previewHard(g, c, p) {
  const t = g.session.game_type;
  const price = Number(p.price), q = Math.round(Number(p.quantity));
  const unit = c.product_plural || 'units';
  if (!p.participate) return html`<div class="preview"><p>You are closing this round. Which of your costs do you still pay?</p></div>`;
  if (!(price > 0)) return html`<div class="preview muted">Enter a price.</div>`;
  if (t === 'oligopoly') return html`<div class="preview"><p>Every ${c.product} you sell brings in <strong>${money(price, 2)}</strong>. Use your cost worksheet to decide whether that covers the cost of making it.</p></div>`;
  if (!(q >= 0) || p.quantity === '') return html`<div class="preview muted">Enter a quantity.</div>`;
  let sold = q, extra = '';
  if (t === 'monopoly') {
    const D = Math.max(0, c.demand_a - c.demand_b * price);
    sold = Math.min(q, Math.floor(D));
    extra = html`<p>Buyers want <strong>${num(D)}</strong> ${unit} at this price, so you would sell <strong>${num(sold)}</strong>.</p>`;
  }
  return html`<div class="preview">${extra}
    <dl class="pv"><div><dt>Revenue${t === 'monopoly' ? '' : ` if you sell all ${num(q)}`}</dt><dd>${money(price * sold)}</dd></div></dl>
    <p class="hint">Hard mode: work out your costs and profit with the worksheet below.</p></div>`;
}

function monopolyChart(c, p, hard) {
  const maxQ = c.demand_a;
  const pts = (f) => sample(f, 0, maxQ, 50);
  const series = [{ name: 'Demand', color: 'demand', points: pts((q) => Math.max(0, (c.demand_a - q) / c.demand_b)) }];
  if (!hard) series.push({ name: 'Marginal cost', color: 'supply', points: pts((q) => marginalCost(q, c)).filter(([, y]) => y <= c.max_price * 1.2) });
  const price = Number(p.price), q = Number(p.quantity);
  if (price > 0 && q >= 0 && p.quantity !== '') series.push({ name: 'Your choice', color: 'mark', dots: true, points: [[Math.min(q, maxQ), price]] });
  return lineChart({ series, xLabel: c.product_plural ? cap(c.product_plural) : 'Quantity', yLabel: 'Price ($)', title: 'Your market' });
}

// ---------------------------------------------------------------------------
// Production story: inputs, production table, cost table (normal) or worksheet (hard)

const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const hoursAt = (q, c) => Math.round(laborHours(q, c) * 100) / 100;

function productionBlock(g, c) {
  if (!c.wage) return legacyCostTable(c);
  const hard = c.difficulty === 'hard';
  const mat = c.material_qty * c.material_price;
  return html`<details class="costs production">
    <summary>Your ${c.business}: inputs and costs</summary>
    <ul class="inputs">
      <li><span>Labor</span><strong>${money(c.wage, 2)} per hour</strong></li>
      <li><span>${cap(c.material_name)}</span><strong>${c.material_qty} ${c.material_unit} per ${c.product} at ${money(c.material_price, 2)} per ${c.material_unit}</strong></li>
      <li><span>Rent</span><strong>${money(rentOf(c))} per round, even if you close</strong></li>
      <li><span>Equipment and utilities</span><strong>${money(c.fixed_cost * c.avoidable_share)} per round, only when open</strong></li>
    </ul>
    <h3>Production table</h3>
    <p class="small muted">Labor hours needed to make each amount. Each extra hour adds fewer ${c.product_plural} than the last.</p>
    <div class="scroll"><table class="mini"><thead><tr><th>${cap(c.product_plural)}</th><th>Labor hours needed</th>${hard ? '' : html`<th>Extra ${c.product_plural} per extra hour</th>`}</tr></thead><tbody>
      ${STEPS.map((q, i) => html`<tr><td>${q}</td><td>${num(hoursAt(q, c), 2)}</td>${hard ? '' : html`<td>${i === 0 ? '–' : num(10 / (hoursAt(q, c) - hoursAt(STEPS[i - 1], c)), 2)}</td>`}</tr>`)}
    </tbody></table></div>
    ${hard ? worksheet(g, c) : html`
      <h3>Cost table</h3>
      <div class="scroll"><table class="mini"><thead><tr><th>${cap(c.product_plural)}</th><th>Labor cost</th><th>${cap(c.material_name)}</th><th>Fixed cost</th><th>Total cost</th><th>Average cost</th><th>Marginal cost</th></tr></thead><tbody>
        ${STEPS.map((q) => { const lab = hoursAt(q, c) * c.wage, m2 = q * mat, tc = c.fixed_cost + lab + m2; return html`<tr><td>${q}</td><td>${money(lab)}</td><td>${money(m2)}</td><td>${money(c.fixed_cost)}</td><td>${money(tc)}</td><td>${q ? money(tc / q, 2) : '–'}</td><td>${money(marginalCost(q, c), 2)}</td></tr>`; })}
      </tbody></table></div>
      <p class="hint">Marginal cost = wage ÷ extra ${c.product_plural} per hour + ${c.material_name} per ${c.product}. At ${4 * c.productivity_half} ${c.product_plural}: ${money(c.wage, 2)} ÷ ${num(marginalProduct(4 * c.productivity_half, c), 2)} + ${money(mat, 2)} = ${money(marginalCost(4 * c.productivity_half, c), 2)}.</p>`}
  </details>`;
}

function legacyCostTable(c) {
  const qs = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150];
  return html`<details class="costs"><summary>Your cost table</summary>
    <table class="mini"><thead><tr><th>Quantity</th><th>Total cost</th><th>Average cost</th><th>Marginal cost</th></tr></thead><tbody>
    ${qs.map((q) => { const tc = c.fixed_cost + variableCost(q, c); return html`<tr><td>${q}</td><td>${money(tc)}</td><td>${q ? money(tc / q, 2) : '–'}</td><td>${money(marginalCost(q, c), 2)}</td></tr>`; })}
    </tbody></table></details>`;
}

// Hard-mode worksheet: students fill in costs; Check marks each cell.
const WS_ROWS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const WS_COLS = [['labor', 'Labor cost'], ['mat', 'Materials'], ['tc', 'Total cost'], ['mc', 'Marginal cost per unit']];
function wsAnswers(c) {
  const mat = c.material_qty * c.material_price;
  const out = {};
  let prevTc = null;
  for (const q of WS_ROWS) {
    const labor = Math.round(hoursAt(q, c) * c.wage * 100) / 100;
    const m2 = Math.round(q * mat * 100) / 100;
    const tc = Math.round((c.fixed_cost + labor + m2) * 100) / 100;
    out[`${q}:labor`] = labor; out[`${q}:mat`] = m2; out[`${q}:tc`] = tc;
    if (prevTc !== null) out[`${q}:mc`] = Math.round(((tc - prevTc) / 10) * 100) / 100;
    prevTc = tc;
  }
  return out;
}
const wsKey = () => `econ-ws-${store.game?.session?.id}`;
function wsState() {
  if (!store.ui.ws || store.ui.ws.key !== wsKey()) {
    let values = {};
    try { values = JSON.parse(localStorage.getItem(wsKey()) || '{}'); } catch { /* storage unavailable */ }
    store.ui.ws = { key: wsKey(), values, marks: {} };
  }
  return store.ui.ws;
}
function worksheet(g, c) {
  const ws = wsState();
  const correct = Object.values(ws.marks).filter((m) => m === 'ok').length;
  const total = Object.keys(ws.marks).length;
  return html`<h3>Your cost worksheet</h3>
    <p class="small muted">Fill in your costs from the production table and input prices. Fixed cost is ${money(c.fixed_cost)} (rent + equipment). Marginal cost per unit is the change in total cost from the row above, divided by 10. Your answers are saved on this device.</p>
    <div class="scroll"><table class="mini worksheet"><thead><tr><th>${cap(c.product_plural)}</th><th>Labor hours</th>${WS_COLS.map(([, l]) => html`<th>${l}</th>`)}</tr></thead><tbody>
      ${WS_ROWS.map((q) => html`<tr><td>${q}</td><td>${num(hoursAt(q, c), 2)}</td>${WS_COLS.map(([k]) => {
        if (k === 'mc' && q === 0) return html`<td>–</td>`;
        const key = `${q}:${k}`;
        const mark = ws.marks[key];
        return html`<td class="${mark || ''}"><input type="number" step="0.01" inputmode="decimal" name="ws_${q}_${k}" value="${ws.values[key] ?? ''}" data-input="ws-input" data-k="${key}" aria-label="${k} at ${q}"></td>`;
      })}</tr>`)}
    </tbody></table></div>
    <div class="row wrap"><button type="button" data-action="ws-check">Check my answers</button><button type="button" class="link" data-action="ws-clear">Clear</button>
      ${total ? html`<span class="${correct === total ? 'saved' : 'small'}">${correct} of ${total} filled cells correct</span>` : ''}</div>`;
}
on('ws-input', (el) => {
  const ws = wsState();
  ws.values[el.dataset.k] = el.value;
  delete ws.marks[el.dataset.k];
  el.closest('td')?.classList.remove('ok', 'bad');
  try { localStorage.setItem(wsKey(), JSON.stringify(ws.values)); } catch { /* storage unavailable */ }
});
on('ws-check', () => {
  const ws = wsState();
  const c = normalizeConfig(store.game.session.game_type, store.game.session.config);
  const ans = wsAnswers(c);
  ws.marks = {};
  for (const [k, v] of Object.entries(ws.values)) {
    if (v === '' || v === null || v === undefined || ans[k] === undefined) continue;
    const tol = k.endsWith(':mc') ? 0.06 : Math.max(0.51, Math.abs(ans[k]) * 0.005);
    ws.marks[k] = Math.abs(Number(v) - ans[k]) <= tol ? 'ok' : 'bad';
  }
  rerender();
});
on('ws-clear', () => {
  const ws = wsState();
  ws.values = {}; ws.marks = {};
  try { localStorage.removeItem(wsKey()); } catch { /* ignore */ }
  for (const i of document.querySelectorAll('.worksheet input')) { i.value = ''; i.dataset.dirty = ''; }
  rerender();
});

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
  if (t === 'commons') return commonsLastResult(g, c);
  if (t === 'costs') return '';
  let body = '';
  if (MARKET.includes(t)) {
    body = r.participated ? html`<dl class="pv result">
        <div><dt>Price</dt><dd>${money(r.price, 2)}</dd></div>
        ${t !== 'oligopoly' ? html`<div><dt>Produced</dt><dd>${num(r.produced)}</dd></div>` : ''}
        <div><dt>Sold</dt><dd>${num(r.sold)}${r.unsold ? html` <span class="neg small">(${num(r.unsold)} unsold)</span>` : ''}</dd></div>
        <div><dt>Revenue</dt><dd>${money(r.revenue)}</dd></div>
        ${r.labor_hours !== undefined && r.labor_hours !== null ? html`
          <div><dt>Labor (${num(r.labor_hours, 1)} hours)</dt><dd>${money(r.labor_cost)}</dd></div>
          <div><dt>${cap(c.material_name || 'materials')}</dt><dd>${money(r.material_cost)}</dd></div>
          <div><dt>Rent + equipment</dt><dd>${money(r.rent + r.equipment)}</dd></div>
          ${r.branding ? html`<div><dt>Branding</dt><dd>${money(r.branding)}</dd></div>` : ''}` : ''}
        <div><dt>Total costs</dt><dd>${money(r.total_cost)}</dd></div>
        ${t === 'monopolistic' ? html`<div><dt>Brand strength</dt><dd>${num(r.brand_stock)}</dd></div>` : ''}
        <div class="big"><dt>Profit</dt><dd class="${r.profit < 0 ? 'neg' : 'pos'}">${money(r.profit)}</dd></div>
      </dl>` : html`<p>${r.auto ? 'You missed the deadline, so you sat out.' : 'You sat this round out.'} Cost: <span class="neg">${money(-r.profit)}</span>.</p>`;
    if (r.participated && r.market_price !== undefined && r.market_price !== null) {
      const pctSold = r.produced ? Math.round((100 * r.sold) / r.produced) : 0;
      body = html`<p class="note">Market price: <strong>${money(r.market_price, 2)}</strong>. ${r.above_market
        ? `Your price was above it, so most buyers went elsewhere: you sold ${pctSold}% of what you made.`
        : r.price < r.market_price - 0.005 ? `Your price was below it: you sold everything, but could have charged ${money(r.market_price, 2)}.`
        : r.sold < r.produced ? `You were at the market price, but firms at that price brought more than buyers wanted, so you sold ${pctSold}%.` : 'You were at the market price and sold everything.'}</p>${body}`;
    }
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
  if (!pubs.length || t === 'costs') return '';
  const last = pubs[pubs.length - 1];
  if (t === 'commons') return commonsPublic(g, c, leaderboardTable);
  let chart = '';
  if (MARKET.includes(t)) {
    const key = t === 'monopoly' ? 'average_price' : 'market_price';
    chart = lineChart({ title: t === 'monopoly' ? 'Average price across the class' : 'Market price by round', xInteger: true, xLabel: 'Round', yLabel: '$',
      series: [
        { name: t === 'monopoly' ? 'Class average' : 'Market price', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p[key]]) },
        { name: 'Your price', color: 'supply', dots: true, dashed: true, points: g.results.map((r) => [r.round_no, r.participated ? r.price : null]) },
      ] });
  } else if (t === 'pd_live') {
    chart = lineChart({ title: 'Share of players cooperating', xInteger: true, xLabel: 'Round', yLabel: '%', yMax: 100,
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
    ${MARKET.includes(t) && last.market_price !== undefined ? html`<p class="small">Last round: ${last.active_firms} firms sold ${num(last.total_sold)} units ${last.market_rule === 'fixed'
      ? `at an average price of ${money(last.average_selling_price, 2)} (market price ${money(last.market_price, 2)})` : `at an average of ${money(last.market_price, 2)}`}.</p>` : ''}
    ${t === 'ultimatum' && last.rejection_rate !== undefined && last.rejection_rate !== null ? html`<p class="small">Offers rejected last round: ${pct(last.rejection_rate)}.</p>` : ''}
    ${last.prices ? html`<h3>Prices last round</h3><ul class="prices">${last.prices.map((p) => html`<li>${p.name}<span>${p.price === null ? 'sat out' : money(p.price, 2)}</span></li>`)}</ul>` : ''}
    ${last.leaderboard ? html`<h3>Leaderboard</h3>${leaderboardTable(last.leaderboard, g.team?.name, MARKET.includes(t))}` : ''}
  </section>`;
}

export function historyBlock(g, c) {
  const t = g.session.game_type;
  if (!g.results.length || t === 'costs') return '';
  if (t === 'commons') return commonsHistory(g, c);
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
  if (t === 'costs') return costsFinal(g, c);
  const f = g.outputs.final;
  const mine = lastRes(g);
  const myName = g.team?.name;
  const myRow = f?.leaderboard?.find((r) => r.name === myName);
  const isMoney = MARKET.includes(t) || t === 'commons';
  const canPeek = MARKET.includes(t) && !!g.all_results?.length;
  return html`
    <div class="final-score">
      ${myRow ? html`<div class="place"><span class="place-n">${myRow.rank}</span><span class="place-of">of ${f.leaderboard.length}</span></div>` : ''}
      <div><p class="muted">Your total</p><p class="score">${isMoney ? money(mine?.cumulative ?? 0) : num(mine?.cumulative ?? 0, 1)}</p>
      ${f?.ranked_by === 'average' && myRow ? html`<p class="small muted">Ranked by average points per round played: ${num(myRow.average, 2)}</p>` : ''}</div>
    </div>
    ${f?.leaderboard ? html`<section class="card"><h2>Final standings</h2>
      ${canPeek ? html`<p class="small muted">Click a name to see that ${g.session.team_mode === 'teams' ? 'team' : 'firm'}'s choices round by round.</p>` : ''}
      <table class="board"><thead><tr><th>#</th><th>Name</th><th>Total</th>${f.ranked_by === 'average' ? html`<th>Per round</th>` : ''}</tr></thead><tbody>
      ${f.leaderboard.map((r) => {
        const open = canPeek && store.ui.peek === r.name;
        return html`<tr class="${r.name === myName ? 'me' : ''} ${open ? 'peek-open' : ''}" data-key="lb-${r.name}"><td>${r.rank}</td>
          <td>${canPeek ? html`<button class="link peek" data-action="peek-firm" data-name="${r.name}" aria-expanded="${open ? 'true' : 'false'}">${r.name}<span class="peek-caret" aria-hidden="true">${open ? '▾' : '▸'}</span></button>` : r.name}</td>
          <td>${isMoney ? money(r.total) : num(r.total, 1)}</td>${f.ranked_by === 'average' ? html`<td>${num(r.average, 2)}</td>` : ''}</tr>
          ${open ? html`<tr class="peek-row" data-key="peek-${r.name}"><td colspan="${f.ranked_by === 'average' ? 4 : 3}">
            ${firmHistory(g.all_results.filter((x) => x.team === r.name), t, g.public, r.name === myName ? 'You' : r.name)}</td></tr>` : ''}`;
      })}
      </tbody></table></section>` : ''}
    ${g.all_results?.length ? revealed(g, t) : ''}
    ${publicBlock({ ...g, public: g.public.map(({ leaderboard, prices, ...rest }) => rest) }, c)}
    ${historyBlock(g, c)}`;
}

on('peek-firm', (el) => { store.ui.peek = store.ui.peek === el.dataset.name ? null : el.dataset.name; rerender(); });

/**
 * One firm's decisions round by round (used in the final standings and on the instructor screen).
 * rows: [{ round_no, price (null = sat out), produced, sold, branding, profit }]
 */
export function firmHistory(rows, t, pubs, label) {
  if (!rows.length) return html`<p class="muted small">No rounds played.</p>`;
  rows = rows.slice().sort((a, b) => a.round_no - b.round_no);
  const key = t === 'monopoly' ? 'average_price' : 'market_price';
  const chart = lineChart({ title: `${label}: price by round`, xInteger: true, xLabel: 'Round', yLabel: '$', height: 170,
    series: [
      { name: label, color: 'supply', dots: true, points: rows.map((r) => [r.round_no, r.price]) },
      { name: t === 'monopoly' ? 'Class average' : 'Market price', color: 'demand', dashed: true, points: (pubs || []).map((p) => [p.round_no, p[key] ?? null]) },
    ] });
  const total = rows.reduce((s, r) => s + Number(r.profit || 0), 0);
  return html`<div class="peek-body">${rows.some((r) => r.price !== null && r.price !== undefined) ? raw(chart) : html`<p class="small muted">Sat out every round.</p>`}
    <div class="scroll"><table class="mini"><thead><tr><th>Round</th><th>Price</th>${t !== 'oligopoly' ? html`<th>Made</th>` : ''}<th>Sold</th>${t === 'monopolistic' ? html`<th>Branding</th>` : ''}<th>Profit</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td>${r.round_no}</td><td>${r.price === null || r.price === undefined ? 'sat out' : money(r.price, 2)}</td>${t !== 'oligopoly' ? html`<td>${num(r.produced)}</td>` : ''}<td>${num(r.sold)}</td>${t === 'monopolistic' ? html`<td>${money(r.branding)}</td>` : ''}<td class="${r.profit < 0 ? 'neg' : ''}">${money(r.profit)}</td></tr>`)}</tbody>
    <tfoot><tr><td>Total</td><td colspan="${t === 'oligopoly' ? 2 : t === 'monopolistic' ? 4 : 3}"></td><td>${money(total)}</td></tr></tfoot></table></div></div>`;
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
