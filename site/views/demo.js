// Demo page: pick a game and play it alone against simulated players. No sign-in, nothing saved.
import { html, store, setUi, on, rerender, toast } from '../lib/dom.js';
import { GAME_LABELS, GAME_INFO, MARKETS, STORIES, COST_STORIES, normalizeConfig } from '../lib/games.js';
import { startDemo, demoActive } from '../lib/demo.js';
import { HOUSE, testStrategy, runTournament, computerName } from '../lib/pd.js';
import { translateStrategy } from '../lib/api.js';
import { renderPlay } from './play.js';
import { scene } from './scenes.js';
import { testTable, tournamentResults } from './lab.js';
import { payoffMatrix } from './panels.js';
import { go } from '../app.js';

const STRATEGY_GAMES = ['pd_live', 'pd_tournament', 'public_goods', 'ultimatum', 'commons'];

export function enterDemo(type) {
  if (!type) return;
  if (type === 'pd_tournament') { store.ui.tdemo = store.ui.tdemo || {}; rerender(); return; }
  if (!store.game?.demo || store.game.session.game_type !== type) startDemo(type, demoOptions(type));
}
function demoOptions(type) {
  const o = store.ui.demoOpts || {};
  if (type === 'commons') return { variant: o.simpleCommons ? 'simple' : 'fishery' };
  if (type === 'costs') return { story: o.story || 'bakery', ...COST_STORIES[o.story || 'bakery'], level: o.easyCosts ? 'easy' : 'standard' };
  if (!MARKETS.includes(type)) return {};
  return { difficulty: o.hard ? 'hard' : 'normal', story: o.story || 'bakery', ...STORIES[o.story || 'bakery'] };
}

export function renderDemo(route) {
  if (route.id === 'pd_tournament') return tournamentDemo();
  if (route.id && store.game?.demo && store.game.session.game_type === route.id) return renderPlay();
  if (route.id) return html`<main class="page"><p class="muted">Starting demo…</p></main>`;
  const o = store.ui.demoOpts || {};
  return html`<main class="page demo-pick">
    <h1>Try the games</h1>
    <p class="lede">Play any game on your own against computer players. There's no timer and nothing is saved, so explore freely.${store.user ? '' : html` <a href="#/">Sign in</a> to play with your class.`}</p>
    <section class="card demo-options">
      <h2>Market games</h2>
      <div class="row wrap">
        <label class="switch"><input type="checkbox" data-change="demo-hard" ${o.hard ? 'checked' : ''}> <span>Hard mode: work out your own cost table</span></label>
        <label class="switch"><input type="checkbox" data-change="demo-easy-costs" ${o.easyCosts ? 'checked' : ''}> <span>Easy version of the costs game (only fixed and variable costs)</span></label>
        <label class="inline-label">Business <select data-change="demo-story">${Object.entries(STORIES).map(([k, v]) => html`<option value="${k}" ${(o.story || 'bakery') === k ? 'selected' : ''}>${v.business.charAt(0).toUpperCase() + v.business.slice(1)}</option>`)}</select></label>
      </div>
      <div class="type-grid">${['costs', ...MARKETS].map(card)}</div>
    </section>
    <h2 class="group-h">Games of strategy</h2>
    <div class="type-grid">${STRATEGY_GAMES.map(card)}</div>
  </main>`;
}

function card(t) {
  const story = store.ui.demoOpts?.story || 'bakery';
  return html`<a class="type-card gt-${t}" href="#/demo/${t}">${scene(t, normalizeConfig(t, MARKETS.includes(t) ? STORIES[story] : t === 'costs' ? COST_STORIES[story] : {}), 'card-scene')}<strong>${GAME_LABELS[t]}</strong><span>${GAME_INFO[t].short}</span><span class="play-demo">Play demo</span></a>`;
}

on('demo-hard', (el) => setUi('demoOpts', { hard: el.checked }));
on('demo-easy-costs', (el) => setUi('demoOpts', { easyCosts: el.checked }));
on('demo-story', (el) => setUi('demoOpts', { story: el.value }));
on('demo-variant', (el) => {
  store.ui.demoOpts = { ...(store.ui.demoOpts || {}), simpleCommons: el.dataset.variant === 'simple' };
  startDemo('commons', demoOptions('commons'));
  window.scrollTo(0, 0);
});
on('demo-restart', () => {
  const t = store.game?.session?.game_type;
  if (t) { startDemo(t, demoOptions(t)); window.scrollTo(0, 0); }
});

// ---------------------------------------------------------------------------
// Strategy tournament demo: the same AI translator as in class. Describe a strategy in plain English, check the
// AI's explanation, test it against practice opponents, then play a small tournament against computer players.
// Students never see code or the names of textbook strategies.

