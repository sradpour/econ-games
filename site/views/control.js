// Instructor control room for one game (+ projector view).
import { html, raw, store, setState, setUi, on, toast, money, num, pct, plural, confirmed } from '../lib/dom.js';
import { rpc, watchSession } from '../lib/api.js';
import { GAME_LABELS, normalizeConfig, MARKETS, SETTINGS } from '../lib/games.js';
import { lineChart, barChart } from '../lib/chart.js';
import { benchmarks } from '../lib/engine.js';
import { downloadCsv, flatten } from '../lib/csv.js';
import { runTournament, HOUSE, computerName } from '../lib/pd.js';
import { syncClock, go } from '../app.js';
import { statusChip } from './student.js';
import { timerBar } from './play.js';
import { roundsTotal, moveStrip, firmHistory } from './panels.js';
import { tournamentResults } from './lab.js';
import { costsInstructor, costsProjector } from './costs.js';

let stop = null, current = null, loading = false, again = false;

let chatTimer = null;
export function enterControl(id) {
  current = id;
  setState({ ctrl: null });
  store.ui.ichat = null;
  load();
  stop = watchSession(id, load);
  chatTimer = setInterval(() => {
    const st = store.ctrl;
    if (st?.session?.game_type === 'commons' && st.session.status === 'running' && document.visibilityState === 'visible') loadChat();
  }, 3000);
}
export function leaveControl() { stop?.(); stop = null; current = null; clearInterval(chatTimer); chatTimer = null; }

let chatBusy = false;
async function loadChat() {
  if (!current || chatBusy) return;
  chatBusy = true;
  try {
    const id = current;
    const cur = store.ui.ichat?.session === id ? store.ui.ichat : { session: id, items: [], last: 0 };
    const rows = await rpc('instructor_messages', { p_session: id, p_after: cur.last });
    if (id !== current || (!rows.length && store.ui.ichat)) return;
    const items = [...cur.items, ...rows];
    setUi('ichat', () => ({ session: id, items, last: items.length ? items[items.length - 1].id : 0 }));
  } catch (e) { /* try again next time */ } finally { chatBusy = false; }
}

async function load() {
  if (!current) return;
  if (loading) { again = true; return; }
  loading = true;
  try {
    const id = current;
    const st = await rpc('instructor_state', { p_session: id });
    if (id !== current) return;
    if (st.session.game_type === 'competitive' && ['running', 'paused'].includes(st.session.status)) {
      st.round_info = await rpc('instructor_round_info', { p_session: id }).catch(() => null);
    }
    syncClock(st.server_now);
    setState({ ctrl: st });
    if (st.session.game_type === 'commons' && !store.ui.ichat) loadChat();
  } catch (e) { setState({ ctrl: { error: e.message } }); }
  finally { loading = false; if (again) { again = false; load(); } }
}

const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

// ---------------------------------------------------------------------------

export function renderControl(route) {
  const st = store.ctrl;
  if (!st) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  if (st.error) return html`<main class="page narrow"><h1>Can't open this game</h1><p>${st.error}</p><a href="#/teach">Back</a></main>`;
  const s = st.session;
  const c = normalizeConfig(s.game_type, s.config);
  if (route.projector) return projector(st, c);
  const teamOf = Object.fromEntries(st.teams.map((t) => [t.id, t]));
  return html`<main class="page control gt-${s.game_type}">
    <a class="back" href="#/teach">← ${s.class_name}</a>
    <div class="ctrl-head">
      <div>${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}<h1>${s.title}</h1>${statusChip(s.status)}</div>
      <div class="join-box"><span class="small muted">Students join at</span><strong>${siteUrl().replace(/^https?:\/\//, '')}</strong>
        <span class="small muted">Class code <strong>${s.join_code}</strong></span></div>
    </div>
    ${st.last_error ? html`<div class="banner error"><p><strong>The game engine reported a problem:</strong> ${st.last_error}</p><button data-action="ctl" data-op="retry">Try again</button></div>` : ''}
    ${controls(st, c)}
    ${s.status === 'lobby' ? lobbyPanel(st, c) : ''}
    ${s.game_type === 'pd_tournament' ? tournamentPanel(st, c) : (s.status !== 'lobby' ? livePanels(st, c, teamOf) : '')}
    ${displaySettings(st, c)}
  </main>`;
}

