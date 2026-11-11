// Costs and the supply curve: a five-step worksheet that ends in a supply schedule.
// Step order follows the classic cost worksheet: sort the bills → marginal product → FC/VC/TC → averages and MC → supply.
// Live: a team shares one worksheet in class. Self-paced: individuals submit to be scored. Every table copies into Excel.
import { html, raw, store, on, rerender, toast, money, num } from '../lib/dom.js';
import { costsModel, scoreSchedule } from '../lib/engine.js';
import { costBills, CLOSE_CHOICES, FV_CHOICES } from '../lib/games.js';
import { lineChart } from '../lib/chart.js';
import { rpc } from '../lib/api.js';
import { copyButton } from '../lib/tables.js';
import { reloadGame } from './play.js';
import { demoSubmit } from '../lib/demo.js';

const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const priceKey = (p) => String(p);
const copyable = (table, label) => html`<div class="copyable"><div class="scroll">${table}</div>${copyButton(label)}</div>`;
// Round tick marks for a quantity axis from 0 to max (about 6 of them).
function qTicks(max) {
  const raw = max / 6, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw) || 10 * p;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

// ---------------------------------------------------------------------------
// Answers and steps

const modelCache = new Map();
function modelFor(c) {
  const key = JSON.stringify(c);
  if (!modelCache.has(key)) {
    if (modelCache.size > 20) modelCache.clear();
    modelCache.set(key, costsModel(c));
  }
  return modelCache.get(key);
}
const easy = (c) => modelFor(c).c.level === 'easy';
const hasFee = (c) => modelFor(c).c.card_fee > 0;

/** Every checkable cell's correct value. */
export function costsAnswers(c) {
  const m = modelFor(c);
  const a = {};
  for (const b of costBills(m.c)) {
    if (!easy(c)) a[`close:${b.id}`] = b.close;
    if (b.fv) a[`fv:${b.id}`] = b.fv;
  }
  for (const r of m.rows) {
    const w = r.workers;
    if (w) a[`mp:${w}`] = r.mp;
    a[`fc:${w}`] = r.fc; a[`vc:${w}`] = r.vc; a[`tc:${w}`] = r.tc;
    if (r.q) { a[`avc:${w}`] = r.avc; a[`afc:${w}`] = r.afc; a[`atc:${w}`] = r.atc; }
    if (r.mc !== null) a[`mc:${w}`] = r.mc;
  }
  const withQ = m.rows.filter((r) => r.q);
  // Rows that tie once rounded to the cent all count as right.
  const minRows = (k) => { const lo = Math.min(...withQ.map((r) => Math.round(r[k] * 100))); return withQ.filter((r) => Math.round(r[k] * 100) === lo).map((r) => String(r.q)); };
  const topMp = Math.max(...withQ.map((r) => r.mp));
  a['q:top_mp'] = withQ.filter((r) => r.mp === topMp).map((r) => String(r.workers));
  a['q:min_avc'] = minRows('avc');
  a['q:min_atc'] = minRows('atc');
  for (const p of m.c.price_list) {
    if (hasFee(c)) a[`keep:${priceKey(p)}`] = p * m.keep;
    a[`sch:${priceKey(p)}`] = String(m.best(p));
  }
  return a;
}

function steps(c) {
  const m = modelFor(c);
  const W = m.maxWorkers;
  const ws = Array.from({ length: W + 1 }, (_, i) => i);
  const withQ = m.rows.filter((r) => r.q).map((r) => r.workers);
  const bills = costBills(m.c);
  return [
    { n: 1, id: 'sort', title: 'Sort the bills', keys: easy(c) ? bills.map((b) => `fv:${b.id}`) : bills.flatMap((b) => (b.fv ? [`close:${b.id}`, `fv:${b.id}`] : [`close:${b.id}`])) },
    { n: 2, id: 'mp', title: 'Marginal product of labor', keys: [...ws.slice(1).map((w) => `mp:${w}`), 'q:top_mp'] },
    { n: 3, id: 'tc', title: 'Fixed, variable and total cost', keys: ws.flatMap((w) => [`fc:${w}`, `vc:${w}`, `tc:${w}`]) },
    { n: 4, id: 'avg', title: 'Average and marginal cost', keys: [...withQ.flatMap((w) => [`avc:${w}`, `afc:${w}`, `atc:${w}`]), ...m.rows.filter((r) => r.mc !== null).map((r) => `mc:${r.workers}`), 'q:min_avc', 'q:min_atc'] },
    { n: 5, id: 'supply', title: 'Your supply schedule', keys: m.c.price_list.flatMap((p) => (hasFee(c) ? [`keep:${priceKey(p)}`, `sch:${priceKey(p)}`] : [`sch:${priceKey(p)}`])) },
  ];
}

function isRight(key, value, ans) {
  if (ans === undefined || value === undefined || value === null || value === '') return null;
  if (Array.isArray(ans)) return ans.includes(String(value));
  if (typeof ans === 'string') return String(value) === ans;
  const v = Number(String(value).replace(/[$,\s]/g, '').replace('−', '-'));
  if (!Number.isFinite(v)) return false;
  const kind = key.split(':')[0];
  const tol = ['avc', 'afc', 'atc', 'mc', 'keep'].includes(kind) ? Math.max(0.011, Math.abs(ans) * 0.002) : kind === 'mp' ? 0.01 : Math.max(0.51, Math.abs(ans) * 0.002);
  return Math.abs(v - ans) <= tol;
}
const fmtAnswer = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : Array.isArray(v) ? v[0] : v);

// ---------------------------------------------------------------------------
// Worksheet state: what the server has saved plus this browser's unsaved edits.

