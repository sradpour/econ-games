import { html, store, setState, setUi, on, toast, rerender, plural, confirmed } from '../lib/dom.js';
import { rpc } from '../lib/api.js';
import { GAME_LABELS, GAME_INFO, SETTINGS, defaultsFor, MARKETS, STORIES, normalizeConfig } from '../lib/games.js';
import { benchmarks } from '../lib/engine.js';
import { marginalProduct } from '../lib/engine.js';
import { go } from '../app.js';
import { statusChip } from './student.js';

export async function enterTeach() {
  if (!store.me?.is_instructor) return;
  const teach = await rpc('instructor_home');
  setState({ teach });
  const r = store.route;
  if (r?.name === 'class') setUi('roster', () => ({ id: r.id, rows: null }));
  if (r?.name === 'class') loadRoster(r.id);
}
async function loadRoster(id) {
  const rows = await rpc('class_roster', { p_class: id });
  setUi('roster', () => ({ id, rows }));
}

const notInstructor = () => html`<main class="page narrow"><h1>Teach</h1>
  ${store.me.instructor_status === 'pending' ? html`<p>Your request for instructor access is waiting for the site admin.</p>`
    : html`<p>You need instructor access to run games.</p><button class="primary" data-action="request-instructor">Request instructor access</button>`}</main>`;

// ---------------------------------------------------------------------------

