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
      ${me.is_instructor ? html`<a href="#/" class="${!teaching && r.name !== 'demo' ? 'on' : ''}">Play</a><a href="#/teach" class="${teaching && r.name !== 'admin' ? 'on' : ''}">Teach</a>` : ''}
      ${me.is_admin ? html`<a href="#/admin" class="${r.name === 'admin' ? 'on' : ''}">Admin</a>` : ''}
      <a href="#/demo" class="${r.name === 'demo' ? 'on' : ''}">Demo</a>
      <details class="account"><summary aria-label="Account">${(me.full_name || me.email || '?').slice(0, 1).toUpperCase()}</summary>
        <div class="menu"><p class="who"><strong>${me.full_name || ''}</strong><br><span>${me.email}</span>${me.student_id ? html`<br><span>ID ${me.student_id}</span>` : ''}</p>
          <button class="link" data-action="edit-profile">Edit name or student ID</button>
          <button class="link" data-action="sign-out">Sign out</button></div></details>
    </nav>` : ''}
  </header>`;
}

const markSvg = '<svg width="44" height="44" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"> <g transform="rotate(-8 31 33)"> <rect x="3" y="17" width="56" height="32" rx="2.5" fill="#CDEBC3" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="3"/> <rect x="6.5" y="20.5" width="49" height="25" rx="1.2" fill="none" stroke="#1F6B45" stroke-width="1.5"/> <rect x="8.5" y="22.5" width="45" height="21" fill="none" stroke="#3C9A64" stroke-width=".8" stroke-dasharray="1.2 1"/> <path d="M9 25.5 q2.5 -1.6 5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0" fill="none" stroke="#3C9A64" stroke-width=".8"/><path d="M9 40.5 q2.5 -1.6 5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0" fill="none" stroke="#3C9A64" stroke-width=".8"/> <circle cx="17" cy="33" r="4.6" fill="none" stroke="#1F6B45" stroke-width="1.3"/> <circle cx="17" cy="33" r="2.6" fill="#3C9A64"/> <circle cx="45" cy="33" r="4.6" fill="none" stroke="#1F6B45" stroke-width="1.3" stroke-dasharray="1.4 1"/> <path d="M45 30.2 L45.8 32.2 L47.9 32.3 L46.3 33.6 L46.8 35.6 L45 34.5 L43.2 35.6 L43.7 33.6 L42.1 32.3 L44.2 32.2 Z" fill="#1F6B45"/> <ellipse cx="31" cy="33" rx="8.2" ry="9.6" fill="#E6F6DF" stroke="#1F6B45" stroke-width="1.8"/> <ellipse cx="31" cy="33" rx="6.2" ry="7.6" fill="none" stroke="#3C9A64" stroke-width=".9"/> <text x="31" y="38" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="13" fill="#1F6B45">$</text> <g><circle cx="10.5" cy="24" r="4.3" fill="#E6F6DF" stroke="#1F6B45" stroke-width="1.3"/><text x="10.5" y="26.6" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="7" fill="#1F6B45">1</text></g><g><circle cx="51.5" cy="24" r="4.3" fill="#E6F6DF" stroke="#1F6B45" stroke-width="1.3"/><text x="51.5" y="26.6" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="7" fill="#1F6B45">1</text></g><g><circle cx="10.5" cy="42" r="4.3" fill="#E6F6DF" stroke="#1F6B45" stroke-width="1.3"/><text x="10.5" y="44.6" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="7" fill="#1F6B45">1</text></g><g><circle cx="51.5" cy="42" r="4.3" fill="#E6F6DF" stroke="#1F6B45" stroke-width="1.3"/><text x="51.5" y="44.6" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="7" fill="#1F6B45">1</text></g></g> <path d="M24 28 l-3.4 -2.6 M23 36.5 l-4 1.4 M29.5 41.5 l-.6 4" stroke="#FFD23F" stroke-width="2.4" stroke-linecap="round"/> <g transform="translate(31 32) rotate(-42) scale(.8)"> <path d="M-3 0 L7 -2.6 L7 2.6 Z" fill="#D7DCE6" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="2.4"/> <rect x="6" y="-4" width="13" height="8" rx="3.5" fill="#FF3D8B" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="2.88"/> <path d="M9 -2.4 h7" stroke="#FFC2DA" stroke-width="1.92" stroke-linecap="round"/> <path d="M19 0 H28" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="3.5999999999999996"/> <path d="M23 0 L33 -9 L36 -9 L31 0 Z" fill="#FFD23F" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="2.64"/> <path d="M23 0 L33 9 L36 9 L31 0 Z" fill="#22D3EE" stroke="#2A1B4A" stroke-linejoin="round" stroke-linecap="round" stroke-width="2.64"/></g> </svg>';

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