function cw(g) {
  const id = g.session.id;
  if (!store.ui.cw || store.ui.cw.session !== id) store.ui.cw = { session: id, local: {}, marks: {}, saving: false, savedAt: null, timer: null, pending: 0 };
  return store.ui.cw;
}
function values(g) {
  const s = cw(g);
  return { ...(g.me?.decision?.v || {}), ...s.local };
}
const selfPaced = (c) => modelFor(c).c.pace === 'self';
const lastResult = (g) => g.results?.[g.results.length - 1];
function editable(g, c) {
  if (g.solve) return true;
  if (g.session.status !== 'running' || !(g.demo || g.me?.required)) return false;
  if (selfPaced(c) && modelFor(c).c.attempts === 'one' && (lastResult(g) || cw(g).pending)) return false;
  return true;
}

function schedule(v, c) {
  const out = {};
  for (const p of modelFor(c).c.price_list) {
    const x = v[`sch:${priceKey(p)}`];
    if (x !== undefined && x !== '') out[priceKey(p)] = Number(x);
  }
  return out;
}

async function save(quiet = true) {
  const g = store.game;
  if (!g || g.demo || g.solve || !editable(g, g._costsCfg)) return;
  const s = cw(g);
  clearTimeout(s.timer); s.timer = null;
  if (s.saving) { s.again = true; return; }
  const sent = { ...s.local };
  if (!Object.keys(sent).length && quiet) return;
  s.saving = true; rerender();
  try {
    const c = g._costsCfg;
    await reloadGame(); // build on the team's latest saved work
    const v = { ...(store.game?.me?.decision?.v || {}), ...sent };
    await rpc('submit_decision', { p_session: g.session.id, p_payload: { v, schedule: schedule(v, c) } });
    for (const [k, val] of Object.entries(sent)) if (s.local[k] === val) delete s.local[k];
    s.savedAt = Date.now(); s.error = null;
    if (!quiet) toast('Saved.');
    await reloadGame();
    for (const el of document.querySelectorAll('.cw [data-k]')) if (!(el.dataset.k in s.local)) el.dataset.dirty = '';
  } catch (e) {
    s.error = e.message;
    if (!quiet) toast(e.message, 'error');
  } finally {
    s.saving = false; rerender();
    if (s.again) { s.again = false; setTimeout(() => save(), 200); }
  }
}

function edit(el) {
  const g = currentG();
  if (!g) return;
  const s = cw(g);
  s.local[el.dataset.k] = el.value;
  delete s.marks[el.dataset.k];
  el.closest('.cell')?.classList.remove('ok', 'bad');
  if (g.demo || g.solve) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => save(), 2500);
}
// The worksheet is either the student's game (store.game) or the instructor's solve screen.
const currentG = () => (store.route?.solve ? store.ui.solveG : store.game);
on('cw-input', edit);
on('cw-change', (el) => { edit(el); rerender(); });
on('cw-save', () => save(false));
on('cw-check', (el) => {
  const g = currentG();
  const c = g._costsCfg;
  const st = steps(c).find((x) => x.id === el.dataset.step);
  const ans = costsAnswers(c);
  const v = values(g);
  const s = cw(g);
  for (const k of st.keys) {
    if (k.startsWith('sch:') && !g.solve) continue; // the schedule itself is what gets scored, so students can't check it
    const r = isRight(k, v[k], ans[k]);
    if (r === null) delete s.marks[k]; else s.marks[k] = r ? 'ok' : 'bad';
  }
  rerender();
});
on('cw-finish-demo', () => {
  const g = store.game;
  demoSubmit({ v: values(g), schedule: schedule(values(g), g._costsCfg) });
  window.scrollTo(0, 0);
});
on('cw-submit', async (el) => {
  const g = store.game;
  const c = g._costsCfg;
  const v = values(g);
  const sch = schedule(v, c);
  const missing = modelFor(c).c.price_list.length - Object.keys(sch).length;
  if (missing > 0 && !el.dataset.armed) {
    el.dataset.armed = '1';
    toast(`${missing} ${missing === 1 ? 'price is' : 'prices are'} still blank (blank counts as closing). Click Submit again to submit anyway.`, 'warn');
    setTimeout(() => { delete el.dataset.armed; }, 6000);
    return;
  }
  if (modelFor(c).c.attempts === 'one' && !el.dataset.sure) {
    el.dataset.sure = '1';
    toast('You can submit only once. Click Submit again to confirm.', 'warn');
    setTimeout(() => { delete el.dataset.sure; }, 6000);
    return;
  }
  const s = cw(g);
  const r = await rpc('costs_submit', { p_session: g.session.id, p_payload: { v, schedule: sch } });
  s.local = {}; s.pending = r.attempt;
  toast('Submitted. Scoring…');
  await reloadGame();
  for (const delay of [1500, 3500, 7000]) setTimeout(() => { if (cw(store.game).pending > (lastResult(store.game)?.attempt || 0)) reloadGame(); }, delay);
});
on('cw-csv', async () => {
  const g = currentG();
  const m = modelFor(g._costsCfg);
  const c = m.c;
  const { downloadCsv } = await import('../lib/csv.js');
  const rows = m.rows.map((r) => ({ [cap(c.worker_plural)]: r.workers, [cap(c.product_plural)]: r.q, 'Marginal product': '', FC: '', VC: '', TC: '', AVC: '', AFC: '', ATC: '', MC: '' }));
  downloadCsv(`${c.business} cost worksheet.csv`, rows);
});

// ---------------------------------------------------------------------------
// The worksheet (students, demo, and the instructor's solve screen)

