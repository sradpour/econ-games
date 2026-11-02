// Strategy lab: describe → translate → check → test → submit; then tournament results.
import { html, store, setUi, on, toast, num } from '../lib/dom.js';
import { rpc, translateStrategy } from '../lib/api.js';
import { HOUSE, testStrategy } from '../lib/pd.js';
import { moveStrip, payoffMatrix } from './panels.js';
import { reloadGame } from './play.js';

const lab = () => store.ui.lab || {};

export function renderLab(g, c) {
  if (g.session.status === 'finished') return tournamentResults(g);
  const saved = g.strategy || {};
  const L = lab();
  const code = L.code ?? saved.code ?? '';
  const explanation = L.explanation ?? saved.explanation ?? '';
  const description = L.description ?? saved.description ?? '';
  const sname = L.name ?? saved.name ?? '';
  const dirty = saved.submitted && (code !== saved.submitted_code || sname.trim() !== (saved.submitted_name || ''));
  return html`
    <section class="lab-head">
      <p class="kicker">Strategy tournament · ${g.team?.name || ''}</p>
      <h1>${g.session.title}</h1>
      <p class="lede">Describe how your team wants to play, check the translation, test it, then submit. Every team's strategy will play every other team's.</p>
      ${saved.submitted ? html`<div class="entered card">
          <p class="entered-title">✓ “${saved.submitted_name || 'Your strategy'}” is entered${saved.submitted_by ? ` (by ${saved.submitted_by})` : ''}.</p>
          <p><strong>What happens next:</strong> when every team is ready, your instructor runs the tournament. Every entered strategy plays every other one, and the results and all your matches appear on this page automatically. You don't need to do anything else.</p>
          ${g.tprogress ? html`<p class="small">${g.tprogress.entered} of ${g.tprogress.teams} teams have entered so far.</p>` : ''}
          <p class="small muted">Want to change it? Until the tournament runs you can edit the description or the program below, test the new version, and replace your entered strategy.${dirty ? ' Your draft below is different from the entered version.' : ''}</p>
        </div>`
        : html`<p class="note">Your team has not entered a strategy yet. Describe it, check the translation, test it, then submit.${g.tprogress ? ` ${g.tprogress.entered} of ${g.tprogress.teams} teams have entered so far.` : ''}</p>`}
    </section>

    <section class="card lab-step">
      <h2>1. Name and describe your strategy</h2>
      <form data-action="translate" class="stack">
        <label>Strategy name <input name="sname" maxlength="40" value="${sname}" data-input="lab-name" placeholder="e.g. Forgiving Fox" required>
          <span class="help">Shown on the tournament scoreboard.</span></label>
        <textarea name="description" rows="5" maxlength="3000" data-input="lab-desc" placeholder="Example: Cooperate in the first round. After that, do whatever my opponent did last round, but forgive a single defection one time in three.">${description}</textarea>
        <button class="primary" type="submit" ${L.translating ? 'disabled' : ''}>${L.translating ? `Translating… ${Math.round((Date.now() - L.translateStarted) / 1000)} s` : code ? 'Translate again' : 'Translate'}</button>
        ${L.translating ? html`<p class="small muted">Sent to Google's Gemini; waiting for its answer. This usually takes 5–20 seconds. If nothing comes back within 90 seconds you'll see an error here.</p>` : ''}
        ${L.translateError ? html`<p class="error">${L.translateError}</p>` : ''}
        ${saved.translations_used ? html`<p class="small muted">Translations used by your team: ${saved.translations_used} of 40.</p>` : ''}
      </form>
    </section>

    ${code ? html`<section class="card lab-step">
      <h2>2. Check it does what you meant</h2>
      ${explanation ? html`<div class="explain">${explanation.split('\n').filter(Boolean).map((l) => html`<p>${l}</p>`)}</div>` : ''}
      ${L.assumptions?.length ? html`<div class="note"><strong>Assumptions the translator made:</strong><ul>${L.assumptions.map((a) => html`<li>${a}</li>`)}</ul></div>` : ''}
      <form data-action="fix-translation" class="stack">
        <label>Not right? Say what's wrong <textarea name="feedback" rows="2" placeholder="It should forgive after two rounds, not one."></textarea></label>
        <button type="submit" ${L.translating ? 'disabled' : ''}>Fix the translation</button>
      </form>
      <details class="code"><summary>Show the program</summary>
        <textarea class="mono" rows="12" spellcheck="false" data-input="lab-code" aria-label="Strategy program">${code}</textarea>
        <p class="small muted">You can edit this directly if you know JavaScript. It must define <code>function strategy(myMoves, theirMoves, round)</code> returning "C" or "D".</p>
      </details>
    </section>

    <section class="card lab-step">
      <h2>3. Test it</h2>
      <p class="muted">Plays one match against each house strategy and against a copy of itself. Match lengths are random, between ${c.min_rounds} and ${c.max_rounds} rounds.</p>
      <button data-action="run-tests" ${L.testing ? 'disabled' : ''}>${L.testing ? 'Running…' : 'Run test matches'}</button>
      ${L.testError ? html`<p class="error">${L.testError}</p>` : ''}
      ${L.tests ? testTable(L.tests) : ''}
    </section>

    <section class="card lab-step">
      <h2>4. ${saved.submitted ? 'Entered' : 'Submit'}</h2>
      ${!saved.submitted ? html`<p>Submit when you are happy with the test results. You can still change it later, until your instructor runs the tournament.</p>
          <button class="primary big" data-action="submit-strategy">Submit strategy</button>`
        : dirty ? html`<p>This draft is different from the strategy your team entered. Test it first, then replace the entered version if you prefer it.</p>
          <button class="primary big" data-action="submit-strategy">Replace our entered strategy with this draft</button>`
        : html`<p class="saved">This is the version your team entered. Nothing else to do; results appear here after the tournament.</p>`}
    </section>` : ''}
    <details class="rules-drawer"><summary>Payoffs</summary>${payoffMatrix(c)}</details>`;
}