export function renderTeach() {
  if (!store.me.is_instructor) return notInstructor();
  const t = store.teach;
  if (!t) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  const active = t.classes.filter((c) => !c.archived), archived = t.classes.filter((c) => c.archived);
  return html`<main class="page teach">
    <div class="page-head"><h1>Your classes</h1></div>
    ${active.length === 0 ? html`<section class="empty"><h2>Create your first class</h2><p>Students join with a six-letter code. You can limit sign-ups to your school's email domain.</p></section>` : ''}
    ${active.map((c) => classCard(c))}
    <details class="card newclass" ${active.length === 0 ? 'open' : ''}><summary>New class</summary>
      <form class="stack" data-action="create-class">
        <label>Class name <input name="name" required placeholder="ECON 1200 — Fall 2026"></label>
        <label>Who can join <input name="domains" value="${t.default_student_domains || ''}" placeholder="go.stockton.edu">
          <span class="help">Email domains, separated by commas. Leave blank to allow any Google account.</span></label>
        <button class="primary" type="submit">Create class</button>
      </form></details>
    ${archived.length ? html`<details class="archived"><summary>Archived classes (${archived.length})</summary>${archived.map((c) => classCard(c))}</details>` : ''}
  </main>`;
}

function classCard(c) {
  return html`<section class="class-card card" data-key="${c.id}">
    <div class="cc-head">
      <div><h2><a href="#/teach/class/${c.id}">${c.name}</a></h2>
        <p class="muted small">${plural(Math.max(0, c.members - 1), 'student')} · ${c.allowed_domains.length ? c.allowed_domains.join(', ') : 'any account'}</p></div>
      <div class="code-box" title="Class code"><span class="small muted">Class code</span><strong>${c.join_code}</strong></div>
    </div>
    ${c.sessions.length ? html`<ul class="game-list">${c.sessions.slice(0, 8).map((s) => html`<li data-key="${s.id}"><a class="game-row ${s.status} gt-${s.game_type}" href="#/teach/game/${s.id}">
      <span class="g-title">${s.title}</span><span class="g-type">${GAME_LABELS[s.game_type]} · ${plural(s.players, 'player')}</span>${statusChip(s.status)}</a></li>`)}</ul>
      ${c.sessions.length > 8 ? html`<p class="small"><a href="#/teach/class/${c.id}">All ${c.sessions.length} games</a></p>` : ''}` : html`<p class="muted">No games yet.</p>`}
    <div class="row"><a class="button primary" href="#/teach/new/${c.id}">New game</a><a class="button" href="#/teach/class/${c.id}">Roster and settings</a></div>
  </section>`;
}

on('create-class', async (form, d) => {
  const c = await rpc('create_class', { p_name: d.name, p_domains: splitDomains(d.domains) });
  form.reset();
  toast(`Created. Class code ${c.join_code}`);
  await enterTeach();
});
const splitDomains = (s) => String(s || '').split(/[,\s]+/).map((x) => x.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------------------
// Class page

export function renderClass(id) {
  if (!store.me.is_instructor) return notInstructor();
  const c = store.teach?.classes.find((x) => x.id === id);
  if (!c) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  const roster = store.ui.roster?.id === id ? store.ui.roster.rows : null;
  const students = (roster || []).filter((r) => r.user_id !== store.me.id);
  return html`<main class="page teach">
    <a class="back" href="#/teach">← Your classes</a>
    <div class="page-head"><h1>${c.name}</h1><div class="code-box big"><span class="small muted">Class code</span><strong>${c.join_code}</strong></div></div>
    <section class="card">
      <h2>Settings</h2>
      <form class="stack" data-action="update-class" data-id="${c.id}">
        <label>Class name <input name="name" value="${c.name}" required></label>
        <label>Who can join <input name="domains" value="${c.allowed_domains.join(', ')}"><span class="help">Email domains, separated by commas. Blank = any Google account.</span></label>
        <label class="switch"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}> <span>Archived (hidden from students)</span></label>
        <div class="row"><button class="primary" type="submit">Save</button><button type="button" data-action="new-code" data-id="${c.id}">Make a new class code</button></div>
      </form>
    </section>
    <section class="card">
      <div class="row spread"><h2>Students (${roster ? students.length : '…'})</h2>${roster ? html`<button data-action="roster-csv" data-id="${c.id}">Download roster</button>` : ''}</div>
      ${roster === null ? html`<p class="muted">Loading…</p>` : students.length === 0 ? html`<p class="muted">Nobody has joined yet. Share the class code ${c.join_code}.</p>` :
        html`<div class="scroll"><table class="mini"><thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th></th></tr></thead><tbody>
        ${students.map((r) => html`<tr data-key="${r.user_id}"><td>${r.name || '–'}</td><td>${r.student_id || '–'}</td><td>${r.email}</td>
          <td><button class="link danger" data-action="remove-member" data-class="${c.id}" data-user="${r.user_id}" data-name="${r.name || r.email}">Remove</button></td></tr>`)}
        </tbody></table></div>`}
    </section>
    <section class="card"><div class="row spread"><h2>Games</h2><a class="button primary" href="#/teach/new/${c.id}">New game</a></div>
      <ul class="game-list">${c.sessions.map((s) => html`<li data-key="${s.id}"><a class="game-row ${s.status} gt-${s.game_type}" href="#/teach/game/${s.id}">
        <span class="g-title">${s.title}</span><span class="g-type">${GAME_LABELS[s.game_type]} · ${plural(s.players, 'player')}</span>${statusChip(s.status)}</a></li>`)}</ul></section>
  </main>`;
}

on('update-class', async (form, d) => {
  await rpc('update_class', { p_class: form.dataset.id, p_name: d.name, p_domains: splitDomains(d.domains), p_archived: !!form.archived.checked, p_new_code: false });
  toast('Saved'); await enterTeach();
});
on('new-code', async (el) => {
  if (!confirmed(el, 'Make a new class code? The old one stops working; students already in the class stay in.')) return;
  const c = store.teach.classes.find((x) => x.id === el.dataset.id);
  await rpc('update_class', { p_class: c.id, p_name: c.name, p_domains: c.allowed_domains, p_archived: c.archived, p_new_code: true });
  await enterTeach();
});
on('remove-member', async (el) => {
  if (!confirmed(el, `Remove ${el.dataset.name} from this class?`)) return;
  await rpc('remove_class_member', { p_class: el.dataset.class, p_user: el.dataset.user });
  await loadRoster(el.dataset.class);
});
on('roster-csv', async (el) => {
  const { downloadCsv } = await import('../lib/csv.js');
  const rows = store.ui.roster.rows.filter((r) => r.user_id !== store.me.id).map((r) => ({ name: r.name, student_id: r.student_id, email: r.email, joined: r.joined_at }));
  const c = store.teach.classes.find((x) => x.id === el.dataset.id);
  downloadCsv(`${c.name} roster.csv`, rows);
});

// ---------------------------------------------------------------------------
// New game

const PRESETS = {
  standard: { label: 'Standard', patch: {} },
  highfixed: { label: 'High fixed cost', patch: { fixed_cost: 300, avoidable_share: 0.8 }, help: 'Losses are likely; sitting out becomes a real choice (shutdown rule).' },
  sunk: { label: 'Mostly sunk fixed cost', patch: { fixed_cost: 250, avoidable_share: 0.1 }, help: 'Sitting out saves little, so firms keep selling at a loss.' },
  steepmc: { label: 'Fast-falling productivity', patch: { productivity_half: 6 }, help: 'The kitchen crowds quickly: each extra hour adds much less, so marginal cost rises steeply.' },
};

export function renderNewGame(classId) {
  if (!store.me.is_instructor) return notInstructor();
  const c = store.teach?.classes.find((x) => x.id === classId);
  if (!c) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  const ng = store.ui.newGame?.classId === classId ? store.ui.newGame : null;
  if (!ng?.type) {
    return html`<main class="page teach"><a class="back" href="#/teach">← Your classes</a>
      <h1>New game for ${c.name}</h1>
      <h2 class="group-h">Market structures</h2>
      <div class="type-grid">${MARKETS.map((t) => typeCard(t, classId))}</div>
      <h2 class="group-h">Games of strategy</h2>
      <div class="type-grid">${['pd_live', 'pd_tournament', 'public_goods', 'ultimatum', 'commons'].map((t) => typeCard(t, classId))}</div>
    </main>`;
  }
  const values = ng.values;
  return html`<main class="page teach"><button class="link back" data-action="ng-back">← Choose a different game</button>
    <h1>${GAME_LABELS[ng.type]}</h1><p class="lede">${GAME_INFO[ng.type].short}</p>
    ${MARKETS.includes(ng.type) ? html`<div class="presets"><span class="small muted">Quick setups:</span>${Object.entries(PRESETS).map(([k, p]) =>
      html`<button class="${ng.preset === k ? 'chosen' : ''}" data-action="ng-preset" data-preset="${k}" title="${p.help || ''}">${p.label}</button>`)}
      ${ng.preset && PRESETS[ng.preset].help ? html`<p class="small muted">${PRESETS[ng.preset].help}</p>` : ''}</div>` : ''}
    <form class="card settings" data-action="create-game">
      <label>Title students will see <input name="title" required value="${values.title}" data-input="ng-field"></label>
      ${MARKETS.includes(ng.type) ? costSummary(ng.type, values) : ''}
      <div class="settings-grid">${SETTINGS[ng.type].filter((s) => !s.showIf || s.showIf(values)).map((s) => field(s, values[s.key]))}</div>
      <div class="row"><button class="primary big" type="submit">Create game</button></div>
      <p class="small muted">Players join from their class page. You start the game when everyone is in.</p>
    </form></main>`;
}

function costSummary(type, values) {
  const c = normalizeConfig(type, values);
  const q = 4 * c.productivity_half;
  return html`<div class="note small">With these settings, marginal cost = ${'$'}${c.mc_intercept.toFixed(2)} + ${c.mc_slope.toFixed(3)} × quantity.
    At ${q} ${c.product_plural}, one more hour of labor adds ${marginalProduct(q, c).toFixed(2)} ${c.product_plural}, so the next ${c.product} costs ${'$'}${(c.mc_intercept + c.mc_slope * q).toFixed(2)}.
    ${type === 'competitive' && c.market_rule !== 'cheapest' ? (() => { const b = benchmarks('competitive', c, 1); return `Market price: ${'$'}${b.price.toFixed(2)}${c.market_price > 0 ? '' : ' (the competitive equilibrium)'}. The best a firm can do is make about ${Math.round(b.quantity_per_firm)} ${c.product_plural} (marginal cost = price), for a profit of ${'$'}${b.profit_per_firm.toFixed(0)} per round.`; })() : ''}</div>`;
}

function typeCard(t, classId) {
  return html`<button class="type-card gt-${t}" data-action="ng-type" data-type="${t}" data-class="${classId}">
    <strong>${GAME_LABELS[t]}</strong><span>${GAME_INFO[t].short}</span></button>`;
}

function field(s, v) {
  const id = `f_${s.key}`;
  if (s.type === 'bool') return html`<label class="switch wide"><input type="checkbox" name="${id}" ${v ? 'checked' : ''} data-change="ng-field"> <span>${s.label}</span>${s.help ? html`<span class="help">${s.help}</span>` : ''}</label>`;
  if (s.type === 'text') return html`<label for="${id}">${s.label}<input id="${id}" type="text" name="${id}" value="${v ?? ''}" maxlength="40" data-input="ng-field">${s.help ? html`<span class="help">${s.help}</span>` : ''}</label>`;
  if (s.type === 'select') return html`<label for="${id}">${s.label}<select id="${id}" name="${id}" data-change="ng-field">${s.options.map(([val, lab]) => html`<option value="${val}" ${String(v) === val ? 'selected' : ''}>${lab}</option>`)}</select>${s.help ? html`<span class="help">${s.help}</span>` : ''}</label>`;
  return html`<label for="${id}">${s.label}<input id="${id}" type="number" name="${id}" value="${v}" ${s.min !== undefined ? `min="${s.min}"` : ''} ${s.max !== undefined ? `max="${s.max}"` : ''} step="${s.step ?? 'any'}" data-input="ng-field">${s.help ? html`<span class="help">${s.help}</span>` : ''}</label>`;
}

on('ng-type', (el) => {
  const t = el.dataset.type;
  setUi('newGame', () => ({ classId: el.dataset.class, type: t, preset: MARKETS.includes(t) ? 'standard' : null, values: { title: GAME_LABELS[t], ...defaultsFor(t) } }));
  window.scrollTo(0, 0);
});
on('ng-back', () => setUi('newGame', () => null));
on('ng-preset', (el) => {
  const ng = store.ui.newGame;
  const base = { title: ng.values.title, ...defaultsFor(ng.type), team_mode: ng.values.team_mode, team_size: ng.values.team_size, rounds: ng.values.rounds, round_seconds: ng.values.round_seconds };
  setUi('newGame', { preset: el.dataset.preset, values: { ...base, ...PRESETS[el.dataset.preset].patch } });
  for (const i of document.querySelectorAll('.settings input, .settings select')) i.dataset.dirty = '';
});
on('ng-field', (el) => {
  const ng = store.ui.newGame;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  const key = el.name.startsWith('f_') ? el.name.slice(2) : el.name;
  ng.values = { ...ng.values, [key]: v };
  if (key === 'story' && STORIES[v]) {
    ng.values = { ...ng.values, ...STORIES[v] };
    for (const k of Object.keys(STORIES[v])) { const i = document.querySelector(`[name="f_${k}"]`); if (i) i.dataset.dirty = ''; }
  }
  if (MARKETS.includes(ng.type) && el.type === 'number') rerender(); // refresh the marginal cost summary
  if (el.tagName === 'SELECT' || el.type === 'checkbox') rerender(); // may show/hide dependent fields
});
on('create-game', async () => {
  const ng = store.ui.newGame;
  const { title, ...config } = ng.values;
  for (const s of SETTINGS[ng.type]) if (s.type === 'number' && config[s.key] === '') delete config[s.key];
  const r = await rpc('create_session', { p_class: ng.classId, p_game_type: ng.type, p_title: title, p_config: config });
  store.ui.newGame = null;
  go(`#/teach/game/${r.id}`);
});