/** The cost list built from the student's own answers in step 1, ready to copy into Excel. */
function costList(c, v) {
  const m = modelFor(c);
  const bills = costBills(m.c);
  const ez = easy(c);
  const sunk = bills.filter((b) => !ez && v[`close:${b.id}`] === 'sunk');
  const rows = bills.filter((b) => (ez ? v[`fv:${b.id}`] : v[`close:${b.id}`] && v[`close:${b.id}`] !== 'sunk'))
    .map((b) => ({ b, fv: v[`fv:${b.id}`] || '', close: v[`close:${b.id}`] || '' }))
    .sort((x, y) => (x.fv === y.fv ? 0 : x.fv === 'fixed' ? -1 : y.fv === 'fixed' ? 1 : x.fv ? -1 : 1));
  if (!rows.length && !sunk.length) return html`<p class="small muted">Your cost list appears here as you sort the bills.</p>`;
  return html`<h3>Your cost list</h3>
    <p class="small muted">Built from your answers above (right or wrong). Copy it into Excel to do the calculations in steps 3–5.</p>
    ${copyable(html`<table class="mini costlist"><thead><tr><th>Item</th><th>Fixed or variable</th>${ez ? '' : html`<th>Still costs you if closed</th>`}<th>Amount ($)</th><th>Per</th></tr></thead>
      <tbody>${rows.map(({ b, fv, close }) => html`<tr><td>${b.item}</td><td>${fv ? cap(fv) : '?'}</td>${ez ? '' : html`<td>${close === 'yes' ? 'Yes' : close === 'no' ? 'No' : '?'}</td>`}
        <td data-copy="${b.amount}">${num(b.amount, Number.isInteger(b.amount) ? 0 : 2)}</td><td>${b.per}${b.note ? html` <span class="small muted">(${b.note})</span>` : ''}</td></tr>`)}</tbody></table>`, 'Copy cost list')}
    ${sunk.length ? html`<p class="small muted">Left out as already paid: ${sunk.map((b) => b.item).join(', ')}.</p>` : ''}`;
}

