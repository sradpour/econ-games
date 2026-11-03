import { html, store, setState, setUi, on, toast, rerender, plural } from '../lib/dom.js';
import { rpc, watchSession } from '../lib/api.js';
import { GAME_LABELS, GAME_INFO, quizFor, normalizeConfig } from '../lib/games.js';
import { syncClock } from '../app.js';
import { statusChip } from './student.js';
import { decisionPanel, lastResult, historyBlock, publicBlock, finalBlock, stageLabel, roundsTotal } from './panels.js';
import { renderLab } from './lab.js';
import { demoSubmit, demoPass } from '../lib/demo.js';
import { startChatPolling, stopChatPolling, commonsLoaded } from './commons.js';
import { scene } from './scenes.js';

let stopWatch = null;
let currentId = null;
let loading = false, again = false;

export function enterPlay(id) {
  currentId = id;
  setState({ game: null });
  store.ui.quiz = null; store.ui.preview = null; store.ui.pg = null; store.ui.peek = null;
  load();
  stopWatch = watchSession(id, load);
  startChatPolling();
}
export function leavePlay() { stopWatch?.(); stopWatch = null; currentId = null; stopChatPolling(); }

async function load() {
  if (!currentId) return;
  if (loading) { again = true; return; }
  loading = true;
  try {
    const id = currentId;
    const g = await rpc('get_state', { p_session: id });
    if (id !== currentId) return;
    if (g.joined && g.session?.game_type === 'pd_tournament' && g.session.status === 'running') {
      g.tprogress = await rpc('tournament_progress', { p_session: id }).catch(() => null);
    }
    syncClock(g.server_now);
    const prev = store.game;
    const stageKey = g.session ? `${g.session.round_no}:${g.session.stage}:${g.session.status}` : '';
    if (prev && prev._stageKey !== stageKey) { store.ui.preview = null; store.ui.pg = null; }
    g._stageKey = stageKey;
    setState({ game: g });
    commonsLoaded(g);
  } catch (e) {
    setState({ game: { error: e.message } });
  } finally {
    loading = false;
    if (again) { again = false; load(); }
  }
}
export const reloadGame = load;

// ---------------------------------------------------------------------------

export function renderPlay() {
  const g = store.game;
  if (!g) return html`<main class="page"><p class="muted">Loading game…</p></main>`;
  if (g.error) return html`<main class="page narrow"><h1>Can't open this game</h1><p>${g.error}</p><p><a href="#/">Back to your classes</a></p></main>`;
  const s = g.session;
  const cfg = normalizeConfig(s.game_type, s.config);
  return html`<main class="page play gt-${s.game_type}">
    ${g.demo ? html`<a class="back" href="#/demo">← All demos</a>
      <div class="demo-banner"><span>Demo: you're playing against computer players. There's no timer and nothing is saved.</span>
        <button class="link" data-action="demo-restart">Start over</button></div>
      ${s.game_type === 'commons' ? html`<div class="presets demo-variant"><span class="small muted">Version:</span>
        <button class="${cfg.variant !== 'simple' ? 'chosen' : ''}" data-action="demo-variant" data-variant="fishery">Fishery: choose how many fish to catch</button>
        <button class="${cfg.variant === 'simple' ? 'chosen' : ''}" data-action="demo-variant" data-variant="simple">Simple: extract or wait</button>
        <p class="small muted">Switching starts the demo over.</p></div>` : ''}` : html`<a class="back" href="#/">← ${s.class_name}</a>`}
    ${!g.joined ? intro(g, cfg)
      : s.status === 'finished' ? finished(g, cfg)
      : !g.me.passed_check ? quiz(g, cfg)
      : s.status === 'lobby' ? lobby(g, cfg)
      : s.team_mode === 'teams' && !g.me.team_id ? lateTeams(g)
      : live(g, cfg)}
  </main>`;
}

function rulesList(s, cfg) {
  return html`<ul class="rules">${GAME_INFO[s.game_type].rules(cfg).map((r) => html`<li>${r}</li>`)}</ul>`;
}

function intro(g, cfg) {
  const s = g.session;
  const canJoin = s.status === 'lobby' || (s.status !== 'finished' && s.team_mode === 'teams');
  return html`<section class="intro">
    ${scene(s.game_type, cfg)}
    ${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}
    <h1>${s.title}</h1>
    ${statusChip(s.status)}
    <p class="lede">${GAME_INFO[s.game_type].short}</p>
    ${rulesList(s, cfg)}
    ${canJoin ? html`<button class="primary big" data-action="join-session">Join this game</button>`
      : s.status === 'finished' ? html`<p class="muted">This game has finished.</p>`
      : html`<p class="muted">This game has already started. Wait for the next one.</p>`}
  </section>`;
}
on('join-session', async () => { await rpc('join_session', { p_session: currentId }); await load(); });

