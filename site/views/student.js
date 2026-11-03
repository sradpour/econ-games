import { html, raw, store, setState, setUi, on, toast, rerender } from '../lib/dom.js';
import { rpc, signInWithGoogle, devSignIn, DEV } from '../lib/api.js';
import { GAME_LABELS } from '../lib/games.js';
import { refreshMe, go } from '../app.js';
import { scene } from './scenes.js';

// ---------------------------------------------------------------------------
// Sign in

export function renderSignIn() {
  return html`<main class="page signin">
    <section class="signin-hero">
      <div class="hero-scenes">${scene('competitive', { product: 'loaf' }, 'hs')}${scene('commons', {}, 'hs')}${scene('pd_live', {}, 'hs')}${scene('public_goods', {}, 'hs')}</div>
      <h1>Run the market.<br>Find the price.</h1>
      <p class="lede">Classroom games for introductory economics: compete as firms in perfect competition, oligopoly and monopoly, and play the classic games of strategy with your classmates.</p>
      ${DEV ? html`<form class="card devlogin" data-action="dev-sign-in">
          <p class="muted">Local test mode: sign in as any email.</p>
          <label>Email <input name="email" type="email" required placeholder="student1@go.stockton.edu"></label>
          <label>Name <input name="name" placeholder="Student One"></label>
          <button class="primary" type="submit">Sign in</button>
        </form>`
      : html`<button class="primary big google" data-action="google-sign-in">${raw(googleSvg)} Sign in with Google</button>
        <p class="fine">Students: use your school Google account. Your instructor sees your name, email and student ID so games can count toward your grade.</p>`}
      <p class="demo-link"><a href="#/demo">Try any game first in demo mode</a>, no sign-in needed.</p>
    </section>
  </main>`;
}
const googleSvg = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

on('google-sign-in', () => signInWithGoogle());
on('dev-sign-in', async (_f, data) => devSignIn(data.email, data.name));

// ---------------------------------------------------------------------------
// Profile (first sign-in)

export function renderProfileSetup() {
  const me = store.me;
  const editing = store.ui.editProfile && me.full_name;
  return html`<main class="page narrow">
    <h1>${editing ? 'Your details' : 'Welcome'}</h1>
    <p class="lede">${editing ? 'Update how you appear to your instructor.' : 'Tell us who you are so your instructor can match your results to the class list.'}</p>
    <form class="card stack" data-action="save-profile">
      <label>Full name <input name="full_name" required minlength="2" autocomplete="name" value="${me.full_name || ''}"></label>
      <label>Student ID <input name="student_id" autocomplete="off" inputmode="text" value="${me.student_id || ''}" ${me.is_instructor ? '' : 'required'}>
        ${me.is_instructor ? '' : html`<span class="help">Instructors: <button type="button" class="link" data-action="request-instructor">request instructor access</button> instead.</span>`}</label>
      <p class="muted small">Signed in as ${me.email}</p>
      <div class="row">${editing ? html`<button type="button" data-action="cancel-profile">Cancel</button>` : ''}<button class="primary" type="submit">Save</button></div>
    </form>
  </main>`;
}
on('save-profile', async (_f, d) => {
  const me = await rpc('complete_profile', { p_full_name: d.full_name, p_student_id: d.student_id });
  store.ui.editProfile = false;
  setState({ me });
  toast('Saved');
  const { go: g } = await import('../app.js');
  g(location.hash || '#/');
});
on('cancel-profile', () => { store.ui.editProfile = false; rerender(); });

// ---------------------------------------------------------------------------
// Home: classes and games

const STATUS_LABEL = { lobby: 'Open to join', running: 'In progress', paused: 'Paused', finished: 'Finished' };
export const statusChip = (s) => html`<span class="chip st-${s}">${STATUS_LABEL[s] || s}</span>`;

export function renderHome() {
  const me = store.me;
  const sessions = store.ui.classSessions || {};
  return html`<main class="page">
    <section class="home-head">
      <h1>Hi, ${(me.full_name || '').split(' ')[0]}</h1>
      <form class="joinclass" data-action="join-class">
        <label for="code">Join a class</label>
        <div class="inline"><input id="code" name="code" required placeholder="Class code" autocomplete="off" autocapitalize="characters" maxlength="8"><button class="primary" type="submit">Join</button></div>
      </form>
    </section>
    ${me.classes.length === 0 ? html`<section class="empty">
        <h2>No classes yet</h2>
        <p>Ask your instructor for the six-letter class code and enter it above.</p>
      </section>` : ''}
    ${me.classes.map((c) => html`<section class="class-block" data-key="${c.id}">
      <div class="class-title"><h2>${c.name}</h2><span class="muted">${c.instructor}</span></div>
      ${sessions[c.id] === undefined ? html`<p class="muted">Loading games…</p>` :
        sessions[c.id].length === 0 ? html`<p class="muted">No games yet. They appear here when your instructor opens one.</p>` :
        html`<ul class="game-list">${sessions[c.id].map((s) => html`<li data-key="${s.id}">
          <a class="game-row ${s.status} gt-${s.game_type}" href="#/play/${s.id}">
            <span class="g-title">${s.title}</span>
            <span class="g-type">${GAME_LABELS[s.game_type]}</span>
            ${statusChip(s.status)}
          </a></li>`)}</ul>`}
    </section>`)}
    ${!me.is_instructor ? html`<footer class="home-foot">
      ${me.instructor_status === 'pending' ? html`<p class="muted">Your instructor access request is waiting for approval.</p>`
        : html`<button class="link" data-action="request-instructor">I'm an instructor</button>`}
    </footer>` : ''}
  </main>`;
}

let homeTimer = null;
export async function loadHomeSessions() {
  const me = store.me;
  if (!me) return;
  const out = {};
  await Promise.all(me.classes.map(async (c) => { out[c.id] = await rpc('class_sessions', { p_class: c.id }); }));
  setUi('classSessions', () => out);
}
export function startHomeRefresh() {
  clearInterval(homeTimer);
  loadHomeSessions().catch(() => {});
  homeTimer = setInterval(() => { if ((store.route?.name || 'home') === 'home' && document.visibilityState === 'visible') loadHomeSessions().catch(() => {}); }, 10000);
}

on('join-class', async (form, d) => {
  const r = await rpc('join_class', { p_code: d.code });
  form.reset();
  toast(`Joined ${r.name}`);
  await refreshMe();
  await loadHomeSessions();
});
on('request-instructor', async () => {
  const me = await rpc('request_instructor');
  setState({ me });
  toast(me.is_instructor ? 'Instructor access granted. Open the Teach tab.' : 'Request sent. The site admin will approve it.');
  if (me.is_instructor) go('#/teach');
});