export function costsLive(g, c) {
  g._costsCfg = c;
  const m = modelFor(c);
  const v = values(g);
  const s = cw(g);
  const can = editable(g, c);
  const st = steps(c);
  const ez = easy(c);
  const fee = hasFee(c);
  const self = selfPaced(c) && !g.demo && !g.solve;
  const filled = (keys) => keys.filter((k) => v[k] !== undefined && v[k] !== '').length;
  const head = (step) => {
    const marks = step.keys.map((k) => s.marks[k]).filter(Boolean);
    const ok = marks.filter((x) => x === 'ok').length;
    return html`<summary><span class="step-n">${step.n}</span><span class="step-t">${step.title}</span>
      <span class="step-p small">${filled(step.keys)}/${step.keys.length} filled${marks.length ? html` · <span class="${ok === marks.length ? 'pos' : ''}">${ok} of ${marks.length} checked right</span>` : ''}</span></summary>`;
  };
  const checkBtn = (step) => (c.checks === 'on' || g.solve ? html`<button type="button" data-action="cw-check" data-step="${step.id}">Check step ${step.n}</button>` : '');
  const cell = (k, opts = {}) => {
    const mark = s.marks[k] || '';
    return html`<span class="cell ${mark}"><input type="text" inputmode="decimal" autocomplete="off" data-k="${k}" data-input="cw-input" value="${v[k] ?? ''}"
      ${can ? '' : 'disabled'} aria-label="${opts.label || k}" placeholder="${opts.ph || ''}"></span>`;
  };
  const pick = (k, options, label, disabled = false) => {
    const mark = s.marks[k] || '';
    return html`<span class="cell ${mark}"><select data-k="${k}" data-change="cw-change" ${can && !disabled ? '' : 'disabled'} aria-label="${label}">
      <option value="" ${v[k] === undefined || v[k] === '' ? 'selected' : ''}>${disabled ? '–' : 'Choose…'}</option>
      ${options.map(([val, lab, copy]) => html`<option value="${val}" ${copy !== undefined ? html`data-copy="${copy}"` : ''} ${String(v[k] ?? '') === String(val) ? 'selected' : ''}>${lab}</option>`)}</select></span>`;
  };
  const bills = costBills(m.c);
  const rowsQ = m.rows.filter((r) => r.q);
  const savedLine = g.solve ? html`<span class="small muted">Teacher screen: nothing is saved.</span>`
    : g.demo ? html`<span class="small muted">Demo: nothing is saved.</span>`
    : s.saving ? html`<span class="small muted">Saving…</span>`
    : Object.keys(s.local).length ? html`<span class="small muted">Unsaved changes</span> <button type="button" class="link" data-action="cw-save">Save now</button>`
    : g.me?.decision ? html`<span class="saved">Saved${c.team_mode === 'teams' ? ` for your team${g.me.decision_by ? ` (last by ${g.me.decision_by})` : ''}` : ''}.</span>` : html`<span class="small muted">Nothing saved yet.</span>`;
  const sch = schedule(v, c);
  const chartPts = m.c.price_list.filter((p) => sch[priceKey(p)] !== undefined).map((p) => [m.rows[Math.min(m.maxWorkers, Math.max(0, sch[priceKey(p)]))].q, p]);
  const fixedLabel = ez ? 'the fixed costs on your cost list' : 'what you pay for this ' + c.period + ' even if you close';

  return html`<div class="cw">
    ${self ? submissionCard(g, c) : ''}
    <section class="card cw-intro">
      <div class="row spread wrap"><h2>Your ${c.business}'s books for one ${c.period}</h2><div class="cw-save">${savedLine}</div></div>
      ${s.error ? html`<p class="error small">${s.error}</p>` : ''}
      <p class="small muted">${g.solve ? '' : c.team_mode === 'teams' ? 'Everyone on your team sees and edits the same worksheet; it saves itself a few seconds after you type. ' : g.demo ? '' : 'Your worksheet saves itself a few seconds after you type. '}
        Only step 5 is scored. Steps 1–4 are there to get you to the right answer. Every table has a Copy button for Excel, and you can paste a column of numbers from Excel straight into the worksheet.</p>
      <div class="cw-books">
        <div><h3>Bills</h3><ol class="bills">${bills.map((b) => html`<li>${b.text}</li>`)}</ol></div>
        <div><h3>Production table</h3>
          ${copyable(html`<table class="mini"><thead><tr><th>${cap(c.worker_plural)}</th><th>${cap(c.product_plural)} per ${c.period}</th></tr></thead>
          <tbody>${m.rows.map((r) => html`<tr><td>${r.workers}</td><td>${r.q}</td></tr>`)}</tbody></table>`)}
          <p class="small muted">You sell every ${c.product} you make at the market price.</p></div>
      </div>
    </section>

    <details class="card cw-step" open>${head(st[0])}
      <p>${ez ? `Is each bill a fixed cost (the same however many ${c.product_plural} you make) or a variable cost (it goes up as you make more)?`
        : `Before any math: for each bill, does it still cost you if you close for the ${c.period}? And is it fixed (the same however many ${c.product_plural} you make) or variable (it goes up as you make more)? Costs already paid are left out of the decision.`}</p>
      <div class="scroll"><table class="mini sortbills"><thead><tr><th>#</th><th>Bill</th>${ez ? '' : html`<th>Still costs you if you close?</th>`}<th>Fixed or variable?</th></tr></thead>
        <tbody>${bills.map((b, i) => {
          const sunk = !ez && v[`close:${b.id}`] === 'sunk';
          return html`<tr><td>${i + 1}</td><td class="small">${b.text}</td>
            ${ez ? '' : html`<td>${pick(`close:${b.id}`, CLOSE_CHOICES, `Bill ${i + 1}: still costs you if you close?`)}</td>`}
            <td>${pick(`fv:${b.id}`, FV_CHOICES, `Bill ${i + 1}: fixed or variable?`, sunk)}</td></tr>`;
        })}</tbody></table></div>
      <div class="row wrap">${checkBtn(st[0])}</div>
      ${costList(c, v)}
    </details>

    <details class="card cw-step" ${filled(st[0].keys) ? 'open' : ''}>${head(st[1])}
      <p>The <strong>marginal product of labor</strong> is how many extra ${c.product_plural} one more ${c.worker} adds: the change in total output from the row above.</p>
      ${copyable(html`<table class="mini worksheet"><thead><tr><th>${cap(c.worker_plural)}</th><th>${cap(c.product_plural)}</th><th>Marginal product</th></tr></thead>
      <tbody>${m.rows.map((r) => html`<tr><td>${r.workers}</td><td>${r.q}</td><td>${r.workers ? cell(`mp:${r.workers}`, { label: `Marginal product of ${c.worker} ${r.workers}` }) : '–'}</td></tr>`)}</tbody></table>`)}
      <p class="q-line">Which ${c.worker} adds the most ${c.product_plural}? ${pick('q:top_mp', m.rows.slice(1).map((r) => [r.workers, `${c.worker} number ${r.workers}`]), `Which ${c.worker} adds the most`)}</p>
      <p class="small muted">Notice what happens after that: each extra ${c.worker} adds less than the one before (diminishing marginal product).</p>
      <div class="row wrap">${checkBtn(st[1])}</div>
    </details>

    <details class="card cw-step" ${filled(st[1].keys) ? 'open' : ''}>${head(st[2])}
      <ul class="guide">
        <li><strong>Fixed cost (FC)</strong>: ${fixedLabel}.</li>
        ${ez ? html`<li><strong>Variable cost (VC)</strong>: pay for the ${c.worker_plural} you hire plus the per-${c.product} costs × the number of ${c.product_plural}. With 0 ${c.worker_plural} you make nothing, so VC = $0.</li>`
          : html`<li><strong>Variable cost (VC)</strong>: everything you would avoid by closing for the ${c.period}: pay for ${c.worker_plural}, costs per ${c.product}, costs you pay only when open, and income you give up by opening. With 0 ${c.worker_plural} you are closed, so VC = $0.</li>`}
        <li><strong>Total cost (TC)</strong> = FC + VC.</li>
        ${ez ? '' : html`<li>Leave out anything already paid that you can't get back: it is the same whatever you decide.${fee ? ' Card fees come out of your sales; you\'ll use them in step 5.' : ''}</li>`}
      </ul>
      ${copyable(html`<table class="mini worksheet"><thead><tr><th>${cap(c.worker_plural)}</th><th>${cap(c.product_plural)}</th><th>FC</th><th>VC</th><th>TC</th></tr></thead>
      <tbody>${m.rows.map((r) => html`<tr><td>${r.workers}</td><td>${r.q}</td>${['fc', 'vc', 'tc'].map((k) => html`<td>${cell(`${k}:${r.workers}`, { label: `${k.toUpperCase()} with ${r.workers} ${c.worker_plural}`, ph: '$' })}</td>`)}</tr>`)}</tbody></table>`)}
      <div class="row wrap">${checkBtn(st[2])}</div>
    </details>

    <details class="card cw-step" ${filled(st[2].keys) ? 'open' : ''}>${head(st[3])}
      <ul class="guide">
        <li><strong>Average variable cost</strong> AVC = VC ÷ Q. <strong>Average fixed cost</strong> AFC = FC ÷ Q. <strong>Average total cost</strong> ATC = TC ÷ Q.</li>
        <li><strong>Marginal cost</strong> MC = change in TC ÷ change in Q, from the row above: what each extra ${c.product} made by that ${c.worker} costs.</li>
        <li>Round to the cent.</li>
      </ul>
      ${copyable(html`<table class="mini worksheet"><thead><tr><th>${cap(c.worker_plural)}</th><th>Q</th><th>AVC</th><th>AFC</th><th>ATC</th><th>MC</th></tr></thead>
      <tbody>${rowsQ.map((r) => html`<tr><td>${r.workers}</td><td>${r.q}</td>${['avc', 'afc', 'atc', 'mc'].map((k) => html`<td>${k === 'mc' && r.mc === null ? '–' : cell(`${k}:${r.workers}`, { label: `${k.toUpperCase()} with ${r.workers} ${c.worker_plural}`, ph: '$' })}</td>`)}</tr>`)}</tbody></table>`)}
      <p class="q-line">At what output is average variable cost lowest? ${pick('q:min_avc', rowsQ.map((r) => [r.q, `${r.q} ${c.product_plural}`]), 'Output with the lowest AVC')}</p>
      <p class="q-line">At what output is average total cost lowest? ${pick('q:min_atc', rowsQ.map((r) => [r.q, `${r.q} ${c.product_plural}`]), 'Output with the lowest ATC')}</p>
      <p class="small muted">Talk it over: why does average fixed cost always fall?${ez ? '' : ' Why is the first row\'s MC so high?'}</p>
      <div class="row wrap">${checkBtn(st[3])}</div>
    </details>

    <details class="card cw-step cw-final" open>${head(st[4])}
      <ol class="guide">
        ${fee ? html`<li><strong>Price you keep</strong> = price × (1 − card fee).</li>` : ''}
        <li><strong>How many?</strong> Hire ${c.worker_plural} up to the last one whose MC is still at or below the price${fee ? ' you keep' : ''}.${ez ? '' : ' (The first row\'s MC includes the costs of opening, so look at the rows after it.)'}</li>
        <li><strong>Open at all?</strong> If the price${fee ? ' you keep' : ''} is below AVC at that output, you lose less by closing: choose 0.</li>
        <li>Not sure? Compare profits directly: profit = price${fee ? ' you keep' : ''} × Q − TC (and −FC if you close).</li>
      </ol>
      ${copyable(html`<table class="mini worksheet sched"><thead><tr><th>Price</th>${fee ? html`<th>Price you keep</th>` : ''}<th>${cap(c.worker_plural)} to hire</th><th>${cap(c.product_plural)}</th></tr></thead>
      <tbody>${m.c.price_list.map((p) => {
        const k = priceKey(p);
        const w = v[`sch:${k}`];
        return html`<tr><td data-copy="${p}"><strong>${money(p, 2)}</strong></td>${fee ? html`<td>${cell(`keep:${k}`, { label: `Price you keep at ${money(p, 2)}`, ph: '$' })}</td>` : ''}
          <td>${pick(`sch:${k}`, m.rows.map((r) => [r.workers, r.workers === 0 ? '0 (close)' : String(r.workers), r.workers]), `${cap(c.worker_plural)} at ${money(p, 2)}`)}</td>
          <td>${w === undefined || w === '' ? '–' : m.rows[Number(w)]?.q ?? 0}</td></tr>`;
      })}</tbody></table>`)}
      ${chartPts.length ? raw(lineChart({ title: 'Your supply curve', xLabel: `${cap(c.product_plural)} per ${c.period}`, yLabel: 'Price $', height: 200,
        xTicks: qTicks(m.rows[m.rows.length - 1].q), yMax: Math.ceil(Math.max(...m.c.price_list)) + 1,
        series: [{ name: 'Your supply', color: 'supply', dots: true, points: chartPts.sort((a, b) => a[1] - b[1]) }] })) : ''}
      <div class="row wrap">${checkBtn(st[4])}
        ${g.solve ? '' : g.demo ? html`<button class="primary" type="button" data-action="cw-finish-demo">Finish and see my score</button>`
          : self ? submitButton(g, c)
          : html`<span class="small muted">Your instructor ends the game; whatever is saved then counts.</span>`}</div>
    </details>
  </div>`;
}

