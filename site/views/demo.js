// Demo page: pick a game and play it alone against simulated players. No sign-in, nothing saved.
import { html, store, setUi, on, rerender, toast } from '../lib/dom.js';
import { GAME_LABELS, GAME_INFO, MARKETS, STORIES, normalizeConfig } from '../lib/games.js';
import { startDemo, demoActive } from '../lib/demo.js';
import { HOUSE, testStrategy, runTournament } from '../lib/pd.js';
import { renderPlay } from './play.js';
import { testTable, tournamentResults } from './lab.js';
import { go } from '../app.js';

const STRATEGY_GAMES = ['pd_live', 'pd_tournament', 'public_goods', 'ultimatum', 'commons'];

export function enterDemo(type) {
  if (!type) return;
  if (type === 'pd_tournament') { store.ui.tdemo = store.ui.tdemo || { code: HOUSE[0].code, pick: HOUSE[0].id }; rerender(); return; }
  if (!store.game?.demo || store.game.session.game_type !== type) startDemo(type, demoOptions(type));
}
function demoOptions(type) {
  const o = store.ui.demoOpts || {};
  if (type === 'commons') return { variant: o.simpleCommons ? 'simple' : 'fishery' };
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
        <label class="inline-label">Business <select data-change="demo-story">${Object.entries(STORIES).map(([k, v]) => html`<option value="${k}" ${(o.story || 'bakery') === k ? 'selected' : ''}>${v.business.charAt(0).toUpperCase() + v.business.slice(1)}</option>`)}</select></label>
      </div>
      <div class="type-grid">${MARKETS.map(card)}</div>
    </section>
    <h2 class="group-h">Games of strategy</h2>
    <div class="type-grid">${STRATEGY_GAMES.map(card)}</div>
  </main>`;
}

function card(t) {
  return html`<a class="type-card" href="#/demo/${t}"><strong>${GAME_LABELS[t]}</strong><span>${GAME_INFO[t].short}</span><span class="play-demo">Play demo</span></a>`;
}

on('demo-hard', (el) => setUi('demoOpts', { hard: el.checked }));
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
// Strategy tournament demo: pick or edit a strategy, test it, run it against the house strategies.

function tournamentDemo() {
  const ui = store.ui.tdemo || { code: HOUSE[0].code, pick: HOUSE[0].id };
  const c = normalizeConfig('pd_tournament', { repeats: 2 });
  return html`<main class="page play">
    <a class="back" href="#/demo">← All demos</a>
    <div class="demo-banner"><span>Demo: your strategy plays the computer's house strategies. Nothing is saved.</span></div>
    <h1>${GAME_LABELS.pd_tournament} (demo)</h1>
    <p class="lede">In class, teams describe their strategy in plain English and an AI turns it into a small program. In this demo, start from a ready-made strategy and change it if you like.</p>
    <section class="card lab-step">
      <h2>1. Choose a starting strategy</h2>
      <select data-change="tdemo-pick" aria-label="Starting strategy">${HOUSE.map((h) => html`<option value="${h.id}" ${ui.pick === h.id ? 'selected' : ''}>${h.name}: ${h.blurb}</option>`)}</select>
      <details class="code" open><summary>The program (you can edit it)</summary>
        <textarea class="mono" rows="9" spellcheck="false" data-input="tdemo-code" aria-label="Strategy program" data-force>${ui.code}</textarea>
        <p class="small muted">It must define <code>function strategy(myMoves, theirMoves, round)</code> and return "C" or "D".</p>
      </details>
    </section>
    <section class="card lab-step">
      <h2>2. Test it</h2>
      <button data-action="tdemo-test" ${ui.testing ? 'disabled' : ''}>${ui.testing ? 'Running…' : 'Run test matches'}</button>
      ${ui.error ? html`<p class="error">${ui.error}</p>` : ''}
      ${ui.tests ? testTable(ui.tests) : ''}
    </section>
    <section class="card lab-step">
      <h2>3. Run a tournament</h2>
      <p class="muted">Your strategy plays every house strategy ${c.repeats} times, with random match lengths between ${c.min_rounds} and ${c.max_rounds} rounds.</p>
      <button class="primary big" data-action="tdemo-run" ${ui.running ? 'disabled' : ''}>${ui.running ? 'Running…' : 'Run demo tournament'}</button>
    </section>
    ${ui.results ? html`<section class="final">${tournamentResults({ outputs: { tournament: ui.results }, team: { id: 'me' } })}</section>` : ''}
  </main>`;
}

on('tdemo-pick', (el) => {
  const h = HOUSE.find((x) => x.id === el.value);
  store.ui.tdemo = { ...store.ui.tdemo, pick: el.value, code: h.code, tests: null, results: null, error: null };
  const ta = document.querySelector('[data-input="tdemo-code"]');
  if (ta) { ta.value = h.code; ta.dataset.dirty = ''; }
  rerender();
});
on('tdemo-code', (el) => { store.ui.tdemo = { ...store.ui.tdemo, code: el.value, tests: null }; });
on('tdemo-test', async () => {
  setUi('tdemo', { testing: true, error: null });
  try { setUi('tdemo', { tests: await testStrategy(store.ui.tdemo.code, {}), testing: false }); }
  catch (e) { setUi('tdemo', { testing: false, tests: null, error: e.message }); }
});
on('tdemo-run', async () => {
  setUi('tdemo', { running: true, error: null });
  try {
    const mineName = `Your strategy (based on ${HOUSE.find((h) => h.id === store.ui.tdemo.pick)?.name || 'custom'})`;
    const entrants = [{ id: 'me', team_id: 'me', name: mineName, code: store.ui.tdemo.code },
      ...HOUSE.map((h) => ({ id: h.id, name: h.name, code: h.code }))];
    const results = await runTournament(entrants, normalizeConfig('pd_tournament', { repeats: 2 }));
    setUi('tdemo', { results, running: false });
    toast('Tournament finished. Scroll down for the results.');
  } catch (e) { setUi('tdemo', { running: false, error: e.message }); }
});
