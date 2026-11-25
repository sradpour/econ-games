// Backend access. In production this is Supabase; with DEV_SERVER set it talks to the local test server.
import { CONFIG } from '../config.js';

export const DEV = !!CONFIG.DEV_SERVER;
let supabase = null;
let session = null;           // Supabase auth session
let authListeners = [];

async function client() {
  if (supabase) return supabase;
  // Packed into app.js when the site is published (tools/build.mjs); local test mode never loads it.
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return supabase;
}

// ---------------------------------------------------------------------------
// Auth

const DEV_KEY = 'econ-dev-user';
const devUser = () => { try { return JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch { return null; } };

export async function initAuth(onChange) {
  authListeners.push(onChange);
  if (DEV) { onChange(devUser()); return; }
  const sb = await client();
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_event, s) => {
    const changed = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
    session = s;
    if (changed) authListeners.forEach((fn) => fn(s?.user ?? null));
  });
  // Clean the ?code= left over from the Google redirect
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
  onChange(session?.user ?? null);
}

// Google sends people back to the site's address without the #/… part, so remember where they were going
// (for example a game link from their instructor) and return there after signing in.
const RETURN_KEY = 'econ-return-to';
export function takeReturnHash() {
  try { const h = localStorage.getItem(RETURN_KEY); localStorage.removeItem(RETURN_KEY); return h || ''; } catch { return ''; }
}

export async function signInWithGoogle() {
  try { if (/^#\/play\//.test(location.hash)) localStorage.setItem(RETURN_KEY, location.hash); else localStorage.removeItem(RETURN_KEY); } catch { /* storage blocked */ }
  const sb = await client();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function devSignIn(email, name) {
  const res = await fetch('/dev/login', { method: 'POST', body: JSON.stringify({ email, name }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  const user = { id: data.id, email };
  localStorage.setItem(DEV_KEY, JSON.stringify(user));
  authListeners.forEach((fn) => fn(user));
}

export async function signOut() {
  if (DEV) { localStorage.removeItem(DEV_KEY); authListeners.forEach((fn) => fn(null)); return; }
  const sb = await client();
  await sb.auth.signOut();
}

// ---------------------------------------------------------------------------
// Database functions

export async function rpc(fn, args = {}) {
  if (DEV) {
    const res = await fetch(`/rpc/${fn}`, {
      method: 'POST', body: JSON.stringify(args), headers: { 'x-dev-user': devUser()?.id || '' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(cleanError(data.error));
    return data;
  }
  const sb = await client();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data;
}

function cleanError(m) {
  if (!m) return 'Something went wrong.';
  if (/JWT|not authenticated|Please sign in/i.test(m)) return 'Your sign-in expired. Please sign in again.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Check your internet and try again.';
  return m;
}

export async function translateStrategy(body) {
  if (DEV) {
    const res = await fetch('/dev/translate', { method: 'POST', body: JSON.stringify(body), headers: { 'x-dev-user': devUser()?.id || '' } });
    const data = await res.json();
    if (!res.ok) throw new Error(cleanError(data.error));
    return data;
  }
  const sb = await client();
  const ctrl = new AbortController();
  const TIMEOUT = 'No answer from the AI translator after 90 seconds. Google may be slow right now; try again in a minute.';
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new Error(TIMEOUT)); }, 90000); });
  let data, error;
  try {
    ({ data, error } = await Promise.race([sb.functions.invoke('translate-strategy', { body, signal: ctrl.signal }), timeout]));
  } catch (e) {
    throw new Error(e.message === TIMEOUT ? TIMEOUT : cleanError(e.message));
  } finally { clearTimeout(timer); }
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data;
}

// ---------------------------------------------------------------------------

// Live updates on the game's private channel "session:<id>" (only people who can see the game may listen;
// only the database sends). Two kinds of message:
//   changed: the game itself changed (a round started or ended, settings, teams) -> reload.
//            Students spread their reloads over `spread` ms so 30 screens don't hit the server in the same instant.
//   saved:   someone saved -> onSaved(payload, reload) decides (the saver's team reloads; others just update counts).
// A slow safety poll catches anything missed; it speeds up if the channel can't connect.
export function watchSession(sessionId, { onChange, onSaved = null, spread = 1500, pollMs = 20000 }) {
  let stopped = false;
  let channel = null;
  let pollTimer = null;
  let pending = null;
  let healthy = false;
  let subscribedOnce = false;

  // Schedule one reload within maxDelay ms; an earlier one already scheduled covers it.
  const reload = (maxDelay = 0) => {
    if (stopped) return;
    const delay = Math.random() * maxDelay;
    const at = Date.now() + delay;
    if (pending && pending.at <= at) return;
    if (pending) clearTimeout(pending.t);
    pending = { at, t: setTimeout(() => { pending = null; if (!stopped) onChange(); }, delay) };
  };
  const schedulePoll = () => {
    const ms = DEV ? 1000 : healthy ? pollMs * (0.75 + Math.random() * 0.5) : 6000;
    pollTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') reload(DEV ? 0 : 500);
      schedulePoll();
    }, ms);
  };
  const onVisible = () => { if (document.visibilityState === 'visible') reload(500); };
  const onOnline = () => reload(spread);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  schedulePoll();

  if (!DEV) {
    client().then(async (sb) => {
      if (stopped) return;
      try {
        const { data } = await sb.auth.getSession();
        if (data.session) await sb.realtime.setAuth(data.session.access_token);
      } catch { /* falls back to polling */ }
      if (stopped) return;
      channel = sb.channel(`session:${sessionId}`, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, () => reload(spread))
        .on('broadcast', { event: 'saved' }, (msg) => { if (onSaved) onSaved(msg?.payload || {}, reload); else reload(spread); })
        .subscribe((status) => {
          const was = healthy;
          healthy = status === 'SUBSCRIBED';
          if (healthy && !was) {
            if (subscribedOnce) reload(spread); // back after a dropped connection: catch up
            subscribedOnce = true;
          }
        });
    }).catch(() => { /* polling continues */ });
  }
  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    if (pending) clearTimeout(pending.t);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    if (channel && supabase) supabase.removeChannel(channel);
  };
}