// ---------------------------------------------------------------------------
// Self-paced: submitting and the latest score

function submitButton(g, c) {
  const r = lastResult(g);
  const one = modelFor(c).c.attempts === 'one';
  if (!editable(g, c)) return html`<span class="small muted">${one ? 'Submitted. Your score is above.' : ''}</span>`;
  return html`<button class="primary big" type="button" data-action="cw-submit">${one ? 'Submit for grading' : r ? 'Submit again' : 'Submit and see my score'}</button>
    <span class="small muted">${one ? 'You can submit once.' : 'You can submit as often as you like; your best score counts.'}</span>`;
}

function submissionCard(g, c) {
  const r = lastResult(g);
  const s = cw(g);
  const one = modelFor(c).c.attempts === 'one';
  const pending = s.pending > (r?.attempt || 0);
  if (!r && !pending) return '';
  if (pending) return html`<section class="card result-card"><h2>Scoring your submission…</h2><p class="muted">This takes a few seconds.</p></section>`;
  return html`<section class="card result-card">
    <h2>${one ? 'Your score' : `Submission ${r.attempt}: ${num(r.score, 1)}%`}</h2>
    ${one ? html`<p class="score">${num(r.score, 1)}%</p>` : html`<p>Best so far: <strong>${num(r.best_score, 1)}%</strong> · ${r.right} of ${r.per.length} prices exactly right.</p>`}
    ${one ? perPriceTable(c, r) : practiceTable(c, r)}
    ${one ? '' : html`<p class="small muted">Not 100% yet? Look again at the prices marked ✗, fix your worksheet and submit again. The best answers are shown when your instructor closes the game.</p>`}
  </section>`;
}