function controls(st, c) {
  const s = st.session;
  const total = roundsTotal(s.game_type, c);
  const prog = st.required?.length ? st.decisions.filter((d) => st.required.includes(d.team_id)).length : 0;
  const isT = s.game_type === 'pd_tournament';
  if (isT && s.status === 'finished') return '';
  return html`<section class="card controls">
    ${s.status === 'lobby' ? html`<div class="row spread"><p class="big-line">${plural(st.players.length, 'player')} joined · ${st.players.filter((p) => p.passed_check).length} passed the check</p>
      <div class="row"><a class="button" href="#/teach/game/${s.id}/projector">Projector view</a><button class="primary big" data-action="ctl" data-op="start">Start game</button></div></div>` : ''}
    ${['running', 'paused'].includes(s.status) && !isT ? html`
      <div class="ctrl-status"><div class="round-badge"><span class="rb-n">${s.round_no}</span><span class="rb-of">${total ? `of ${total}` : 'round'}</span></div>
        <div class="grow">${timerBar(s, s.stage === 'punish' ? 'Punishment stage' : s.stage === 'respond' ? 'Responses' : s.stage === 'chat' ? 'Chat closes in' : 'Round closes in')}
        ${s.game_type === 'commons' ? html`<p class="small muted">${commonsWhere(st, c)}</p>` : ''}
        ${st.round_info?.market_price != null ? roundPriceNote(st.round_info.market_price, c) : ''}
        <p class="big-line">${prog} of ${st.required.length} ${s.game_type === 'costs' ? 'have saved work' : 'submitted'}</p></div></div>
      <div class="row wrap">
        ${s.status === 'running' ? html`<button data-action="ctl" data-op="pause">Pause</button>` : html`<button class="primary" data-action="ctl" data-op="resume">Resume</button>`}
        <button data-action="ctl" data-op="extend" data-seconds="30">+30 seconds</button>
        <button data-action="ctl" data-op="extend" data-seconds="60">+1 minute</button>
        <button class="primary" data-action="ctl" data-op="end_stage">${s.game_type === 'costs' ? 'End and score now' : `End ${s.stage === 'chat' ? 'chat' : s.stage === 'punish' || s.stage === 'respond' ? 'stage' : 'round'} now`}</button>
        <a class="button" href="#/teach/game/${s.id}/projector">Projector view</a>
        <button class="danger" data-action="ctl" data-op="finish">End game</button>
      </div>` : ''}
    ${!isT && s.status !== 'lobby' ? html`<div class="row wrap exports">
      <button data-action="export" data-kind="summary">Download grades (one row per student)</button>
      <button data-action="export" data-kind="detail">Download all rounds</button>
      ${s.game_type === 'commons' && c.chat !== 'off' ? html`<button data-action="export-chat">Download chat log</button>` : ''}</div>` : ''}
  </section>`;
}

on('ctl', async (el) => {
  const op = el.dataset.op;
  if (op === 'finish' && !confirmed(el, 'End the game now? Scores so far become final.')) return;
  if (op === 'start' && store.ctrl.players.some((p) => !p.passed_check)
      && !confirmed(el, 'Some players have not passed the quick check yet; they cannot submit until they do.')) return;
  await rpc('instructor_control', { p_session: current, p_action: op, p_seconds: el.dataset.seconds ? Number(el.dataset.seconds) : null });
  if (op === 'start') toast('Starting…');
  setTimeout(load, 600); setTimeout(load, 2000);
});
on('ctl-peek', (el) => setUi('ctlPeek', () => (store.ui.ctlPeek === el.dataset.id ? null : el.dataset.id)));
on('delete-game', async (el) => {
  if (!confirmed(el, 'This deletes the game and all its results permanently.')) return;
  await rpc('delete_session', { p_session: current });
  go('#/teach');
});

// ---------------------------------------------------------------------------
// Lobby

