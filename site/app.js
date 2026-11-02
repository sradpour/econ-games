import { html, raw, store, setState, setRenderer, rerender, installEvents, patch, on, toast } from './lib/dom.js';
import { initAuth, rpc, DEV } from './lib/api.js';
import { CONFIG } from './config.js';
import { renderSignIn, renderProfileSetup, renderHome, startHomeRefresh } from './views/student.js';
import { renderPlay, enterPlay, leavePlay } from './views/play.js';
import { renderTeach, renderClass, renderNewGame, enterTeach } from './views/teach.js';
import { renderControl, enterControl, leaveControl } from './views/control.js';
import { renderAdmin, enterAdmin } from './views/admin.js';
import { renderDemo, enterDemo } from './views/demo.js';

const root = document.getElementById('app');
installEvents(document.body);

// ---------------------------------------------------------------------------
// Routing (hash based, works on GitHub Pages)

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'play' && parts[1]) return { name: 'play', id: parts[1] };
  if (parts[0] === 'teach' && parts[1] === 'class' && parts[2]) return { name: 'class', id: parts[2] };
  if (parts[0] === 'teach' && parts[1] === 'new' && parts[2]) return { name: 'new', id: parts[2] };
  if (parts[0] === 'teach' && parts[1] === 'game' && parts[2]) return { name: 'control', id: parts[2], projector: parts[3] === 'projector' };
  if (parts[0] === 'teach') return { name: 'teach' };
  if (parts[0] === 'admin') return { name: 'admin' };
  if (parts[0] === 'demo') return { name: 'demo', id: parts[1] };
  return { name: 'home' };
}

let leaving = null;
async function onRoute() {
  const route = parseRoute();
  leaving?.(); leaving = null;
  setState({ route });
  window.scrollTo(0, 0);
  if (route.name === 'demo') { if (!route.id && store.game?.demo) store.game = null; enterDemo(route.id); return; }
  if (store.game?.demo) store.game = null;
  if (!store.me?.full_name || (!store.me.profile_completed && !store.me.is_instructor)) return;
  if (route.name === 'play') { enterPlay(route.id); leaving = leavePlay; }
  if (['teach', 'class', 'new'].includes(route.name)) enterTeach();
  if (route.name === 'control') { enterControl(route.id); leaving = leaveControl; }
  if (route.name === 'admin') enterAdmin();
  if (route.name === 'home') refreshMe().then(startHomeRefresh).catch((e) => toast(e.message, 'error'));
}
window.addEventListener('hashchange', onRoute);
export const go = (hash) => { if (location.hash === hash) onRoute(); else location.hash = hash; };

export async function refreshMe() {
  const me = await rpc('get_me');
  setState({ me });
  return me;
}

// ---------------------------------------------------------------------------
// Layout

function header() {
  const me = store.me;
  const r = store.route || {};
  if (r.projector) return '';
  const teaching = ['teach', 'class', 'new', 'control', 'admin'].includes(r.name);
  return html`<header class="topbar">
    <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">${raw(markSvg)}</span><span>Econ Games</span></a>
    ${!me ? html`<nav class="topnav"><a href="#/demo" class="${r.name === 'demo' ? 'on' : ''}">Try a demo</a></nav>` : ''}
    ${me ? html`<nav class="topnav">
      ${me.is_instructor ? html`<a href="#/" class="${!teaching ? 'on' : ''}">Play</a><a href="#/teach" class="${teaching && r.name !== 'admin' ? 'on' : ''}">Teach</a>` : ''}
      ${me.is_admin ? html`<a href="#/admin" class="${r.name === 'admin' ? 'on' : ''}">Admin</a>` : ''}
      <a href="#/demo" class="${r.name === 'demo' ? 'on' : ''}">Demo</a>
      <details class="account"><summary aria-label="Account">${(me.full_name || me.email || '?').slice(0, 1).toUpperCase()}</summary>
        <div class="menu"><p class="who"><strong>${me.full_name || ''}</strong><br><span>${me.email}</span>${me.student_id ? html`<br><span>ID ${me.student_id}</span>` : ''}</p>
          <button class="link" data-action="edit-profile">Edit name or student ID</button>
          <button class="link" data-action="sign-out">Sign out</button></div></details>
    </nav>` : ''}
  </header>`;
}

const markSvg = '<svg viewBox="0 0 32 32" width="28" height="28"><path d="M4 6 L28 26" class="mk-d"/><path d="M4 26 L28 6" class="mk-s"/><circle cx="16" cy="16" r="3.2" class="mk-e"/></svg>';

function body() {
  if (store.booting) return html`<main class="page narrow"><p class="muted center">Loading…</p></main>`;
  if (store.route?.name === 'demo') return renderDemo(store.route);
  if (!store.user) return renderSignIn();
  if (!store.me) return html`<main class="page narrow"><p class="muted center">Loading your account…</p></main>`;
  if (!store.me.full_name || store.ui.editProfile || (!store.me.profile_completed && !store.me.is_instructor)) return renderProfileSetup();
  const r = store.route || { name: 'home' };
  switch (r.name) {
    case 'play': return renderPlay();
    case 'teach': return renderTeach();
    case 'class': return renderClass(r.id);
    case 'new': return renderNewGame(r.id);
    case 'control': return renderControl(r);
    case 'admin': return renderAdmin();
    default: return renderHome();
  }
}

setRenderer(() => {
  patch(root, html`${header()}${body()}${DEV ? html`<div class="dev-badge">Local test mode</div>` : ''}`);
  tickTimers();
});

// ---------------------------------------------------------------------------
// Countdown timers: elements with data-deadline update themselves without a full re-render

export const serverNow = () => Date.now() + (store.serverOffset || 0);
export function syncClock(serverIso) {
  if (!serverIso) return;
  const offset = new Date(serverIso).getTime() - Date.now();
  // smooth jitter: keep the smallest absolute correction seen recently
  store.serverOffset = store.serverOffset === undefined ? offset : (store.serverOffset * 0.7 + offset * 0.3);
}
function tickTimers() {
  for (const el of document.querySelectorAll('[data-deadline]')) {
    const end = new Date(el.dataset.deadline).getTime();
    const total = Number(el.dataset.total || 0) * 1000;
    const left = Math.max(0, end - serverNow());
    const s = Math.ceil(left / 1000);
    const label = el.querySelector('.timer-text');
    if (label) label.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const bar = el.querySelector('.timer-fill');
    if (bar && total) bar.style.transform = `scaleX(${Math.min(1, left / total)})`;
    el.classList.toggle('urgent', s <= 15 && s > 0);
    el.classList.toggle('done', s === 0);
  }
}
setInterval(tickTimers, 250);

// ---------------------------------------------------------------------------
// Auth bootstrap

on('sign-out', async () => {
  const { signOut } = await import('./lib/api.js');
  await signOut();
  setState({ me: null, user: null });
});
on('edit-profile', () => { document.querySelector('.account')?.removeAttribute('open'); store.ui.editProfile = true; rerender(); });

setState({ booting: true });
initAuth(async (user) => {
  setState({ user, booting: false, me: null });
  if (!user) { onRoute(); return; }
  try {
    let me = await refreshMe();
    if (!me) { await new Promise((r) => setTimeout(r, 800)); me = await refreshMe(); } // profile trigger may lag a moment
    onRoute();
  } catch (e) { toast(e.message, 'error'); }
}).catch((e) => { setState({ booting: false }); toast(e.message, 'error'); });

document.title = CONFIG.SITE_NAME || 'Econ Games';