// Practice mode: which prices were right, without giving away the best choice.
function practiceTable(c, r) {
  return copyable(html`<table class="mini"><thead><tr><th>Price</th><th>Your choice</th><th>Your profit</th><th>Right?</th><th>Points</th></tr></thead>
    <tbody>${r.per.map((x) => html`<tr class="${x.lost < 0.005 ? '' : 'miss'}"><td data-copy="${x.price}">${money(x.price, 2)}</td><td data-copy="${x.q}">${x.workers} → ${num(x.q)}</td>
      <td>${money(x.profit, 2)}</td><td>${x.lost < 0.005 ? html`<span class="pos">✓</span>` : html`<span class="neg">✗</span>`}</td><td>${num(x.points, 1)}%</td></tr>`)}</tbody></table>`);
}

// ---------------------------------------------------------------------------
// Results

function scheduleChart(c, mine, correct, avg, height = 230) {
  const m = modelFor(c);
  const series = [{ name: 'Best supply curve', color: 'demand', dots: true, points: correct.map((r) => [r.q, r.price]) }];
  if (avg) series.push({ name: 'Class average', color: 'muted', dashed: true, dots: true, points: avg.map((r) => [r.q, r.price]) });
  if (mine) series.push({ name: 'Yours', color: 'supply', dots: true, dashed: true, points: mine.map((r) => [r.q, r.price]) });
  return raw(lineChart({ title: 'Supply curve: price vs quantity', xLabel: `${cap(m.c.product_plural)} per ${m.c.period}`, yLabel: 'Price $', height, series,
    xTicks: qTicks(m.rows[m.rows.length - 1].q), yMax: Math.ceil(Math.max(...m.c.price_list)) + 1 }));
}

function perPriceTable(c, r) {
  const m = modelFor(c);
  return html`${copyable(html`<table class="mini"><thead><tr><th>Price</th><th>Your choice</th><th>Best</th><th>Your profit</th><th>Best profit</th><th>Points</th></tr></thead>
    <tbody>${r.per.map((x) => html`<tr class="${x.lost < 0.005 ? '' : 'miss'}"><td data-copy="${x.price}">${money(x.price, 2)}</td>
      <td data-copy="${x.q}">${x.workers} → ${num(x.q)}${x.given ? '' : html` <span class="small muted">(blank)</span>`}</td><td data-copy="${x.best_q}">${x.best_workers} → ${num(x.best_q)}</td>
      <td class="${x.profit < 0 ? 'neg' : ''}">${money(x.profit, 2)}</td><td>${money(x.best_profit, 2)}</td><td>${x.lost < 0.005 ? html`<span class="pos">100%</span>` : `${num(x.points, 1)}%`}</td></tr>`)}</tbody></table>`)}
    <p class="small muted">Choices are ${c.worker_plural} → ${c.product_plural}. Profit includes the ${money(m.fixed)} you pay even when closed${m.c.sublet > 0 ? ` and the ${money(m.c.sublet)} you give up by opening` : ''}. Points: 0% is the worst choice at that price, 100% the best.</p>`;
}

export function answerKey(c, open = false) {
  const m = modelFor(c);
  const bills = costBills(m.c);
  const ez = easy(c);
  const role = (b) => (b.close === 'sunk' ? 'Neither: already paid' : b.close === 'yes' ? 'Neither: paid either way'
    : b.fv === 'fixed' ? 'Whether to open' : b.id === 'card' ? 'Lowers the price you keep' : 'How many to make (it is in MC)');
  return html`<details class="card" ${open ? 'open' : ''}><summary>Answer key</summary>
    <h3>The bills</h3>
    ${copyable(html`<table class="mini"><thead><tr><th>Item</th>${ez ? '' : html`<th>Still costs you if closed</th>`}<th>Fixed or variable</th><th>Amount ($)</th><th>Per</th>${ez ? '' : html`<th>Matters for</th>`}</tr></thead>
      <tbody>${bills.map((b) => html`<tr><td>${b.item}</td>${ez ? '' : html`<td>${b.close === 'sunk' ? 'Already paid' : cap(b.close === 'yes' ? 'yes' : 'no')}</td>`}<td>${b.fv ? cap(b.fv) : '–'}</td>
        <td data-copy="${b.amount}">${num(b.amount, Number.isInteger(b.amount) ? 0 : 2)}</td><td>${b.per}</td>${ez ? '' : html`<td class="small">${role(b)}</td>`}</tr>`)}</tbody></table>`, 'Copy')}
    <h3>The cost table</h3>
    <p class="small muted">FC = rent + insurance = ${money(m.fixed)}. VC = pay for ${c.worker_plural} + ${money(m.perUnit + m.c.energy_cost / m.c.batch_size, 2)} per ${c.product} in inputs${m.opening ? ` + ${money(m.opening)} (lease + income given up) whenever open` : ''}.</p>
    ${copyable(html`<table class="mini"><thead><tr><th>${cap(c.worker_plural)}</th><th>Q</th><th>MP</th><th>FC</th><th>VC</th><th>TC</th><th>AVC</th><th>AFC</th><th>ATC</th><th>MC</th></tr></thead>
      <tbody>${m.rows.map((r) => html`<tr><td>${r.workers}</td><td>${r.q}</td><td>${r.mp ?? '–'}</td><td>${money(r.fc, 2)}</td><td>${money(r.vc, 2)}</td><td>${money(r.tc, 2)}</td>
        <td>${r.q ? money(r.avc, 2) : '–'}</td><td>${r.q ? money(r.afc, 2) : '–'}</td><td>${r.q ? money(r.atc, 2) : '–'}</td><td>${r.mc === null ? '–' : money(r.mc, 2)}</td></tr>`)}</tbody></table>`, 'Copy')}
    <h3>The supply schedule</h3>
    ${copyable(html`<table class="mini"><thead><tr><th>Price</th>${hasFee(c) ? html`<th>You keep</th>` : ''}<th>${cap(c.worker_plural)}</th><th>${cap(c.product_plural)}</th><th>Profit</th></tr></thead>
      <tbody>${m.supply.map((x) => html`<tr><td>${money(x.price, 2)}</td>${hasFee(c) ? html`<td>${money(x.price * m.keep, 2)}</td>` : ''}<td>${x.workers}</td><td>${x.q}</td><td class="${x.profit < 0 ? 'neg' : ''}">${money(x.profit, 2)}</td></tr>`)}</tbody></table>`, 'Copy')}
    <p class="small">Below the lowest AVC (${money(Math.min(...m.rows.filter((r) => r.q).map((r) => r.avc)), 2)} per ${c.product}) the ${c.business} closes. Above it, supply follows the rising MC. ${ez ? 'Rent and insurance never change the answer, even when profit is negative.' : 'Rent, insurance and past purchases never change the answer, even when profit is negative.'}</p>
  </details>`;
}