function lobbyPanel(st, c) {
  const s = st.session;
  const teams = st.teams.filter((t) => !t.is_solo);
  const unteamed = st.players.filter((p) => !p.team_id);
  return html`<section class="card">
    <h2>Players</h2>
    ${st.players.length === 0 ? html`<p class="muted">Nobody yet. Students open the game from their class page.</p>` : ''}
    ${s.team_mode === 'teams' ? html`
      <div class="team-admin">${teams.map((t) => html`<div class="team-box" data-key="${t.id}">
        <form class="inline" data-action="t-rename" data-team="${t.id}"><input name="name" value="${t.name}" aria-label="Team name"><button type="submit">Rename</button></form>
        <ul>${st.players.filter((p) => p.team_id === t.id).map((p) => playerLi(p, st))}</ul>
        <button class="link danger" data-action="t-delete" data-team="${t.id}">Remove team</button></div>`)}</div>
      ${unteamed.length ? html`<h3>Not on a team yet</h3><p class="small muted">They will be placed in teams with space when you start.</p><ul>${unteamed.map((p) => playerLi(p, st))}</ul>` : ''}`
      : html`<ul class="player-grid">${st.players.map((p) => playerLi(p, st))}</ul>`}
  </section>`;
}
function playerLi(p, st) {
  return html`<li data-key="${p.user_id}" class="player"><span>${p.name}</span>
    ${p.passed_check ? html`<span class="ok" title="Passed the quick check">✓</span>` : html`<button class="link small" data-action="p-check" data-user="${p.user_id}" title="Let them skip the check">mark checked</button>`}
    ${st.session.team_mode === 'teams' && st.teams.filter((t) => !t.is_solo).length ? html`<select data-change="p-move" data-user="${p.user_id}" aria-label="Move ${p.name}">
      <option value="">Move to…</option>${st.teams.filter((t) => !t.is_solo && t.id !== p.team_id).map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select>` : ''}
    <button class="link small danger" data-action="p-remove" data-user="${p.user_id}" data-name="${p.name}">remove</button></li>`;
}
const teamAct = (action, extra) => rpc('instructor_team_action', { p_session: current, p_action: action, p_team: extra.team ?? null, p_user: extra.user ?? null, p_name: extra.name ?? null }).then(load);
on('t-rename', async (form, d) => teamAct('rename', { team: form.dataset.team, name: d.name }));
on('t-delete', async (el) => { if (confirmed(el, 'Remove this team? Its members go back to having no team.')) await teamAct('delete_team', { team: el.dataset.team }); });
on('p-move', async (el) => { if (el.value) await teamAct('move_player', { team: el.value, user: el.dataset.user }); });
on('p-remove', async (el) => { if (confirmed(el, `Remove ${el.dataset.name} from this game?`)) await teamAct('remove_player', { user: el.dataset.user }); });
on('p-check', async (el) => teamAct('mark_checked', { user: el.dataset.user }));

// ---------------------------------------------------------------------------
// Live monitoring

function livePanels(st, c, teamOf) {
  const s = st.session;
  const t = s.game_type;
  if (t === 'costs') return costsInstructor(st, c, teamOf);
  const pubs = st.public;
  const b = st.outputs.benchmarks;
  const lastRound = pubs.length ? pubs[pubs.length - 1].round_no : null;
  const lastResults = st.results.filter((r) => r.round_no === lastRound);
  const totals = {};
  for (const r of st.results) totals[r.team_id] = (totals[r.team_id] || 0) + Number(r.earnings);
  const board = Object.entries(totals).map(([id, total]) => ({ id, name: teamOf[id]?.name || '?', total })).sort((x, y) => y.total - x.total);

  let chart = '';
  if (MARKETS.includes(t)) {
    const byRound = (k) => pubs.map((p) => [p.round_no, p[k]]);
    const prices = (fn) => pubs.map((p) => { const ps = st.results.filter((r) => r.round_no === p.round_no && r.payload.participated).map((r) => r.payload.price); return [p.round_no, ps.length ? fn(...ps) : null]; });
    const refs = [];
    if (b?.price) refs.push({ y: b.price, label: `${t === 'monopoly' ? 'Monopoly' : 'Competitive'} price ${money(b.price, 2)}` });
    if (b?.nash_price) refs.push({ y: b.nash_price, label: `Nash ${money(b.nash_price, 2)}` }, { y: b.joint_price, label: `Joint profit ${money(b.joint_price, 2)}` });
    chart = lineChart({ title: 'Prices by round', xInteger: true, xLabel: 'Round', yLabel: '$', refs,
      series: [{ name: t === 'monopoly' ? 'Average' : 'Market price', color: 'demand', dots: true, points: byRound(t === 'monopoly' ? 'average_price' : 'market_price') },
        { name: 'Highest', color: 'muted', dashed: true, points: prices(Math.max) }, { name: 'Lowest', color: 'muted', dashed: true, points: prices(Math.min) }] });
  } else if (t === 'pd_live') {
    chart = lineChart({ title: 'Cooperation rate', xInteger: true, xLabel: 'Round', yLabel: '%', yMax: 100, series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.cooperation_rate === null ? null : p.cooperation_rate * 100]) }] });
  } else if (t === 'public_goods') {
    chart = lineChart({ title: 'Average contribution', xInteger: true, xLabel: 'Round', yLabel: 'tokens',
      refs: c.rounds_punish > 0 && c.rounds_no_punish > 0 ? [] : [],
      series: [{ name: 'Average', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_contribution]) }] });
  } else if (t === 'commons') {
    chart = commonsChart(st, c);
  } else if (t === 'ultimatum') {
    chart = lineChart({ title: 'Offers', xInteger: true, xLabel: 'Round', yLabel: '$', series: [
      { name: 'Average offer', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_offer]) },
      ...(c.variant === 'dictator' ? [] : [{ name: 'Rejection rate × pie', color: 'supply', dashed: true, points: pubs.map((p) => [p.round_no, p.rejection_rate === null || p.rejection_rate === undefined ? null : p.rejection_rate * c.pie]) }])] });
  }

  return html`
    <div class="ctrl-grid">
      <section class="card">${raw(chart)}${b ? benchmarkNote(b) : ''}${t === 'public_goods' && c.rounds_punish ? html`<p class="small muted">Punishment starts in round ${c.rounds_no_punish + 1}.</p>` : ''}</section>
      <section class="card"><h2>Standings</h2>
        ${board.length ? html`<table class="board"><thead><tr><th>#</th><th>${s.team_mode === 'teams' ? 'Team' : 'Player'}</th><th>Total</th></tr></thead><tbody>
          ${board.slice(0, 50).map((r, i) => {
            const open = MARKETS.includes(t) && store.ui.ctlPeek === r.id;
            return html`<tr class="${open ? 'peek-open' : ''}" data-key="sb-${r.id}"><td>${i + 1}</td>
              <td>${MARKETS.includes(t) ? html`<button class="link peek" data-action="ctl-peek" data-id="${r.id}" aria-expanded="${open ? 'true' : 'false'}">${r.name}<span class="peek-caret" aria-hidden="true">${open ? '▾' : '▸'}</span></button>` : r.name}</td>
              <td>${MARKETS.includes(t) || t === 'commons' ? money(r.total, t === 'commons' ? 2 : 0) : num(r.total, 1)}</td></tr>
              ${open ? html`<tr class="peek-row" data-key="sbp-${r.id}"><td colspan="3">${firmHistory(st.results.filter((x) => x.team_id === r.id).map((x) => ({
                round_no: x.round_no, price: x.payload.participated ? x.payload.price : null, produced: x.payload.produced, sold: x.payload.sold,
                branding: x.payload.branding, profit: x.payload.profit })), t, st.public, r.name)}</td></tr>` : ''}`;
          })}</tbody></table>${MARKETS.includes(t) ? html`<p class="small muted">Click a name to see that firm's choices round by round.</p>` : ''}` : html`<p class="muted">After the first round.</p>`}
      </section>
    </div>
    ${['running', 'paused'].includes(s.status) ? currentDecisions(st, c, teamOf) : ''}
    ${t === 'commons' && c.chat !== 'off' ? chatMonitor(st, c) : ''}
    ${lastResults.length ? lastRoundTable(st, c, teamOf, lastResults, lastRound) : ''}`;
}

