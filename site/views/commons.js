// Tragedy of the commons: student screens (fishery and simple versions) and the anonymous group chat.
import { html, raw, store, setUi, on, money, num, pct, rerender } from '../lib/dom.js';
import { rpc } from '../lib/api.js';
import { lineChart } from '../lib/chart.js';
import { demoChatSend } from '../lib/demo.js';
import { submit } from './play.js';
import { canSubmit, submittedNote } from './panels.js';

const whoWord = (a) => (a?.variant === 'simple' ? 'Player' : 'Fisher');
const lastRes = (g) => g.results[g.results.length - 1];
const lastPub = (g) => g.public[g.public.length - 1];

export function commonsStageLabel(s, g) {
  const a = g.assignment || {};
  if (a.variant === 'simple') return s.stage === 'chat' ? 'Talk with your group' : 'Extract or wait?';
  if (!a.season) return 'Fishing';
  if (a.stock === 0) return `Season ${a.season}: your lake is empty`;
  return s.stage === 'chat' ? `Season ${a.season}: talk with your group` : `Season ${a.season}: how many fish will you catch?`;
}

// ---------------------------------------------------------------------------
// The lake (one fish per unit of capacity) and the pool

function lakeSvg(stock, cap) {
  const cols = 10, cw = 26, ch = 17, rows = Math.ceil(cap / cols);
  const W = cols * cw + 10, H = rows * ch + 10;
  let fish = '';
  for (let i = 0; i < cap; i++) {
    const x = 6 + (i % cols) * cw, y = 6 + Math.floor(i / cols) * ch;
    fish += `<g class="${i < stock ? 'fish' : 'fish gone'}" transform="translate(${x} ${y})"><ellipse cx="9" cy="6" rx="8" ry="4.6"/><path d="M16 6 L22.5 1.5 L22.5 10.5 Z"/></g>`;
  }
  return raw(`<svg class="lake-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${stock} of ${cap} fish"><rect class="water" x="0" y="0" width="${W}" height="${H}" rx="12"/>${fish}</svg>`);
}

function lakeBlock(a) {
  return html`<div class="lake">
    <div class="lake-head"><span><strong class="big-num">${a.stock}</strong> of ${a.capacity} fish in ${a.matching === 'strangers' ? `lake ${a.lake}` : 'your lake'}</span>
      <span class="small muted">${a.matches > 1 ? `Fishing game ${a.match} of ${a.matches} · ` : ''}You are Fisher ${a.label}</span></div>
    ${lakeSvg(a.stock, a.capacity)}
  </div>`;
}

