// Local stand-in for Supabase, for testing only.
//  - serves the static site
//  - POST /rpc/<fn>   runs a database function as the user in the x-dev-user header
//  - POST /dev/login  creates a fake user (email/name) and returns its id
//  - runs the game engine loop (what pg_cron + the edge function do in production)
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineAction } from '../supabase/functions/_shared/runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.env.PORT || 8787);
const DB = process.env.DEVDB || 'econ';
const PSQL = ['-h', '/var/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-tAXq', '-v', 'ON_ERROR_STOP=1'];

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (Array.isArray(v)) {
    const inner = '{' + v.map((x) => '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
    return `'${inner.replace(/'/g, "''")}'`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

export function sql(query, user = null) {
  const args = [...PSQL];
  if (user) args.push('-c', `set request.jwt.claim.sub = '${String(user).replace(/'/g, '')}'`);
  args.push('-c', query);
  return new Promise((resolve, reject) => {
    execFile('psql', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const m = /ERROR:\s+([\s\S]*?)(\nCONTEXT:|\nLINE|\n$|$)/.exec(stderr);
        reject(new Error(m ? m[1].trim() : stderr || err.message));
      } else resolve(stdout.trim());
    });
  });
}

export async function rpc(fn, args = {}, user = null) {
  if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function');
  const params = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
  const out = await sql(`select to_json(public.${fn}(${params}))`, user);
  return out === '' ? null : JSON.parse(out);
}

const db = { rpc: (fn, args) => rpc(fn, args) };

// Engine loop: drain the local queue and run the timer check, like pg_cron would.
let busy = false;
export async function engineTick() {
  if (busy) return; busy = true;
  try {
    await sql('select public.tick()');
    const rows = await sql(`with q as (delete from private.engine_queue returning session_id, action, id) select coalesce(json_agg(q order by id), '[]') from q`);
    for (const job of JSON.parse(rows || '[]')) {
      try { await runEngineAction(db, job.session_id, job.action); }
      catch (e) { await rpc('engine_error', { p_session: job.session_id, p_message: `${job.action}: ${e.message}` }); console.error('engine', e.message); }
    }
  } finally { busy = false; }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

export function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST') {
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (url.pathname === '/dev/login') {
          const email = String(body.email || '').toLowerCase().trim();
          if (!email.includes('@')) return send(400, { error: 'Enter an email' });
          let id = await sql(`select id from auth.users where email = ${lit(email)}`);
          if (!id) id = await sql(`insert into auth.users(email, raw_user_meta_data) values (${lit(email)}, ${lit({ full_name: body.name || null })}) returning id`);
          return send(200, { id });
        }
        if (url.pathname === '/dev/translate') {
          // Fake translator for local testing: picks a house strategy by keyword.
          const d = String(body.description || '').toLowerCase();
          const code = d.includes('always defect') ? 'function strategy() { return "D"; }'
            : d.includes('loop') ? 'function strategy() { while (true) {} }'
            : 'function strategy(myMoves, theirMoves, round) {\n  // copy their last move\n  if (round === 1) return "C";\n  return theirMoves[theirMoves.length - 1];\n}';
          await rpc('consume_translation', { p_session: body.session_id }, req.headers['x-dev-user']);
          return send(200, { code, explanation: '1. (Local test translator) ' + (d.includes('always defect') ? 'Always defect.' : 'Cooperate first, then copy their last move.'), assumptions: [] });
        }
        if (url.pathname.startsWith('/rpc/')) {
          const fn = url.pathname.slice(5);
          const data = await rpc(fn, body, req.headers['x-dev-user'] || null);
          if (['submit_decision', 'instructor_control'].includes(fn)) engineTick();
          return send(200, data);
        }
      }
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(SITE, path.normalize(p));
      if (!file.startsWith(SITE)) return send(403, 'no', 'text/plain');
      const data = await readFile(file);
      return send(200, data, MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      return send(e.code === 'ENOENT' ? 404 : 400, { error: e.message });
    }
  });
  server.listen(port);
  const timer = setInterval(() => engineTick().catch((e) => console.error(e.message)), 700);
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
  console.log(`dev server on http://localhost:${PORT}`);
}