function benchmarkNote(b) {
  if (b.kind === 'commons' && b.variant === 'simple') return html`<p class="small muted">In a group of ${b.group_size}: everyone waits = ${money(b.all_wait_each)} each; everyone extracts = ${money(b.all_extract_each)} each; a lone extractor gets ${money(b.lone_extractor)}. ${b.note}</p>`;
  if (b.kind === 'commons') return html`<p class="small muted">Lake of ${b.capacity} (group of ${b.group_size}): the group can catch at most ${b.sustainable_group_catch} per season (${num(b.sustainable_per_person, 1)} each) and keep the lake full. If everyone takes the maximum, the group wants ${b.greedy_group_catch}. ${b.note}</p>`;
  if (b.kind === 'competitive') return html`<p class="small muted">Competitive equilibrium: price ${money(b.price, 2)}, ${num(b.quantity_per_firm)} units per firm, profit ${money(b.profit_per_firm)}.</p>`;
  if (b.kind === 'monopoly') return html`<p class="small muted">Profit-maximising monopoly: price ${money(b.price, 2)}, quantity ${num(b.quantity)}, profit ${money(b.profit)} (competitive price would be ${money(b.competitive_price, 2)}).</p>`;
  return html`<p class="small muted">With ${b.firms} firms: Nash price ${money(b.nash_price, 2)} (${num(b.nash_quantity)} units, profit ${money(b.nash_profit)}); joint-profit price ${money(b.joint_price, 2)} (profit ${money(b.joint_profit)}). ${b.note}</p>`;
}

function currentDecisions(st, c, teamOf) {
  const s = st.session;
  const dec = Object.fromEntries(st.decisions.map((d) => [d.team_id, d]));
  const req = st.required || [];
  const describe = (p) => {
    if (!p) return '';
    if (MARKETS.includes(s.game_type)) return p.participate === false ? 'sitting out' : [p.price !== undefined ? money(p.price, 2) : '', p.quantity !== undefined ? `× ${p.quantity}` : '', p.branding ? `brand ${money(p.branding)}` : ''].join(' ');
    if (p.move) return p.move === 'C' ? 'Cooperate' : 'Defect';
    if (p.ready) return 'ready';
    if (p.catch !== undefined) return `${p.catch} fish`;
    if (p.choice) return p.choice;
    if (p.contribution !== undefined) return `${p.contribution} tokens`;
    if (p.points) return Object.entries(p.points).map(([k, v]) => `${k}:${v}`).join(' ') || 'no points';
    if (p.offer !== undefined) return `offers $${p.offer}`;
    if (p.accept !== undefined) return p.accept ? 'accepts' : 'rejects';
    return JSON.stringify(p);
  };
  return html`<details class="card" open><summary>This ${s.stage === 'decide' || s.stage === 'move' ? 'round' : 'stage'}: ${s.stage === 'chat' ? 'who is ready' : 'who has submitted'}</summary>
    <ul class="sub-grid">${req.map((id) => html`<li class="${dec[id] ? 'in' : 'waiting'}" data-key="${id}"><span>${teamOf[id]?.name || '?'}</span>
      <span class="small">${dec[id] ? describe(dec[id].payload) : 'waiting'}</span></li>`)}</ul></details>`;
}