function testTable(results) {
  const name = (id) => (id === 'me2' ? 'Your own strategy' : HOUSE.find((h) => h.id === id)?.name || id);
  const errs = results.flatMap((r) => r.errorsA);
  return html`
    ${errs.length ? html`<div class="error"><strong>Problems found:</strong><ul>${[...new Set(errs)].slice(0, 5).map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
    <ul class="tests">${results.map((r) => html`<li>
      <div class="test-head"><strong>vs ${name(r.b)}</strong><span>You <strong>${r.scoreA}</strong> · Them <strong>${r.scoreB}</strong></span></div>
      ${HOUSE.find((h) => h.id === r.b)?.blurb ? html`<p class="small muted">${HOUSE.find((h) => h.id === r.b).blurb}</p>` : ''}
      ${moveStrip(r.movesA, r.movesB, 'You', 'Them')}</li>`)}</ul>`;
}

const sid = () => store.game.session.id;
const currentCode = () => lab().code ?? store.game.strategy?.code ?? '';
const currentName = () => (lab().name ?? store.game.strategy?.name ?? '').trim();

on('lab-desc', (el) => { store.ui.lab = { ...lab(), description: el.value }; });
on('lab-name', (el) => { store.ui.lab = { ...lab(), name: el.value }; });
on('lab-code', (el) => { store.ui.lab = { ...lab(), code: el.value, tests: null }; });

let tick = null;
async function doTranslate(body) {
  setUi('lab', { translating: true, translateStarted: Date.now(), translateError: null });
  clearInterval(tick);
  tick = setInterval(() => setUi('lab', {}), 1000); // refresh the elapsed-seconds counter
  try {
    const r = await translateStrategy({ session_id: sid(), ...body });
    setUi('lab', { code: r.code, explanation: r.explanation, assumptions: r.assumptions, tests: null, translating: false, description: body.description });
    await rpc('save_strategy', { p_session: sid(), p_description: body.description, p_code: r.code, p_explanation: r.explanation, p_submit: false, p_name: currentName() });
    await reloadGame();
    toast('Translated. Check the explanation, then test it.');
  } catch (e) {
    setUi('lab', { translateError: e.message });
  } finally { clearInterval(tick); setUi('lab', { translating: false }); }
}
on('translate', async (_f, d) => doTranslate({ description: d.description }));
on('fix-translation', async (form, d) => {
  if (!d.feedback?.trim()) throw new Error('Say what should change first.');
  await doTranslate({ description: lab().description ?? store.game.strategy?.description ?? '', previous_code: currentCode(), feedback: d.feedback });
  form.reset();
});

on('run-tests', async () => {
  const code = currentCode();
  if (!code) throw new Error('Translate your strategy first.');
  setUi('lab', { testing: true, testError: null });
  try {
    const tests = await testStrategy(code, store.game.session.config);
    setUi('lab', { tests, testing: false });
  } catch (e) {
    setUi('lab', { testing: false, tests: null, testError: e.message });
  }
});

on('submit-strategy', async () => {
  const code = currentCode();
  if (!code.includes('function strategy')) throw new Error('Translate your strategy first.');
  if (!currentName()) { document.querySelector('input[name=sname]')?.focus(); throw new Error('Give your strategy a name first (step 1).'); }
  try { await testStrategy(code, store.game.session.config, [HOUSE[0].id]); }
  catch (e) { throw new Error(`Fix this before submitting: ${e.message}`); }
  const L = lab(); const saved = store.game.strategy || {};
  await rpc('save_strategy', {
    p_session: sid(), p_description: L.description ?? saved.description ?? '', p_code: code,
    p_explanation: L.explanation ?? saved.explanation ?? '', p_submit: true, p_name: currentName(),
  });
  store.ui.lab = { ...L, code: undefined, description: undefined, name: undefined };
  toast(saved.submitted ? 'Entered strategy replaced with your new version.' : 'Strategy entered. Results will appear here after the tournament.');
  await reloadGame();
});

// ---------------------------------------------------------------------------

export function tournamentResults(g, opts = {}) {
  const t = g.outputs?.tournament;
  if (!t) return html`<p class="muted">The tournament results are not available.</p>`;
  const myId = opts.instructor ? null : g.team?.id;
  const nameOf = Object.fromEntries(t.ranking.map((r) => [r.entrant_id, r.name]));
  const mine = myId ? t.ranking.find((r) => r.team_id === myId) : null;
  const myMatches = mine ? t.matches.filter((m) => m.a === mine.entrant_id || m.b === mine.entrant_id) : [];
  return html`
    ${mine ? html`<div class="final-score"><div class="place"><span class="place-n">${mine.rank}</span><span class="place-of">of ${t.ranking.length}</span></div>
      <div><p class="muted">${mine.name && mine.name !== mine.team ? `“${mine.name}” scored` : 'Your strategy scored'}</p><p class="score">${num(mine.total)}</p><p class="small muted">${num(mine.average, 2)} points per round · ${mine.wins} wins, ${mine.ties} ties, ${mine.losses} losses</p></div></div>` : ''}
    <section class="card"><h2>Ranking</h2>
      <table class="board"><thead><tr><th>#</th><th>Strategy</th><th>Total</th><th>Per round</th><th>W–T–L</th></tr></thead><tbody>
      ${t.ranking.map((r) => html`<tr class="${r.team_id && r.team_id === myId ? 'me' : ''}"><td>${r.rank}</td><td><strong>${r.name}</strong>${r.team && r.team !== r.name ? html`<div class="small muted">${r.team}</div>` : ''}${r.house ? html` <span class="chip">house</span>` : ''}${r.disqualified ? html`<div class="small neg">Broken program, played as Always Cooperate</div>` : ''}</td>
        <td>${num(r.total)}</td><td>${num(r.average, 2)}</td><td>${r.wins}–${r.ties}–${r.losses}</td></tr>`)}
      </tbody></table>
      <p class="small muted">Each pair played ${t.repeats} ${t.repeats === 1 ? 'match' : 'matches'}; match lengths were ${t.lengths.join(', ')} rounds.</p>
    </section>
    ${mine ? html`<section class="card"><h2>Your matches</h2>${matchList(myMatches, nameOf, mine.entrant_id)}</section>` : ''}
    <details class="card"><summary>Every match (${t.matches.length})</summary>${matchList(t.matches, nameOf, null)}</details>`;
}

function matchList(matches, nameOf, me) {
  return html`<ul class="matches">${matches.map((m) => {
    const flip = me && m.b === me;
    const [na, nb, ma, mb, sa, sb] = flip ? [nameOf[m.b], nameOf[m.a], m.movesB, m.movesA, m.scoreB, m.scoreA] : [nameOf[m.a], nameOf[m.b], m.movesA, m.movesB, m.scoreA, m.scoreB];
    return html`<li><p><strong>${na}</strong> ${sa} – ${sb} <strong>${nb}</strong> <span class="small muted">(match ${m.rep}, ${m.length} rounds)</span></p>${moveStrip(ma, mb, na, nb)}</li>`;
  })}</ul>`;
}
