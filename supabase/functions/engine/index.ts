// Game engine edge function. Called only by the database (pg_net) with a shared secret:
//   { action: 'start' | 'advance' | 'finish', session_id }
// Deploy with JWT verification turned OFF (the secret header is the authentication).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runEngineAction } from '../_shared/runner.js';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supa = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const db = {
  async rpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await supa.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: { action?: string; session_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const ok = await db.rpc('engine_secret_ok', { p_secret: req.headers.get('x-engine-secret') }).catch(() => false);
  if (!ok) return json({ error: 'unauthorized' }, 401);
  if (!body.session_id || !body.action) return json({ error: 'missing session_id or action' }, 400);

  try {
    const out = await runEngineAction(db, body.session_id, body.action);
    return json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('engine error', body, message);
    await db.rpc('engine_error', { p_session: body.session_id, p_message: `${body.action}: ${message}` }).catch(() => {});
    return json({ error: message }, 500);
  }
});