function lastRoundTable(st, c, teamOf, rows, roundNo) {
  const t = st.session.game_type;
  let head, row;
  if (MARKETS.includes(t)) {
    head = html`<tr><th>Firm</th><th>Price</th><th>Made</th><th>Sold</th>${t === 'monopolistic' ? html`<th>Brand</th>` : ''}<th>Profit</th><th>Total</th></tr>`;
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.participated ? money(p.price, 2) : html`<span class="muted">${p.auto ? 'missed' : 'out'}</span>`}</td><td>${num(p.produced)}</td><td>${num(p.sold)}</td>${t === 'monopolistic' ? html`<td>${num(p.brand_stock)}</td>` : ''}<td class="${p.profit < 0 ? 'neg' : ''}">${money(p.profit)}</td><td>${money(p.cumulative)}</td></tr>`; };
  } else if (t === 'pd_live') {
    head = html`<tr><th>Player</th><th>Move</th><th>Partner's</th><th>Points</th><th>Total</th></tr>`;
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.bye ? 'bye' : p.you}${p.auto ? '*' : ''}</td><td>${p.them || ''}</td><td>${p.points}</td><td>${p.cumulative}</td></tr>`; };
  } else if (t === 'commons' && c.variant === 'simple') {
    head = html`<tr><th>Player</th><th>Group</th><th>Choice</th><th>Extractors</th><th>Earned</th><th>Total</th></tr>`;
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.label}</td><td>${p.choice}${p.auto ? '*' : ''}</td><td>${p.extractors} of ${p.group_size}</td><td>${money(p.earnings, 2)}</td><td>${money(p.cumulative, 2)}</td></tr>`; };
  } else if (t === 'commons') {
    head = html`<tr><th>Player</th><th>Lake</th><th>Fish at start</th><th>Caught</th><th>Group caught</th><th>Next season</th><th>Total</th></tr>`;
    rows = rows.slice().sort((a, b) => (a.payload.lake - b.payload.lake) || a.payload.label.localeCompare(b.payload.label));
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.lake} (${p.label})</td><td>${p.stock_start}</td><td>${p.catch}${p.auto ? '*' : ''}${p.requested > p.catch ? html` <span class="small muted">asked ${p.requested}</span>` : ''}</td><td>${p.group_catch}</td><td class="${p.stock_next === 0 ? 'neg' : ''}">${p.stock_next}</td><td>${money(p.cumulative, 2)}</td></tr>`; };
  } else if (t === 'public_goods') {
    head = html`<tr><th>Player</th><th>Put in</th><th>Pot</th><th>Gave</th><th>Received</th><th>Earned</th></tr>`;
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.contribution}${p.auto ? '*' : ''}</td><td>${p.group_total}</td><td>${p.points_given}</td><td>${p.points_received}</td><td>${num(p.earnings, 1)}</td></tr>`; };
  } else {
    head = html`<tr><th>Player</th><th>Role</th><th>Offer</th><th>Outcome</th><th>Earned</th></tr>`;
    row = (r) => { const p = r.payload; return html`<tr><td>${teamOf[r.team_id]?.name}</td><td>${p.role}</td><td>${p.offer ?? '–'}</td><td>${p.bye ? '' : p.no_offer ? 'no offer' : p.accepted ? 'accepted' : 'rejected'}</td><td>${p.points}</td></tr>`; };
  }
  return html`<details class="card"><summary>Round ${roundNo} results</summary><div class="scroll"><table class="mini"><thead>${head}</thead><tbody>${rows.map(row)}</tbody></table></div>
    <p class="small muted">* no decision submitted in time.</p></details>`;
}

// ---------------------------------------------------------------------------
// Display settings (can change any time)