function tournamentDemo() {
  const ui = store.ui.tdemo || {};
  const c = normalizeConfig('pd_tournament', { repeats: 2 });
  const signedIn = !!store.user;
  return html`<main class="page play">
    <a class="back" href="#/demo">← All demos</a>
    <div class="demo-banner"><span>Demo: your strategy plays computer players. Nothing is saved.</span></div>
    <h1>${GAME_LABELS.pd_tournament} (demo)</h1>
    <p class="lede">Describe how you want to play in plain English. An AI translator turns your description into a strategy the computer can play, and explains back what it understood. Then test it and enter it in a tournament.</p>
    <details class="card rules-drawer" open><summary>The game</summary>
      <p>Each round both players choose Cooperate or Defect at the same time. A match lasts ${c.min_rounds}–${c.max_rounds} rounds, and nobody knows which round is the last.</p>${payoffMatrix(c)}</details>
    ${!signedIn ? html`<section class="card lab-step"><h2>Sign in to try the AI translator</h2>
      <p>The translator uses Google's Gemini, so the demo needs an account. Any student or instructor account works.</p>
      <a class="button primary" href="#/">Sign in</a></section>` : html`
    <section class="card lab-step">
      <h2>1. Name and describe your strategy</h2>
      <form data-action="tdemo-translate" class="stack">
        <label>Strategy name <input name="sname" maxlength="40" value="${ui.name || ''}" data-input="tdemo-name" placeholder="Give it a name"></label>
        <textarea name="description" rows="5" maxlength="3000" data-input="tdemo-desc" placeholder="In plain English: what do you do in the first round? How do you react to what the other player did? Do you ever forgive, punish, or change your mind? Be as specific as you can.">${ui.description || ''}</textarea>
        <button class="primary" type="submit" ${ui.translating ? 'disabled' : ''}>${ui.translating ? `Translating… ${Math.round((Date.now() - ui.started) / 1000)} s` : ui.code ? 'Translate again' : 'Translate'}</button>
        ${ui.translating ? html`<p class="small muted">Sent to Google's Gemini; this usually takes 5–20 seconds.</p>` : ''}
        ${ui.translateError ? html`<p class="error">${ui.translateError}</p>` : ''}
      </form>
    </section>
    ${ui.code ? html`<section class="card lab-step">
      <h2>2. Check it does what you meant</h2>
      ${ui.explanation ? html`<div class="explain">${ui.explanation.split('\n').filter(Boolean).map((l) => html`<p>${l}</p>`)}</div>` : ''}
      ${ui.assumptions?.length ? html`<div class="note"><strong>Assumptions the translator made:</strong><ul>${ui.assumptions.map((a) => html`<li>${a}</li>`)}</ul></div>` : ''}
      <form data-action="tdemo-fix" class="stack">
        <label>Not right? Say what's wrong <textarea name="feedback" rows="2" placeholder="It should forgive after two rounds, not one."></textarea></label>
        <button type="submit" ${ui.translating ? 'disabled' : ''}>Fix the translation</button>
      </form>
    </section>
    <section class="card lab-step">
      <h2>3. Test it</h2>
      <p class="muted">One match against each of ${HOUSE.length} practice opponents (computer players that each play a different way) and against a copy of itself.</p>
      <button data-action="tdemo-test" ${ui.testing ? 'disabled' : ''}>${ui.testing ? 'Running…' : 'Run test matches'}</button>
      ${ui.error ? html`<p class="error">${ui.error}</p>` : ''}
      ${ui.tests ? testTable(ui.tests) : ''}
    </section>
    <section class="card lab-step">
      <h2>4. Run a tournament</h2>
      <p class="muted">Your strategy plays ${HOUSE.length} computer players ${c.repeats} times each, with random match lengths between ${c.min_rounds} and ${c.max_rounds} rounds. In class, it plays every other team's strategy instead.</p>
      <button class="primary big" data-action="tdemo-run" ${ui.running ? 'disabled' : ''}>${ui.running ? 'Running…' : 'Run demo tournament'}</button>
    </section>` : ''}
    ${ui.results ? html`<section class="final">${tournamentResults({ outputs: { tournament: ui.results }, team: { id: 'me' } })}</section>` : ''}`}
  </main>`;
}

on('tdemo-name', (el) => { store.ui.tdemo = { ...store.ui.tdemo, name: el.value }; });
on('tdemo-desc', (el) => { store.ui.tdemo = { ...store.ui.tdemo, description: el.value }; });
let tdemoTick = null;
async function tdemoTranslate(body) {
  setUi('tdemo', { translating: true, started: Date.now(), translateError: null });
  clearInterval(tdemoTick);
  tdemoTick = setInterval(() => setUi('tdemo', {}), 1000);
  try {
    const r = await translateStrategy({ demo: true, ...body });
    setUi('tdemo', { code: r.code, explanation: r.explanation, assumptions: r.assumptions, tests: null, results: null, error: null, description: body.description });
    toast('Translated. Check the explanation, then test it.');
  } catch (e) {
    setUi('tdemo', { translateError: e.message });
  } finally { clearInterval(tdemoTick); setUi('tdemo', { translating: false }); }
}
on('tdemo-translate', async (_f, d) => {
  if (!d.description?.trim()) throw new Error('Describe your strategy first.');
  await tdemoTranslate({ description: d.description });
});
on('tdemo-fix', async (form, d) => {
  if (!d.feedback?.trim()) throw new Error('Say what should change first.');
  await tdemoTranslate({ description: store.ui.tdemo.description || '', previous_code: store.ui.tdemo.code, feedback: d.feedback });
  form.reset();
});
const BROKEN = 'The translated strategy does not run properly. Press "Translate again" or describe what should change.';
on('tdemo-test', async () => {
  setUi('tdemo', { testing: true, error: null });
  try { setUi('tdemo', { tests: await testStrategy(store.ui.tdemo.code, {}), testing: false }); }
  catch (e) { setUi('tdemo', { testing: false, tests: null, error: BROKEN }); }
});
on('tdemo-run', async () => {
  setUi('tdemo', { running: true, error: null });
  try {
    const mine = (store.ui.tdemo.name || '').trim() || 'Your strategy';
    const entrants = [{ id: 'me', team_id: 'me', name: mine, code: store.ui.tdemo.code },
      ...HOUSE.map((h, i) => ({ id: h.id, name: computerName(i), code: h.code }))];
    const results = await runTournament(entrants, normalizeConfig('pd_tournament', { repeats: 2 }));
    setUi('tdemo', { results, running: false });
    toast('Tournament finished. Scroll down for the results.');
  } catch (e) { setUi('tdemo', { running: false, error: BROKEN }); }
});