// ---------------------------------------------------------------------------
// Comprehension check

function quiz(g, cfg) {
  const s = g.session;
  if (!store.ui.quiz || store.ui.quiz.session !== s.id) store.ui.quiz = { session: s.id, items: quizFor(s.game_type, cfg), answers: {}, marks: {} };
  const qz = store.ui.quiz;
  return html`<section class="quiz">
    <p class="kicker">${s.title === GAME_LABELS[s.game_type] ? s.title : `${GAME_LABELS[s.game_type]}: ${s.title}`}</p>
    <h1>How this game works</h1>
    ${rulesList(s, cfg)}
    <h2>Quick check</h2>
    <p class="muted">Answer these to unlock the game.</p>
    <form data-action="check-quiz" class="stack">
      ${qz.items.map((item, i) => {
        const chosen = qz.answers[i];
        const mark = qz.marks[i];
        const wrong = mark === 'wrong';
        return html`<fieldset class="q ${mark || ''}">
          <legend>${item.q}</legend>
          ${item.options.map((o) => html`<label class="opt"><input type="radio" name="q${i}" value="${o}" ${chosen === o ? 'checked' : ''} data-change="quiz-pick" data-i="${i}" required> <span>${o}</span></label>`)}
          ${wrong ? html`<p class="feedback">Not quite. Re-read the rules above and try again.</p>` : ''}
        </fieldset>`;
      })}
      <button class="primary" type="submit">Check answers</button>
      ${g.demo ? html`<button type="button" class="link" data-action="demo-skip-check">Skip the check (demo only)</button>` : ''}
    </form>
  </section>`;
}
on('quiz-pick', (el) => {
  const qz = store.ui.quiz;
  qz.answers[el.dataset.i] = el.value;
  delete qz.marks[el.dataset.i];
  el.closest('fieldset')?.classList.remove('wrong', 'right');
});
on('check-quiz', async () => {
  const qz = store.ui.quiz;
  qz.items.forEach((item, i) => { qz.marks[i] = qz.answers[i] === item.answer ? 'right' : 'wrong'; });
  const ok = qz.items.every((item, i) => qz.answers[i] === item.answer);
  if (ok && store.game?.demo) { demoPass(); toast('All correct. You are in.'); return; }
  if (ok) { await rpc('pass_check', { p_session: currentId }); toast('All correct. You are in.'); await load(); }
  else rerender();
});

// ---------------------------------------------------------------------------
// Lobby & teams

function lobby(g, cfg) {
  const s = g.session;
  if (s.team_mode !== 'teams') {
    return html`<section class="waiting">
      ${scene(s.game_type, cfg)}
      ${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}
      <h1>${s.title}</h1>
      <div class="pulse" aria-hidden="true"></div>
      <p class="lede">You're in. The game starts when your instructor is ready.</p>
      <p class="muted">${plural(s.player_count, 'player')} joined so far.</p>
      ${s.game_type === 'pd_tournament' ? '' : rulesList(s, cfg)}
    </section>`;
  }
  return html`<section class="teams">
    ${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}
    <h1>${s.title}</h1>
    <p class="lede">Form a team of up to ${s.team_cap}. Anyone without a team when the game starts is placed in one automatically.</p>
    ${teamPicker(g, true)}
  </section>`;
}

function teamPicker(g, canCreate) {
  const s = g.session;
  const mine = g.team;
  const ui = store.ui.teamEdit || {};
  return html`
    ${mine ? html`<div class="myteam card">
      ${ui.editing && canCreate ? html`<form class="inline" data-action="rename-team">
          <input name="name" value="${mine.name}" maxlength="40" required aria-label="Team name"><button class="primary" type="submit">Save</button>
          <button type="button" data-action="cancel-rename">Cancel</button></form>`
        : html`<div class="myteam-head"><h2>${mine.name}</h2>${canCreate ? html`<button class="link" data-action="start-rename">Rename</button>` : ''}</div>`}
      <ul class="members">${mine.members.map((m) => html`<li>${m.name}${m.is_me ? ' (you)' : ''}</li>`)}</ul>
      ${canCreate ? html`<button data-action="leave-team">Leave team</button>` : ''}
    </div>` : ''}
    ${canCreate ? html`<form class="createteam inline" data-action="create-team">
      <label class="sr" for="tn">New team name</label>
      <input id="tn" name="name" placeholder="New team name" maxlength="40" required><button class="primary" type="submit">Create team</button>
    </form>` : ''}
    <h3>${mine ? 'Other teams' : 'Teams'}</h3>
    ${(g.teams || []).filter((t) => t.id !== mine?.id).length === 0 ? html`<p class="muted">No other teams yet.</p>` : ''}
    <ul class="team-list">${(g.teams || []).filter((t) => t.id !== mine?.id).map((t) => {
      const full = t.members.length >= s.team_cap;
      return html`<li data-key="${t.id}" class="team-row">
        <div><strong>${t.name}</strong><span class="muted"> ${t.members.length}/${s.team_cap}</span>
        <div class="small muted">${t.members.join(', ') || 'Empty'}</div></div>
        <button data-action="join-team" data-team="${t.id}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>
      </li>`;
    })}</ul>`;
}
on('create-team', async (form, d) => { await rpc('create_team', { p_session: currentId, p_name: d.name }); form.reset(); await load(); });
on('join-team', async (el) => { await rpc('join_team', { p_team: el.dataset.team }); await load(); });
on('leave-team', async () => { await rpc('leave_team', { p_session: currentId }); await load(); });
on('start-rename', () => setUi('teamEdit', { editing: true }));
on('cancel-rename', () => setUi('teamEdit', { editing: false }));
on('rename-team', async (_f, d) => { await rpc('rename_team', { p_team: store.game.team.id, p_name: d.name }); setUi('teamEdit', { editing: false }); await load(); });

