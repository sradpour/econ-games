// Public connection details. The publishable key is safe to publish: every request is checked in the database.
export const CONFIG = {
  SUPABASE_URL: 'https://sbhalwcucckiposfrdjv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_GDinV9mtUdgwW59IlvxRAQ_fc2HLnoe',
  SITE_NAME: 'Econ Games',
  // Local testing only: talks to tools/devserver.mjs instead of Supabase.
  DEV_SERVER: ['localhost', '127.0.0.1'].includes(location.hostname),
};
