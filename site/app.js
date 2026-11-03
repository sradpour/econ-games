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

const markSvg = "<svg width=\"44\" height=\"44\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"10 12 76 76\"> <path d=\"M19.70 25.05 L20.56 28.38 L23.92 29.13 L21.02 30.99 L21.35 34.41 L18.69 32.23 L15.53 33.60 L16.78 30.39 L14.51 27.81 L17.94 28.01 Z\" fill=\"#FFD23F\" stroke=\"#2A1B4A\" stroke-width=\"1.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M75.42 75.84 L76.89 78.33 L79.77 78.16 L77.86 80.33 L78.92 83.02 L76.26 81.87 L74.03 83.71 L74.30 80.83 L71.86 79.27 L74.69 78.64 Z\" fill=\"#FFD23F\" stroke=\"#2A1B4A\" stroke-width=\"1.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <g transform=\"translate(46 58) rotate(-13)\"> <path d=\"M-33 -18 Q0 -21.5 33 -18 Q35 0 33 18 Q0 14.5 -33 18 Q-35 0 -33 -18 Z\" fill=\"#8EDB86\" stroke=\"#2A1B4A\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M-29.5 -14.6 Q0 -17.6 29.5 -14.6 L29.5 14.6 Q0 11.6 -29.5 14.6 Z\" fill=\"none\" stroke=\"#1E7A44\" stroke-width=\"1.3\"/> <path d=\"M-27.5 -12.4 Q0 -15.2 27.5 -12.4 L27.5 12.4 Q0 9.6 -27.5 12.4 Z\" fill=\"none\" stroke=\"#3FA463\" stroke-width=\"1\" stroke-dasharray=\"1.4 1.2\"/> <circle cx=\"-10.00\" cy=\"-1.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-10.67\" cy=\"1.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-12.50\" cy=\"3.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-15.00\" cy=\"4.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-17.50\" cy=\"3.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-19.33\" cy=\"1.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-20.00\" cy=\"-1.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-19.33\" cy=\"-3.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-17.50\" cy=\"-5.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-15.00\" cy=\"-6.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-12.50\" cy=\"-5.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-10.67\" cy=\"-3.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"-15\" cy=\"-1\" r=\"5\" fill=\"#1E7A44\"/><circle cx=\"-15\" cy=\"-1\" r=\"3.4\" fill=\"#3FA463\" stroke=\"#D4F7C8\" stroke-width=\".8\"/><circle cx=\"20.00\" cy=\"-1.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"19.33\" cy=\"1.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"17.50\" cy=\"3.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"15.00\" cy=\"4.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"12.50\" cy=\"3.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"10.67\" cy=\"1.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"10.00\" cy=\"-1.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"10.67\" cy=\"-3.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"12.50\" cy=\"-5.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"15.00\" cy=\"-6.00\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"17.50\" cy=\"-5.33\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"19.33\" cy=\"-3.50\" r=\"1.5\" fill=\"#1E7A44\"/><circle cx=\"15\" cy=\"-1\" r=\"5\" fill=\"#1E7A44\"/><circle cx=\"15\" cy=\"-1\" r=\"3.4\" fill=\"#3FA463\" stroke=\"#D4F7C8\" stroke-width=\".8\"/> <ellipse cx=\"0\" cy=\"-1\" rx=\"9.5\" ry=\"11.5\" fill=\"#D4F7C8\" stroke=\"#1E7A44\" stroke-width=\"1.8\"/> <ellipse cx=\"0\" cy=\"-1\" rx=\"7.2\" ry=\"9.2\" fill=\"none\" stroke=\"#3FA463\" stroke-width=\"1\"/> <text x=\"0\" y=\"5\" text-anchor=\"middle\" font-family=\"'Arial Black', 'Arial Rounded MT Bold', Impact, Arial, sans-serif\" font-weight=\"900\" font-size=\"17\" fill=\"#1E7A44\">$</text> <g><rect x=\"-31\" y=\"-13.6\" width=\"13\" height=\"9.2\" rx=\"3\" fill=\"#D4F7C8\" stroke=\"#1E7A44\" stroke-width=\"1.3\"/> <text x=\"-24.5\" y=\"-6\" text-anchor=\"middle\" font-family=\"'Arial Black', 'Arial Rounded MT Bold', Impact, Arial, sans-serif\" font-weight=\"900\" font-size=\"8.2\" fill=\"#1E7A44\">50</text></g><g><rect x=\"18\" y=\"-13.6\" width=\"13\" height=\"9.2\" rx=\"3\" fill=\"#D4F7C8\" stroke=\"#1E7A44\" stroke-width=\"1.3\"/> <text x=\"24.5\" y=\"-6\" text-anchor=\"middle\" font-family=\"'Arial Black', 'Arial Rounded MT Bold', Impact, Arial, sans-serif\" font-weight=\"900\" font-size=\"8.2\" fill=\"#1E7A44\">50</text></g><g><rect x=\"-31\" y=\"4.9\" width=\"13\" height=\"9.2\" rx=\"3\" fill=\"#D4F7C8\" stroke=\"#1E7A44\" stroke-width=\"1.3\"/> <text x=\"-24.5\" y=\"12.5\" text-anchor=\"middle\" font-family=\"'Arial Black', 'Arial Rounded MT Bold', Impact, Arial, sans-serif\" font-weight=\"900\" font-size=\"8.2\" fill=\"#1E7A44\">50</text></g><g><rect x=\"18\" y=\"4.9\" width=\"13\" height=\"9.2\" rx=\"3\" fill=\"#D4F7C8\" stroke=\"#1E7A44\" stroke-width=\"1.3\"/> <text x=\"24.5\" y=\"12.5\" text-anchor=\"middle\" font-family=\"'Arial Black', 'Arial Rounded MT Bold', Impact, Arial, sans-serif\" font-weight=\"900\" font-size=\"8.2\" fill=\"#1E7A44\">50</text></g></g> <path d=\"M37 51 l-3 -2.5 M37.5 61.5 l-3.5 2 M45 64.5 l0 4\" stroke=\"#FFD23F\" stroke-width=\"2.4\" stroke-linecap=\"round\"/> <g transform=\"translate(46 57) rotate(-50)\"> <path d=\"M-1 0 L7 -1.6 L7 1.6 Z\" fill=\"#E4E8F0\" stroke=\"#2A1B4A\" stroke-width=\"1.6\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <rect x=\"6\" y=\"-5\" width=\"15\" height=\"10\" rx=\"4.5\" fill=\"#C9CFDB\" stroke=\"#2A1B4A\" stroke-width=\"2.6\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M10 -4.6 V4.6 M13.5 -4.8 V4.8 M17 -4.6 V4.6\" stroke=\"#2A1B4A\" stroke-width=\"1.3\"/> <path d=\"M8 -2.8 H19\" stroke=\"#FFFFFF\" stroke-width=\"1.6\" stroke-linecap=\"round\" opacity=\".9\"/> <path d=\"M20 -3.6 L34 -2.4 L34 2.4 L20 3.6 Z\" fill=\"#E8412F\" stroke=\"#2A1B4A\" stroke-width=\"2.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M22 -1.7 L32 -1\" stroke=\"#FF8A78\" stroke-width=\"1.3\" stroke-linecap=\"round\"/> <path d=\"M31 -1 C34 -9 41 -15.5 47 -14 C52 -12.6 53 -6 50 -1 Z\" fill=\"#E8412F\" stroke=\"#2A1B4A\" stroke-width=\"2.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M31 1 C34 9 41 15.5 47 14 C52 12.6 53 6 50 1 Z\" fill=\"#C92E22\" stroke=\"#2A1B4A\" stroke-width=\"2.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M30 0 C36 -4 46 -4 53 0 C46 4 36 4 30 0 Z\" fill=\"#F25A44\" stroke=\"#2A1B4A\" stroke-width=\"2.2\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <circle cx=\"53\" cy=\"0\" r=\"2.8\" fill=\"#C92E22\" stroke=\"#2A1B4A\" stroke-width=\"2\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/> <path d=\"M38 -9 C40.5 -11.6 43.5 -12.4 46 -11.6\" fill=\"none\" stroke=\"#FF9F8F\" stroke-width=\"1.6\" stroke-linecap=\"round\"/> <path d=\"M35 -1 H47\" stroke=\"#FFB2A6\" stroke-width=\"1.2\" stroke-linecap=\"round\"/></g> </svg>";

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