function displaySettings(st, c) {
  const s = st.session;
  const keys = ['leaderboard', 'show_prices', 'reveal_at_end', 'auto_advance'];
  const fields = SETTINGS[s.game_type].filter((f) => keys.includes(f.key));
  const rest = SETTINGS[s.game_type].filter((f) => !keys.includes(f.key) && (!f.showIf || f.showIf(c)));
  return html`<details class="card"><summary>Settings</summary>
    ${fields.length ? html`<form class="stack" data-action="save-display">
      ${fields.map((f) => f.type === 'bool'
        ? html`<label class="switch"><input type="checkbox" name="${f.key}" ${c[f.key] ? 'checked' : ''}> <span>${f.label}</span></label>`
        : html`<label>${f.label}<select name="${f.key}">${f.options.map(([v, l]) => html`<option value="${v}" ${c[f.key] === v ? 'selected' : ''}>${l}</option>`)}</select></label>`)}
      <button type="submit">Save display settings</button></form>` : ''}
    <dl class="settings-list">${rest.map((f) => html`<div><dt>${f.label}</dt><dd>${f.type === 'select' ? (f.options.find(([v]) => v === String(c[f.key]))?.[1] ?? c[f.key]) : f.type === 'bool' ? (c[f.key] ? 'Yes' : 'No') : c[f.key]}</dd></div>`)}</dl>
    <p class="small muted">${s.status === 'lobby' ? 'To change the other settings, delete this game and create a new one.' : 'Game settings are locked once the game starts.'}</p>
    <div class="danger-zone"><button class="danger" data-action="delete-game">Delete this game and its results</button></div>
  </details>`;
}
on('save-display', async (form) => {
  const s = store.ctrl.session;
  const patchCfg = {};
  for (const el of form.elements) if (el.name) patchCfg[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  await rpc('update_session', { p_session: s.id, p_title: s.title, p_config: { ...s.config, ...patchCfg } });
  toast('Saved'); load();
});

// ---------------------------------------------------------------------------
// Strategy tournament

function tournamentPanel(st, c) {
  const s = st.session;
  const teamOf = Object.fromEntries(st.teams.map((t) => [t.id, t]));
  const strat = Object.fromEntries(st.strategies.map((x) => [x.team_id, x]));
  const submitted = st.teams.filter((t) => strat[t.id]?.submitted);
  const ui = store.ui.tourn || {};
  if (s.status === 'lobby') return '';
  return html`
    ${s.status !== 'finished' ? html`<section class="card">
      <div class="row spread"><h2>Strategies: ${submitted.length} of ${st.teams.length} submitted</h2>
        <button class="primary big" data-action="run-tournament" ${ui.running || !submitted.length ? 'disabled' : ''}>${ui.running ? `Running… ${Math.round((ui.progress || 0) * 100)}%` : 'Run tournament'}</button></div>
      <p class="small muted">The tournament runs in this browser in a sandbox (about a second), then results are saved and shown to students. Only submitted strategies play.</p>
      ${ui.error ? html`<p class="error">${ui.error}</p>` : ''}
      <ul class="strat-list">${st.teams.map((t) => { const x = strat[t.id]; return html`<li data-key="${t.id}"><details><summary><strong>${t.name}</strong>${x?.name ? html` <span class="small">“${x.name}”</span>` : ''}
        <span class="chip ${x?.submitted ? 'st-running' : 'st-lobby'}">${x?.submitted ? (x.has_newer_draft ? 'submitted, editing a new draft' : 'submitted') : x?.code ? 'draft only' : 'nothing yet'}</span> <span class="small muted">${t.members.join(', ')}</span></summary>
        ${x ? html`${x.name ? html`<p><strong>“${x.name}”</strong></p>` : ''}<p><em>${x.description || '–'}</em></p>${x.explanation ? html`<div class="explain">${x.explanation.split('\n').filter(Boolean).map((l) => html`<p>${l}</p>`)}</div>` : ''}
        <pre class="mono">${x.code}</pre>` : ''}</details></li>`; })}</ul>
      <div class="row"><button class="danger" data-action="ctl" data-op="finish">Close without a tournament</button></div>
    </section>` : html`<section class="card"><div class="row spread"><h2>Tournament results</h2>
        <div class="row"><button data-action="reopen-tournament">Reopen submissions</button>
        <button data-action="export" data-kind="summary">Download grades</button></div></div>
      ${tournamentResults({ outputs: st.outputs }, { instructor: true })}</section>`}`;
}

on('run-tournament', async () => {
  const st = store.ctrl;
  const c = normalizeConfig(st.session.game_type, st.session.config);
  const entrants = st.strategies.filter((x) => x.submitted && st.teams.some((t) => t.id === x.team_id))
    .map((x) => { const team = st.teams.find((t) => t.id === x.team_id).name; return { id: x.team_id, team_id: x.team_id, name: x.name || team, team, code: x.code }; });
  if (c.include_house) HOUSE.filter((h) => h.id !== 'house:random').forEach((h, i) => entrants.push({ id: h.id, name: computerName(i), house_name: h.name, code: h.code }));
  if (entrants.length < 2) throw new Error('At least two strategies are needed.');
  setUi('tourn', { running: true, progress: 0, error: null });
  try {
    const results = await runTournament(entrants, c, (p) => setUi('tourn', { progress: p }));
    await rpc('instructor_save_tournament', { p_session: st.session.id, p_results: results });
    toast('Tournament complete. Students can see the results now.');
    setUi('tourn', { running: false });
    await load();
  } catch (e) {
    setUi('tourn', { running: false, error: e.message });
  }
});
on('reopen-tournament', async (el) => {
  if (!confirmed(el, 'Reopen submissions? Students can change their strategies and you can run the tournament again.')) return;
  await rpc('instructor_reopen_tournament', { p_session: current });
  load();
});

// ---------------------------------------------------------------------------
// Exports

on('export', async (el) => {
  const ex = await rpc('export_session', { p_session: current });
  const base = `${ex.session.class_name} - ${ex.session.title}`;
  const final = ex.final?.leaderboard || [];
  const rankOf = Object.fromEntries(final.map((r) => [r.name, r.rank]));
  if (el.dataset.kind === 'summary') {
    const rows = ex.students.map((s) => ({
      student_name: s.student_name, student_id: s.student_id, email: s.email, team: s.team,
      total_earnings: Math.round(Number(s.total) * 100) / 100, rounds: s.rounds,
      average_per_round: s.rounds ? Math.round((Number(s.total) / s.rounds) * 100) / 100 : '',
      rank: rankOf[s.team] ?? '', passed_check: s.passed_check ? 'yes' : 'no',
    }));
    downloadCsv(`${base} - grades.csv`, rows);
  } else {
    const rows = ex.rows.map((r) => ({ student_name: r.student_name, student_id: r.student_id, email: r.email, team: r.team, round: r.round, earnings: r.earnings, submitted_by: r.decision_by, ...flatten(r.payload) }));
    downloadCsv(`${base} - all rounds.csv`, rows);
  }
});

// ---------------------------------------------------------------------------
// Projector

function projector(st, c) {
  const s = st.session;
  const t = s.game_type;
  const total = roundsTotal(t, c);
  const teamOf = Object.fromEntries(st.teams.map((x) => [x.id, x]));
  const totals = {};
  for (const r of st.results) totals[r.team_id] = (totals[r.team_id] || 0) + Number(r.earnings);
  const board = Object.entries(totals).map(([id, v]) => ({ name: teamOf[id]?.name || '?', v })).sort((a, b) => b.v - a.v).slice(0, 10);
  const showBoard = c.leaderboard === 'live' || (s.status === 'finished' && c.leaderboard !== 'never');
  const pubs = st.public;
  let chart = '';
  if (MARKETS.includes(t) && pubs.length) chart = lineChart({ title: 'Market price', xInteger: true, height: 260, series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p[t === 'monopoly' ? 'average_price' : 'market_price']]) }] });
  if (t === 'pd_live' && pubs.length) chart = lineChart({ title: 'Cooperation rate (%)', xInteger: true, height: 260, yMax: 100, series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, (p.cooperation_rate ?? 0) * 100]) }] });
  if (t === 'public_goods' && pubs.length) chart = lineChart({ title: 'Average contribution', xInteger: true, height: 260, series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_contribution]) }] });
  if (t === 'commons' && pubs.length) chart = commonsChart(st, c, 260);
  if (t === 'costs' && pubs.length) chart = costsProjector(st, c);
  if (t === 'ultimatum' && pubs.length) chart = lineChart({ title: 'Average offer ($)', xInteger: true, height: 260, series: [{ color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_offer]) }] });
  const prog = st.required?.length ? st.decisions.filter((d) => st.required.includes(d.team_id)).length : 0;
  return html`<main class="projector gt-${t}">
    <a class="proj-exit" href="#/teach/game/${s.id}">Exit projector view</a>
    <h1>${s.title}</h1>
    ${s.status === 'lobby' ? html`<div class="proj-join"><p>Go to</p><p class="proj-url">${siteUrl().replace(/^https?:\/\//, '')}</p>
      <p>Sign in, join class <strong class="proj-code">${s.join_code}</strong>, then open <strong>${s.title}</strong>.</p>
      <p class="proj-count">${plural(st.players.length, 'player')} in</p></div>` : ''}
    ${['running', 'paused'].includes(s.status) && t !== 'pd_tournament' ? html`<div class="proj-live">
      ${t === 'costs' ? '' : html`<div class="proj-round">Round <strong>${s.round_no}</strong>${total ? ` of ${total}` : ''}</div>`}
      ${st.round_info?.market_price != null ? html`<p class="proj-price">Market price this round: <strong>${money(st.round_info.market_price, 2)}</strong></p>` : ''}
      ${timerBar(s)}<p class="proj-count">${prog} of ${st.required.length} ${t === 'costs' ? 'have saved work' : 'submitted'}</p></div>` : ''}
    <div class="proj-grid">${chart ? html`<div class="card">${raw(chart)}</div>` : ''}
      ${showBoard && board.length ? html`<div class="card"><h2>Leaderboard</h2><ol class="proj-board">${board.map((r) => html`<li><span>${r.name}</span><strong>${MARKETS.includes(t) || t === 'commons' ? money(r.v) : t === 'costs' ? `${num(r.v, 1)}%` : num(r.v, 1)}</strong></li>`)}</ol></div>` : ''}
      ${t === 'pd_tournament' && s.status === 'finished' ? html`<div class="card wide">${tournamentResults({ outputs: st.outputs }, { instructor: true })}</div>` : ''}
    </div>
  </main>`;
}

// ---------------------------------------------------------------------------
// Tragedy of the commons

/** "Fishing game 1 of 2, season 3" for the open stage, worked out from the last resolved season. */
function commonsWhere(st, c) {
  if (c.variant === 'simple') return `Round ${st.session.round_no} of ${c.rounds}${st.session.stage === 'chat' ? ': groups are chatting' : ''}`;
  const last = st.public[st.public.length - 1];
  const match = !last ? 1 : last.match_over ? last.match + 1 : last.match;
  const season = !last || last.match_over ? 1 : last.season + 1;
  return `Fishing game ${match} of ${c.matches}, season ${season}${st.session.stage === 'chat' ? ': groups are chatting' : ''}. Each fishing game ends after a hidden ${c.min_seasons}–${c.max_seasons} seasons.`;
}

function commonsChart(st, c, height = 220) {
  const pubs = st.public;
  if (c.variant === 'simple') {
    return lineChart({ title: 'Share extracting', xInteger: true, xLabel: 'Round', yLabel: '%', yMax: 100, height,
      series: [{ name: 'Extracting', color: 'supply', dots: true, points: pubs.map((p) => [p.round_no, p.extract_rate === null ? null : p.extract_rate * 100]) },
        { name: 'Groups where all waited', color: 'demand', dashed: true, dots: true, points: pubs.map((p) => [p.round_no, p.groups ? (100 * p.groups_all_waited) / p.groups : null]) }] });
  }
  const nLakes = Math.max(0, ...pubs.map((p) => p.lakes?.length || 0));
  const lakeLines = Array.from({ length: Math.min(nLakes, 20) }, (_, i) => ({ color: 'muted',
    points: pubs.map((p) => { const l = p.lakes[i]; return [p.round_no, l ? (100 * l.next) / l.capacity : null]; }) }));
  return lineChart({ title: 'Fish left after regrowth (% of a full lake)', xInteger: true, xLabel: 'Round', yLabel: '% full', yMax: 100, height,
    series: [...lakeLines, { name: 'Average lake', color: 'demand', dots: true, points: pubs.map((p) => [p.round_no, p.average_level * 100]) }] });
}

function groupName(key, c) {
  const m = /g(\d+)$/.exec(key || '');
  return m ? `${c.variant === 'simple' ? 'Group' : 'Lake'} ${Number(m[1]) + 1}` : key;
}

function chatMonitor(st, c) {
  const items = (store.ui.ichat?.session === st.session.id ? store.ui.ichat.items : []).slice(-150).reverse();
  const who = c.variant === 'simple' ? 'Player' : 'Fisher';
  return html`<details class="card ichat" ${st.session.stage === 'chat' ? 'open' : ''}><summary>Group chat (${plural(store.ui.ichat?.items?.length || 0, 'message')})</summary>
    <p class="small muted">Students see each other only as ${who} A, B, C. You see names. Newest first; updates every few seconds.</p>
    ${items.length ? html`<ol class="ichat-list">${items.map((m) => html`<li data-key="${m.id}"><span class="small muted">Round ${m.round_no} · ${groupName(m.group_key, c)} · ${who} ${m.label} (${m.name || '?'})</span><span>${m.body}</span></li>`)}</ol>`
      : html`<p class="muted">No messages yet.</p>`}
  </details>`;
}

on('export-chat', async () => {
  const st = store.ctrl;
  const c = normalizeConfig(st.session.game_type, st.session.config);
  const rows = await rpc('instructor_messages', { p_session: current, p_after: 0 });
  downloadCsv(`${st.session.class_name} - ${st.session.title} - chat.csv`, rows.map((m) => ({
    round: m.round_no, group: groupName(m.group_key, c), label: m.label, student_name: m.name, student_id: m.student_id, email: m.email,
    message: m.body, time: new Date(m.at).toLocaleString(),
  })));
});

// This round's market price in perfect competition, with the best response for the instructor.
function roundPriceNote(P, c) {
  const b = benchmarks('competitive', { ...c, market_rule: 'fixed', market_price: P }, 1);
  return html`<p class="big-line">Market price this round: <strong>${money(P, 2)}</strong>
    <span class="small muted"> Best response: make ${num(b.quantity_per_firm)} (marginal cost = price), profit ${money(b.profit_per_firm)}.</span></p>`;
}