export function costsFinal(g, c) {
  g._costsCfg = c;
  const r = lastResult(g);
  const pub = g.public[g.public.length - 1];
  const f = g.outputs.final;
  const myRow = f?.leaderboard?.find((x) => x.name === g.team?.name);
  const grade = r ? (r.best_score ?? r.score) : null;
  return html`
    <div class="final-score">
      ${myRow ? html`<div class="place"><span class="place-n">${myRow.rank}</span><span class="place-of">of ${f.leaderboard.length}</span></div>` : ''}
      <div><p class="muted">${selfPaced(c) && r?.attempt > 1 ? 'Your best score' : 'Your score'}</p><p class="score">${grade !== null ? `${num(grade, 1)}%` : '–'}</p>
      ${r ? html`<p class="small muted">${r.auto ? 'Scored from your saved worksheet (not submitted). ' : ''}${r.attempt > 1 ? `Last submission (${r.attempt}): ${num(r.score, 1)}%, ` : ''}${r.right} of ${r.per.length} prices exactly right${r.lost > 0.005 ? ` · ${money(r.lost)} of profit missed in total` : ''}</p>` : ''}</div>
    </div>
    ${r ? html`<section class="card"><h2>Your supply schedule vs the best</h2>
      ${pub ? scheduleChart(c, r.per.map((x) => ({ price: x.price, q: x.q })), pub.correct, pub.class_average_q) : ''}
      ${perPriceTable(c, r)}</section>` : ''}
    ${f?.leaderboard ? html`<section class="card"><h2>Final standings</h2><table class="board"><thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead><tbody>
      ${f.leaderboard.map((x) => html`<tr class="${x.name === g.team?.name ? 'me' : ''}"><td>${x.rank}</td><td>${x.name}</td><td>${num(x.total, 1)}%</td></tr>`)}</tbody></table></section>` : ''}
    ${c.show_answers ? answerKey(c) : ''}`;
}

// ---------------------------------------------------------------------------
// Instructor