function lateTeams(g) {
  return html`<section class="teams"><h1>${g.session.title}</h1>
    <p class="lede">The game has started. Join one of the existing teams to play.</p>${teamPicker(g, false)}</section>`;
}

// ---------------------------------------------------------------------------
// Live game

export function timerBar(s, label = 'Time left') {
  if (s.status === 'paused') return html`<div class="timer paused"><span class="timer-label">Paused by your instructor</span></div>`;
  if (!s.stage_ends_at) return html`<div class="timer none"><span class="timer-label">No time limit this round</span></div>`;
  const total = Math.max(1, (new Date(s.stage_ends_at) - new Date(s.stage_started_at || s.stage_ends_at)) / 1000) || 60;
  return html`<div class="timer" data-deadline="${s.stage_ends_at}" data-total="${totalSeconds(s) || total}">
    <span class="timer-label">${label}</span><span class="timer-text">–:––</span>
    <span class="timer-track" aria-hidden="true"><span class="timer-fill"></span></span></div>`;
}
function totalSeconds(s) {
  const c = normalizeConfig(s.game_type, s.config);
  if (s.game_type === 'public_goods') return s.stage === 'punish' ? c.punish_seconds : c.contribute_seconds;
  if (s.game_type === 'ultimatum') return s.stage === 'respond' ? c.respond_seconds : c.offer_seconds;
  if (s.game_type === 'commons') return s.stage === 'chat' ? c.chat_seconds : c.decide_seconds;
  return c.round_seconds ?? c.writing_seconds;
}

function live(g, cfg) {
  const s = g.session;
  if (s.game_type === 'pd_tournament') return renderLab(g, cfg);
  const total = roundsTotal(s.game_type, cfg);
  const season = s.game_type === 'commons' && g.assignment?.season;
  return html`
    ${scene(s.game_type, cfg)}
    <section class="live-head">
      <div class="lh-title">${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}<h1>${s.title}</h1></div>
      <div class="round-badge"><span class="rb-n">${season || s.round_no}</span><span class="rb-of">${season ? 'season' : total ? `of ${total}` : 'round'}</span></div>
    </section>
    ${timerBar(s, s.game_type === 'commons' && s.stage === 'chat' ? 'Chat time left' : 'Time left')}
    ${s.team_mode === 'teams' && g.team ? html`<div class="teamstrip"><strong>${g.team.name}</strong>
      <span>${g.me.is_captain ? 'You are captain this round' : `Captain this round: ${g.me.captain_name || '–'}`}</span></div>` : ''}
    <div class="live-grid">
      <div class="col-main">
        <section class="decide card" aria-live="polite">
          <h2>${stageLabel(s, g)}</h2>
          ${decisionPanel(g, cfg)}
        </section>
        ${lastResult(g, cfg)}
      </div>
      <div class="col-side">
        ${publicBlock(g, cfg)}
        ${historyBlock(g, cfg)}
      </div>
    </div>
    <details class="rules-drawer"><summary>Rules</summary>${rulesList(s, cfg)}</details>`;
}

function finished(g, cfg) {
  const s = g.session;
  return html`<section class="final">
    ${scene(s.game_type, cfg)}
    ${s.title !== GAME_LABELS[s.game_type] ? html`<p class="kicker">${GAME_LABELS[s.game_type]}</p>` : ''}
    <h1>${s.title}</h1>
    <p class="lede">Game over.</p>
    ${s.game_type === 'pd_tournament' ? renderLab(g, cfg) : finalBlock(g, cfg)}
  </section>`;
}

// ---------------------------------------------------------------------------
// Submitting decisions

on('demo-skip-check', () => demoPass());

export async function submit(payload, message = 'Decision saved. You can change it until time runs out.') {
  if (store.game?.demo) { demoSubmit(payload); return; }
  await rpc('submit_decision', { p_session: currentId, p_payload: payload });
  toast(message);
  await load();
}
