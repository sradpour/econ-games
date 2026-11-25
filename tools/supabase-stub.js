// Stand-in for @supabase/supabase-js, used only by `node tools/build.mjs --stub` for local checks.
export function createClient() { throw new Error('Supabase is not available in a local stub build.'); }
