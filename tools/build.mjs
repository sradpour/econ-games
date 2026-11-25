// Packs the site for publishing: all scripts (and the Supabase library) into one minified app.js,
// and a minified styles.css. Output goes to dist/, which GitHub Pages publishes.
// Usage: node tools/build.mjs            (needs esbuild and @supabase/supabase-js installed)
//        node tools/build.mjs --stub     (local check without the Supabase library)
import { build } from 'esbuild';
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'dist');
const stub = process.argv.includes('--stub');

await rm(OUT, { recursive: true, force: true });
// Everything except the source modules, which end up inside app.js
await cp(SITE, OUT, { recursive: true, filter: (src) => !/[\\/]site[\\/](views|lib)([\\/]|$)/.test(src) });

await build({
  entryPoints: [path.join(SITE, 'app.js')],
  outfile: path.join(OUT, 'app.js'),
  bundle: true, format: 'esm', minify: true, sourcemap: 'linked', target: 'es2020',
  legalComments: 'linked',
  alias: stub ? { '@supabase/supabase-js': path.join(ROOT, 'tools', 'supabase-stub.js') } : {},
  logLevel: 'warning',
});
await build({
  entryPoints: [path.join(SITE, 'styles.css')],
  outfile: path.join(OUT, 'styles.css'),
  minify: true, logLevel: 'warning',
});
for (const f of ['app.js', 'styles.css']) console.log(f, Math.round((await stat(path.join(OUT, f))).size / 1024), 'KB');