export function costsInstructor(st, c, teamOf) {
  const s = st.session;
  const m = modelFor(c);
  const ans = costsAnswers(c);
  const stp = steps(c);
  const self = selfPaced(c);
  const running = ['running', 'paused'].includes(s.status);
  const dec = Object.fromEntries((st.decisions || []).map((d) => [d.team_id, d.payload]));
  const res = Object.fromEntries((st.results || []).map((r) => [r.team_id, r.payload]));
  const who = s.team_mode === 'teams' ? 'Team' : 'Student';
  const stepCell = (v, step) => {
    const done = step.keys.filter((k) => v[k] !== undefined && v[k] !== '');
    const right = done.filter((k) => isRight(k, v[k], ans[k])).length;
    return done.length ? html`<span class="${right === step.keys.length ? 'pos' : ''}">${right}/${step.keys.length}</span>` : html`<span class="muted">–</span>`;
  };
  let body;
  if (running) {
    const ids = [...new Set([...(st.required || []), ...Object.keys(res)])];
    const rows = ids.map((id) => {
      const v = dec[id]?.v || {};
      const sc = scoreSchedule(m, dec[id]?.schedule || {});
      return { id, name: teamOf[id]?.name || '?', v, sc, r: res[id] };
    }).sort((a, b) => (self ? (b.r?.best_score ?? -1) - (a.r?.best_score ?? -1) : 0) || b.sc.score - a.sc.score);
    body = html`<section class="card"><h2>${self ? 'Students' : 'Team progress'}</h2>
      <p class="small muted">Cells right out of each step's total, from each ${who.toLowerCase()}'s saved worksheet.${self ? ' "Best score" counts their submissions; "Saved work" is what their current worksheet would score.' : ' "Score now" is what they would get if you ended the game now.'}</p>
      ${copyable(html`<table class="mini"><thead><tr><th>${who}</th>${stp.map((x) => html`<th title="${x.title}">Step ${x.n}</th>`)}<th>Prices filled</th><th>${self ? 'Saved work' : 'Score now'}</th>${self ? html`<th>Submissions</th><th>Best score</th>` : ''}</tr></thead>
      <tbody>${rows.length ? rows.map((r) => html`<tr data-key="cp-${r.id}"><td>${r.name}</td>${stp.map((x) => html`<td>${stepCell(r.v, x)}</td>`)}<td>${r.sc.filled}/${m.c.price_list.length}</td><td>${dec[r.id] ? `${num(r.sc.score, 1)}%` : '–'}</td>
        ${self ? html`<td>${r.r?.attempt ?? 0}</td><td>${r.r ? html`<strong>${num(r.r.best_score, 1)}%</strong>` : '–'}</td>` : ''}</tr>`)
        : html`<tr><td colspan="${stp.length + (self ? 5 : 3)}" class="muted">${self ? 'Nobody has opened it yet.' : 'Nobody yet.'}</td></tr>`}</tbody></table>`)}</section>`;
  } else {
    const list = (st.results || []).map((r) => ({ id: r.team_id, name: teamOf[r.team_id]?.name || '?', p: r.payload, v: dec[r.team_id]?.v || {}, grade: Number(r.earnings) }))
      .sort((a, b) => b.grade - a.grade);
    const pub = st.public[st.public.length - 1];
    body = html`<div class="stack-cards">
      <section class="card">${pub ? scheduleChart(c, null, pub.correct, pub.class_average_q) : ''}
        ${pub ? html`<p class="small muted">Average score ${num(pub.average_score, 1)}%. Share of ${s.team_mode === 'teams' ? 'teams' : 'students'} exactly right at each price: ${pub.right_share.map((x) => `${money(x.price, 2)} ${Math.round((x.share || 0) * 100)}%`).join(' · ')}</p>` : ''}</section>
      <section class="card"><h2>Standings</h2><table class="board"><thead><tr><th>#</th><th>${who}</th><th>Score</th><th>Right</th></tr></thead>
        <tbody>${list.map((r, i) => html`<tr class="${store.ui.ctlPeek === r.id ? 'peek-open' : ''}" data-key="cs-${r.id}"><td>${i + 1}</td>
          <td><button class="link peek" data-action="ctl-peek" data-id="${r.id}" aria-expanded="${store.ui.ctlPeek === r.id ? 'true' : 'false'}">${r.name}<span class="peek-caret" aria-hidden="true">${store.ui.ctlPeek === r.id ? '▾' : '▸'}</span></button>${r.p.auto && self ? html` <span class="small muted">(not submitted)</span>` : ''}</td>
          <td>${num(r.grade, 1)}%</td><td>${r.p.right}/${r.p.per.length}</td></tr>
          ${store.ui.ctlPeek === r.id ? html`<tr class="peek-row" data-key="csp-${r.id}"><td colspan="4">${self && r.p.attempt > 1 ? html`<p class="small muted">Last of ${r.p.attempt} submissions (${num(r.p.score, 1)}%); best ${num(r.p.best_score, 1)}%.</p>` : ''}${perPriceTable(c, r.p)}
            ${Object.keys(r.v).length ? html`<p class="small">Worksheet cells right: ${stp.slice(0, 4).map((x) => html`step ${x.n} ${stepCell(r.v, x)} `)}</p>` : ''}</td></tr>` : ''}`)}</tbody></table>
        <p class="small muted">Click a name to see that ${who.toLowerCase()}'s schedule and worksheet.</p></section>
    </div>`;
  }
  return html`${body}${answerKey(c)}`;
}

export function costsProjector(st, c) {
  const pub = st.public[st.public.length - 1];
  if (!pub) return '';
  return scheduleChart(c, null, pub.correct, pub.class_average_q, 280);
}

// ---------------------------------------------------------------------------
// The instructor's solve screen: the same worksheet, filled in step by step on the projector. Nothing is saved.

export function costsSolve(st, c) {
  const s = st.session;
  const id = `solve-${s.id}`;
  if (!store.ui.solveG || store.ui.solveG.session.id !== id) {
    store.ui.solveG = { solve: true, session: { ...s, id, status: 'running' }, me: { required: true }, results: [], public: [], outputs: {} };
  }
  const g = store.ui.solveG;
  g._costsCfg = c;
  const st5 = steps(c);
  return html`<main class="page play solve gt-costs">
    <a class="back" href="#/teach/game/${s.id}">← Back to the game</a>
    <div class="demo-banner"><span>Teacher screen: work through the problem with your class. Nothing here is saved or seen by students.</span></div>
    <h1>${s.title}: worked solution</h1>
    <div class="card solve-tools">
      <p class="small muted">Fill in one step at a time, or type into the worksheet yourself and press "Check step".</p>
      <div class="row wrap">${st5.map((x) => html`<button type="button" data-action="solve-fill" data-step="${x.id}">Fill in step ${x.n}</button>`)}
        <button type="button" data-action="solve-fill" data-step="all">Fill in everything</button>
        <button type="button" class="link" data-action="solve-clear">Clear</button></div>
    </div>
    ${costsLive(g, c)}
    ${answerKey(c)}
  </main>`;
}
on('solve-fill', (el) => {
  const g = store.ui.solveG;
  const c = g._costsCfg;
  const ans = costsAnswers(c);
  const s = cw(g);
  const keys = el.dataset.step === 'all' ? steps(c).flatMap((x) => x.keys) : steps(c).find((x) => x.id === el.dataset.step).keys;
  for (const k of keys) { s.local[k] = fmtAnswer(ans[k]); s.marks[k] = 'ok'; }
  for (const i of document.querySelectorAll('.cw [data-k]')) i.dataset.dirty = '';
  for (const d of document.querySelectorAll('.cw details.cw-step')) d.open = true;
  rerender();
});
on('solve-clear', () => {
  const g = store.ui.solveG;
  const s = cw(g);
  s.local = {}; s.marks = {};
  for (const i of document.querySelectorAll('.cw [data-k]')) { i.dataset.dirty = ''; if (i.tagName === 'INPUT') i.value = ''; else i.selectedIndex = 0; }
  rerender();
});
