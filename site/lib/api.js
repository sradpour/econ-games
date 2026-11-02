// Backend access. In production this is Supabase; with DEV_SERVER set it talks to the local test server.
import { CONFIG } from '../config.js';

export const DEV = !!CONFIG.DEV_SERVER;
let supabase = null;
let session = null;           // Supabase auth session
let authListeners = [];

async function client() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
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

export async function signInWithGoogle() {
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
// Live updates: refetch whenever the session row's version changes

export function watchSession(sessionId, onChange) {
  let stopped = false;
  let channel = null;
  let poll = null;
  const fire = () => { if (!stopped) onChange(); };
  const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', fire);
  if (DEV) {
    poll = setInterval(fire, 1000);
  } else {
    poll = setInterval(fire, 8000); // safety net if a realtime message is missed
    client().then((sb) => {
      if (stopped) return;
      channel = sb.channel(`session-${sessionId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, fire)
        .subscribe();
    });
  }
  return () => {
    stopped = true;
    clearInterval(poll);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', fire);
    if (channel && supabase) supabase.removeChannel(channel);
  };
}