function poolBlock(a) {
  const each = a.pool * a.multiplier / a.group_size;
  return html`<div class="pool">
    <p class="pool-amt"><span class="small muted">Your group's pool</span><strong class="big-num">${money(a.pool)}</strong></p>
    <ul class="small">
      <li>All ${a.group_size} wait: the pool grows to <strong>${money(a.pool * a.multiplier)}</strong>, so <strong>${money(each, Number.isInteger(each) ? 0 : 2)}</strong> each.</li>
      <li>Anyone extracts: the extractors split <strong>${money(a.pool)}</strong>; those who waited get <strong>$0</strong>.</li>
    </ul>
    <p class="small muted">Round ${a.round_no} of ${a.rounds} · You are Player ${a.label}</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Decision panel

export function commonsPanel(g, c) {
  const s = g.session;
  const a = g.assignment || {};
  const top = a.variant === 'simple' ? poolBlock(a) : lakeBlock(a);
  if (s.stage === 'chat') {
    const ready = !!g.me.decision?.ready;
    return html`${top}
      ${chatPanel(g, true)}
      ${!g.me.required ? html`<p class="muted">Your lake is empty, so you have nothing to catch this season. You can still chat.</p>`
        : ready ? html`<p class="saved">You're ready. Deciding starts when everyone is ready or time runs out. You can keep chatting.</p>`
        : html`<div class="row"><button class="primary" data-action="commons-ready">I'm ready to decide</button></div>`}`;
  }
  if (a.variant === 'simple') return html`${top}${simpleForm(g, c)}${chatPanel(g, false)}`;
  return html`${top}${fisheryForm(g, c)}${chatPanel(g, false)}`;
}
on('commons-ready', async () => submit({ ready: true }, 'Ready. Waiting for the others.'));

function fisheryForm(g, c) {
  const a = g.assignment;
  if (a.stock === 0) return html`<p>Your lake is empty, so there is nothing left to catch in this fishing game. Wait for the season to end.</p>`;
  const prev = lastRes(g);
  const cur = store.ui.pg?.catch ?? g.me.decision?.catch ?? (prev && !prev.empty_lake && prev.match === a.match ? prev.requested : Math.round(a.max_catch / 2));
  const n = a.group_size;
  const all = cur * n;
  const left = Math.max(0, a.stock - all);
  const next = Math.min(a.capacity, Math.floor(left * c.growth + 1e-9));
  const enabled = canSubmit(g);
  return html`
    <form data-action="submit-catch" class="pg-form">
      <fieldset ${enabled ? '' : 'disabled'}>
        <label class="slider-label">Catch <strong class="big-num">${cur}</strong> fish
          <input type="range" name="catch" min="0" max="${a.max_catch}" step="1" value="${cur}" data-input="catch-slide"></label>
        <p>You earn <strong>${money(cur * a.fish_price, Number.isInteger(cur * a.fish_price) ? 0 : 2)}</strong> this season${cur > a.stock ? ' (if there are enough fish)' : ''}.</p>
        <p class="whatif small">If everyone in your group catches ${cur}: ${all >= a.stock
          ? html`you would want ${all} fish but the lake has ${a.stock}, so <strong class="neg">the lake would be emptied</strong>.`
          : html`${all} caught, ${left} left, so <strong>${next}</strong> fish next season.`}</p>
        <button class="primary big" type="submit">${g.me.decision?.catch !== undefined ? 'Update' : 'Submit'}</button>
      </fieldset>
    </form>${g.me.decision?.catch !== undefined ? submittedNote(g) : ''}`;
}
on('catch-slide', (el) => setUi('pg', { catch: Number(el.value) }));
on('submit-catch', async (form) => submit({ catch: Number(form.catch.value) }));

function simpleForm(g) {
  const mine = g.me.decision?.choice;
  const enabled = canSubmit(g);
  return html`<div class="pd-buttons">
      <button class="pd c ${mine === 'wait' ? 'chosen' : ''}" data-action="commons-choice" data-choice="wait" ${enabled ? '' : 'disabled'}>Wait</button>
      <button class="pd d ${mine === 'extract' ? 'chosen' : ''}" data-action="commons-choice" data-choice="extract" ${enabled ? '' : 'disabled'}>Extract</button>
    </div>${mine ? submittedNote(g) : ''}`;
}
on('commons-choice', async (el) => submit({ choice: el.dataset.choice }));

// ---------------------------------------------------------------------------
// Anonymous group chat

const chatItems = (g) => (g.demo ? (g.chat?.items || [])
  : (store.ui.chat && store.ui.chat.session === g.session.id && store.ui.chat.key === g.assignment?.group_key ? store.ui.chat.items : []));

function chatPanel(g, open) {
  const a = g.assignment || {};
  if (!a.chat) return '';
  const items = chatItems(g);
  if (!open && !items.length) return '';
  const offset = a.variant === 'simple' ? 0 : (a.round_no - a.season);
  const unit = a.variant === 'simple' ? 'Round' : 'Season';
  let prevRound = null;
  const rows = [];
  for (const m of items) {
    if (m.round_no !== prevRound && (prevRound !== null || m.round_no !== a.round_no)) {
      rows.push(html`<li class="chat-div" data-key="d${m.round_no}">${unit} ${m.round_no - offset}</li>`);
    }
    prevRound = m.round_no;
    rows.push(html`<li class="msg ${m.mine ? 'mine' : ''}" data-key="m${m.id}"><span class="who">${m.mine ? 'You' : `${whoWord(a)} ${m.label}`}</span><span class="body">${m.body}</span></li>`);
  }
  return html`<section class="chat ${open ? '' : 'closed'}" aria-label="Group chat">
    <div class="chat-head"><h3>Group chat</h3><span class="small muted">${(a.members || []).map((l) => (l === a.label ? `${l} (you)` : l)).join(' · ')}</span></div>
    <ol class="chat-log" aria-live="polite">${rows.length ? rows : html`<li class="chat-empty muted" data-key="empty">${open ? 'No messages yet. Say hello, or suggest a plan.' : ''}</li>`}</ol>
    ${open ? html`<form class="chat-form" data-action="chat-send">
        <input name="body" maxlength="200" autocomplete="off" placeholder="Message your group" aria-label="Message your group">
        <button type="submit">Send</button></form>
      <p class="small muted">Classmates see you only as ${whoWord(a)} ${a.label}. Your instructor can see who wrote each message.</p>`
      : html`<p class="small muted">The chat is closed for now. This is what your group said.</p>`}
  </section>`;
}

on('chat-send', async (form, d) => {
  const body = String(d.body || '').trim();
  if (!body) return;
  const input = form.querySelector('input[name="body"]');
  if (store.game?.demo) { demoChatSend(body); input.value = ''; scrollChat(); return; }
  await rpc('send_message', { p_session: store.game.session.id, p_body: body });
  input.value = ''; input.dataset.dirty = '';
  await refreshChat();
});

let chatTimer = null, chatBusy = false, seenKey = '';
export function startChatPolling() {
  stopChatPolling();
  chatTimer = setInterval(() => {
    const g = store.game;
    if (g?.session?.game_type === 'commons' && g.session.stage === 'chat' && document.visibilityState === 'visible') refreshChat();
  }, 2500);
}
export function stopChatPolling() { clearInterval(chatTimer); chatTimer = null; seenKey = ''; store.ui.chat = null; }

/** Called after every state load: fetch the chat when the group or stage changes. */
export function commonsLoaded(g) {
  if (g.demo || g.session?.game_type !== 'commons' || !g.joined || !g.assignment?.chat) return;
  const key = `${g.session.id}|${g.assignment.group_key}|${g.session.round_no}|${g.session.stage}`;
  if (key !== seenKey) { seenKey = key; refreshChat(); }
}

export async function refreshChat() {
  const g = store.game;
  if (!g || g.demo || g.session?.game_type !== 'commons' || !g.joined || !g.assignment?.chat || chatBusy) return;
  chatBusy = true;
  try {
    const cur = store.ui.chat;
    const same = cur && cur.session === g.session.id && cur.key === g.assignment.group_key;
    const r = await rpc('get_messages', { p_session: g.session.id, p_after: same ? cur.last : 0 });
    const keep = same && r.group_key === cur.key;
    if (keep && !r.messages.length) return;
    const items = [...(keep ? cur.items : []), ...r.messages];
    store.ui.chat = { session: g.session.id, key: r.group_key, items, last: items.length ? items[items.length - 1].id : 0 };
    rerender();
    scrollChat();
  } catch (e) { /* the next poll tries again */ } finally { chatBusy = false; }
}

export function scrollChat() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector('.chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  }));
}

// ---------------------------------------------------------------------------
// Results, charts and history

export function commonsLastResult(g) {
  const r = lastRes(g);
  if (!r) return '';
  const pub = lastPub(g);
  let body;
  if (r.variant === 'simple') {
    const others = r.others.map((o) => `Player ${o.label} ${o.choice === 'extract' ? 'extracted' : 'waited'}`).join(', ');
    body = html`<p>You <strong>${r.choice === 'extract' ? 'extracted' : 'waited'}</strong>${r.auto ? ' (no choice made in time)' : ''}. ${others}.</p>
      <p>${r.extractors === 0 ? `Everyone waited, so the pool grew to ${money(r.grown)} and was split ${r.group_size} ways.`
        : `${r.extractors === 1 ? 'One person' : `${r.extractors} people`} extracted and split the ${money(r.pool)} pool${r.choice === 'wait' ? '; waiting got you nothing' : ''}.`}
      You earned <strong>${money(r.earnings, Number.isInteger(r.earnings) ? 0 : 2)}</strong>.</p>`;
  } else if (r.empty_lake) {
    body = html`<p>The lake was empty, so nobody could catch anything.</p>`;
  } else {
    const others = r.others.map((o) => `Fisher ${o.label} ${o.catch}`).join(', ');
    body = html`<p>You caught <strong>${r.catch}</strong> fish${r.requested > r.catch ? ` (you asked for ${r.requested}, but the lake ran short)` : ''}${r.auto ? ' (no choice made, so your last catch was repeated)' : ''} and earned <strong>${money(r.earnings, Number.isInteger(r.earnings) ? 0 : 2)}</strong>.</p>
      <p>Your group caught ${r.group_catch} of ${r.stock_start} fish (${others}). ${r.stock_left} were left, so the lake ${r.stock_next === 0 ? html`<strong class="neg">is empty for good</strong>` : html`has <strong>${r.stock_next}</strong> fish next season`}.</p>`;
  }
  if (r.variant !== 'simple' && pub?.match_over && pub.round_no === r.round_no) {
    body = html`${body}<p class="note">That fishing game ${pub.all_empty ? `ended after ${pub.seasons_played} ${pub.seasons_played === 1 ? 'season' : 'seasons'} because every lake was empty` : `lasted ${pub.seasons_played} seasons`}.
      ${g.session.status === 'finished' ? '' : 'The lakes are restocked and you are in a new group.'}</p>`;
  }
  return html`<section class="card result-card"><h2>${r.variant === 'simple' ? `Round ${r.round_no}` : `Season ${r.season}`} result</h2>${body}
    <p class="total">Your total: <strong>${money(r.cumulative, Number.isInteger(r.cumulative) ? 0 : 2)}</strong></p></section>`;
}

export function commonsPublic(g, c, leaderboardTable) {
  const pubs = g.public;
  if (!pubs.length) return '';
  const last = pubs[pubs.length - 1];
  let chart, line;
  if (last.variant === 'simple') {
    chart = lineChart({ title: 'Share of players extracting', xInteger: true, xLabel: 'Round', yLabel: '%', yMax: 100,
      series: [{ color: 'supply', dots: true, points: pubs.map((p) => [p.round_no, p.extract_rate === null ? null : p.extract_rate * 100]) }] });
    line = `Last round: ${last.groups_all_waited} of ${last.groups} groups all waited.`;
  } else {
    const match = last.match;
    const mine = g.results.filter((r) => r.match === match);
    const yours = mine.map((r) => [r.season, (100 * r.stock_start) / r.capacity]);
    if (mine.length) { const z = mine[mine.length - 1]; yours.push([z.season + 1, (100 * z.stock_next) / z.capacity]); }
    const cls = [[1, 100], ...pubs.filter((p) => p.match === match).map((p) => [p.season + 1, p.average_level * 100])];
    chart = lineChart({ title: `How full the lakes are${c.matches > 1 ? ` (fishing game ${match})` : ''}`, xInteger: true, xLabel: 'Season', yLabel: '% full', yMax: 100,
      series: [
        { name: 'All lakes (average)', color: 'demand', dots: true, points: cls },
        { name: c.matching === 'strangers' ? 'Lakes you fished' : 'Your lake', color: 'supply', dashed: true, dots: true, points: yours },
      ] });
    line = `Last season: ${last.lakes_empty} of ${last.lakes.length} lakes empty${last.average_catch !== null ? `; the average fisher caught ${num(last.average_catch, 1)}` : ''}.`;
  }
  return html`<section class="card public">${raw(chart)}<p class="small">${line}</p>
    ${last.leaderboard ? html`<h3>Leaderboard</h3>${leaderboardTable(last.leaderboard, g.team?.name, true)}` : ''}</section>`;
}

export function commonsHistory(g, c) {
  if (!g.results.length) return '';
  const rows = g.results.slice().reverse();
  const simple = rows[0].variant === 'simple';
  const head = simple
    ? html`<tr><th>Round</th><th>You</th><th>Extracted</th><th>Earned</th></tr>`
    : html`<tr>${c.matches > 1 ? html`<th>Game</th>` : ''}<th>Season</th><th>Lake</th><th>You</th><th>Group</th><th>Next</th><th>Earned</th></tr>`;
  const row = simple
    ? (r) => html`<tr><td>${r.round_no}</td><td>${r.choice}${r.auto ? '*' : ''}</td><td>${r.extractors} of ${r.group_size}</td><td>${money(r.earnings, 2)}</td></tr>`
    : (r) => html`<tr>${c.matches > 1 ? html`<td>${r.match}</td>` : ''}<td>${r.season}</td><td>${r.stock_start}</td><td>${r.catch}${r.auto ? '*' : ''}</td><td>${r.group_catch}</td><td>${r.stock_next}</td><td>${money(r.earnings, 2)}</td></tr>`;
  return html`<details class="card history" ${g.results.length <= 6 ? 'open' : ''}><summary>Your ${simple ? 'rounds' : 'seasons'}</summary>
    <table class="mini"><thead>${head}</thead><tbody>${rows.map(row)}</tbody></table>
    ${rows.some((r) => r.auto) ? html`<p class="small muted">* no choice made in time.</p>` : ''}</details>`;
}
