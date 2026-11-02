// Full simulated classes against a real local Postgres, using the same engine runner as production.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

process.env.DEVDB = 'econ_it';
const { sql, rpc, engineTick } = await import('../tools/devserver.mjs');

const PSQL = ['-h', '/var/tmp', '-p', '5433', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
const users = {};

async function login(email, name) {
  let id = await sql(`select id from auth.users where email = '${email}'`);
  if (!id) id = await sql(`insert into auth.users(email, raw_user_meta_data) values ('${email}', '{"full_name": "${name}"}') returning id`);
  users[email] = id;
  return id;
}
const as = (email) => (fn, args = {}) => rpc(fn, args, users[email]);
const fails = async (p, re) => { await assert.rejects(p, re); };

async function drain(times = 3) { for (let i = 0; i < times; i++) await engineTick(); }

before(async () => {
  execFileSync('psql', [...PSQL, '-c', 'drop database if exists econ_it', '-c', 'create database econ_it']);
  execFileSync('psql', [...PSQL, '-d', 'econ_it', '-f', 'tests/stubs.sql']);
  execFileSync('psql', [...PSQL, '-d', 'econ_it', '-f', 'supabase/migrations/0001_schema.sql']);
  execFileSync('psql', [...PSQL, '-d', 'econ_it', '-f', 'supabase/migrations/0003_admin_management.sql']);
  await sql(`insert into private.app_config(key, value) values ('engine_url', 'local-queue') on conflict (key) do update set value = excluded.value`);
});

let classId, code;
const students = Array.from({ length: 30 }, (_, i) => `student${i + 1}@go.stockton.edu`);

test('admin is created automatically and can make a class', async () => {
  await login('siavash.radpour@stockton.edu', 'Siavash Radpour');
  const me = await as('siavash.radpour@stockton.edu')('get_me');
  assert.equal(me.is_admin, true);
  assert.equal(me.is_instructor, true);
  const c = await as('siavash.radpour@stockton.edu')('create_class', { p_name: 'ECON 1200', p_domains: ['go.stockton.edu'] });
  classId = c.id; code = c.join_code;
  assert.match(code, /^[A-Z2-9]{6}$/);
});

test('teacher domains auto-approve; others wait for approval', async () => {
  await login('colleague@stockton.edu', 'A Colleague');
  assert.equal((await as('colleague@stockton.edu')('request_instructor')).instructor_status, 'approved');
  await login('someone@gmail.com', 'Outsider');
  assert.equal((await as('someone@gmail.com')('request_instructor')).instructor_status, 'pending');
  await fails(as('someone@gmail.com')('create_class', { p_name: 'x', p_domains: [] }), /Instructor access required/);
});

test('students sign in, add student ID, join with the class code; wrong domain is refused', async () => {
  for (const [i, e] of students.entries()) {
    await login(e, `Student ${i + 1}`);
    await as(e)('complete_profile', { p_full_name: `Student ${i + 1}`, p_student_id: `Z${1000 + i}` });
    await as(e)('join_class', { p_code: code.toLowerCase() });
  }
  await fails(as('someone@gmail.com')('join_class', { p_code: code }), /only accepts go.stockton.edu/);
  const roster = await as('siavash.radpour@stockton.edu')('class_roster', { p_class: classId });
  assert.equal(roster.length, 31); // 30 students + instructor
  assert.equal(roster.find((r) => r.email === students[0]).student_id, 'Z1000');
});

test('other teachers cannot see this class or its games', async () => {
  await fails(as('colleague@stockton.edu')('class_roster', { p_class: classId }), /Not your class/);
  const s = await as('siavash.radpour@stockton.edu')('create_session', { p_class: classId, p_game_type: 'competitive', p_title: 'Wheat market', p_config: {} });
  await fails(as('colleague@stockton.edu')('instructor_state', { p_session: s.id }), /Not your game/);
  await fails(as('someone@gmail.com')('get_state', { p_session: s.id }), /Game not found/);
  await as('siavash.radpour@stockton.edu')('delete_session', { p_session: s.id });
});

async function runIndividualGame(gameType, config, decide, nStudents = 30) {
  const T = as('siavash.radpour@stockton.edu');
  const s = await T('create_session', { p_class: classId, p_game_type: gameType, p_title: gameType, p_config: config });
  const players = students.slice(0, nStudents);
  for (const e of players) { await as(e)('join_session', { p_session: s.id }); await as(e)('pass_check', { p_session: s.id }); }
  await T('instructor_control', { p_session: s.id, p_action: 'start' });
  await drain();
  let guard = 0;
  for (;;) {
    const st = await T('instructor_state', { p_session: s.id });
    assert.equal(st.last_error, null, st.last_error);
    if (st.session.status === 'finished') return { id: s.id, final: st };
    for (const e of players) {
      const g = await as(e)('get_state', { p_session: s.id });
      if (!g.me.required) continue;
      const d = decide(e, g);
      if (d) await as(e)('submit_decision', { p_session: s.id, p_payload: d });
    }
    await drain();
    if (++guard > 200) throw new Error('game did not finish');
  }
}

test('perfect competition: 30 students, 3 rounds, all submit so rounds end early', async () => {
  const { final } = await runIndividualGame('competitive', { rounds: 3 }, () => ({ participate: true, price: 8, quantity: 60 }));
  const results = final.results;
  assert.equal(results.length, 90);
  assert.ok(results.every((r) => r.payload.sold > 50));
  assert.equal(final.outputs.benchmarks.price, 8);
  assert.equal(final.outputs.final.leaderboard.length, 30);
});

test('students only see their own results and the public leaderboard', async () => {
  const T = as('siavash.radpour@stockton.edu');
  const s = await T('create_session', { p_class: classId, p_game_type: 'monopoly', p_title: 'Monopoly', p_config: { rounds: 1 } });
  for (const e of students.slice(0, 4)) { await as(e)('join_session', { p_session: s.id }); await as(e)('pass_check', { p_session: s.id }); }
  await T('instructor_control', { p_session: s.id, p_action: 'start' });
  await drain();
  await as(students[0])('submit_decision', { p_session: s.id, p_payload: { price: 12.8, quantity: 36 } });
  await as(students[1])('submit_decision', { p_session: s.id, p_payload: { price: 5, quantity: 70 } });
  await T('instructor_control', { p_session: s.id, p_action: 'end_stage' });
  await drain();
  const g = await as(students[0])('get_state', { p_session: s.id });
  assert.equal(g.session.status, 'finished');
  assert.equal(g.results.length, 1);
  assert.equal(g.results[0].price, 12.8);
  assert.ok(g.public[0].leaderboard.length === 4);
  assert.equal(g.public[0].prices, undefined);
  assert.ok(g.all_results.length === 4, 'prices revealed at the end');
  await fails(as(students[0])('instructor_state', { p_session: s.id }), /Not your game/);
  await fails(as(students[0])('export_session', { p_session: s.id }), /Not your game/);
});

test('oligopoly in teams: create/join/leave/rename, lock at start, captain rotation, backup rule', async () => {
  const T = as('siavash.radpour@stockton.edu');
  const s = await T('create_session', { p_class: classId, p_game_type: 'oligopoly', p_title: 'Airlines', p_config: { rounds: 2, team_size: 4, round_seconds: 120 } });
  const ps = students.slice(0, 13);
  for (const e of ps) await as(e)('join_session', { p_session: s.id });
  const a = await as(ps[0])('create_team', { p_session: s.id, p_name: 'Price Busters' });
  await fails(as(ps[1])('create_team', { p_session: s.id, p_name: 'price busters' }), /taken/);
  await as(ps[1])('join_team', { p_team: a.team_id });
  await as(ps[2])('join_team', { p_team: a.team_id });
  await as(ps[3])('join_team', { p_team: a.team_id });
  await fails(as(ps[4])('join_team', { p_team: a.team_id }), /full/);
  await as(ps[3])('leave_team', { p_session: s.id });
  const b = await as(ps[4])('create_team', { p_session: s.id, p_name: 'Monopoly Money' });
  await as(ps[4])('rename_team', { p_team: b.team_id, p_name: 'Cartel-Free Zone' });
  let g = await as(ps[5])('get_state', { p_session: s.id });
  assert.deepEqual(g.teams.map((t) => t.name), ['Price Busters', 'Cartel-Free Zone']);
  // remaining 8 players have no team; the start fills existing teams then creates new ones
  for (const e of ps) await as(e)('pass_check', { p_session: s.id });
  await T('instructor_control', { p_session: s.id, p_action: 'start' });
  await drain();
  const st = await T('instructor_state', { p_session: s.id });
  assert.equal(st.session.status, 'running');
  assert.ok(st.players.every((p) => p.team_id));
  const sizes = st.teams.map((t) => t.members.length);
  assert.ok(sizes.every((n) => n >= 1 && n <= 4));
  assert.equal(sizes.reduce((x, y) => x + y, 0), 13);
  await fails(as(ps[0])('leave_team', { p_session: s.id }), /locked/);

  // Captain rule: round 1 captain of Price Busters is the creator
  g = await as(ps[1])('get_state', { p_session: s.id });
  assert.equal(g.me.captain_name, 'Student 1');
  await fails(as(ps[1])('submit_decision', { p_session: s.id, p_payload: { price: 11 } }), /captain/);
  await as(ps[0])('submit_decision', { p_session: s.id, p_payload: { price: 11 } });
  g = await as(ps[1])('get_state', { p_session: s.id });
  assert.equal(g.me.decision.price, 11);
  assert.equal(g.me.decision_by, 'Student 1');

  // Backup: in the last 30 seconds anyone on a team that has not submitted can step in
  await sql(`update public.sessions set stage_ends_at = now() + interval '20 seconds' where id = '${s.id}'`);
  const other = st.teams.find((t) => t.name === 'Cartel-Free Zone');
  const nonCaptain = st.players.find((p) => p.team_id === other.id && p.name !== other.captain);
  if (nonCaptain) {
    const email = students[Number(nonCaptain.name.split(' ')[1]) - 1];
    await as(email)('submit_decision', { p_session: s.id, p_payload: { price: 12 } });
  }
  await T('instructor_control', { p_session: s.id, p_action: 'end_stage' });
  await drain();
  g = await as(ps[0])('get_state', { p_session: s.id });
  assert.equal(g.session.round_no, 2);
  assert.equal(g.me.captain_name, 'Student 2'); // rotated
  assert.ok(g.public[0].leaderboard.length >= 3);
  const mine = g.results[0];
  assert.equal(mine.price, 11);
  assert.ok(mine.sold > 0);
});

test('pause, resume and extend keep the timer consistent', async () => {
  const T = as('siavash.radpour@stockton.edu');
  const s = await T('create_session', { p_class: classId, p_game_type: 'competitive', p_title: 'Timer', p_config: { rounds: 2, round_seconds: 180 } });
  await as(students[0])('join_session', { p_session: s.id });
  await T('instructor_control', { p_session: s.id, p_action: 'start' });
  await drain();
  await T('instructor_control', { p_session: s.id, p_action: 'pause' });
  let st = await T('instructor_state', { p_session: s.id });
  assert.equal(st.session.status, 'paused');
  assert.ok(st.session.paused_remaining_ms > 170000);
  await fails(as(students[0])('submit_decision', { p_session: s.id, p_payload: { price: 8, quantity: 10 } }), /check|closed/);
  await T('instructor_control', { p_session: s.id, p_action: 'extend', p_seconds: 60 });
  await T('instructor_control', { p_session: s.id, p_action: 'resume' });
  st = await T('instructor_state', { p_session: s.id });
  const left = (new Date(st.session.stage_ends_at) - new Date(st.server_now)) / 1000;
  assert.ok(left > 230 && left <= 241, `left=${left}`);
  // A timer that runs out ends the round automatically (tick)
  await sql(`update public.sessions set stage_ends_at = now() - interval '1 second' where id = '${s.id}'`);
  await drain();
  st = await T('instructor_state', { p_session: s.id });
  assert.equal(st.session.round_no, 2);
  assert.equal(st.results[0].payload.participated, false); // didn't pass the check, sat out
  await T('instructor_control', { p_session: s.id, p_action: 'finish' });
  await drain();
  st = await T('instructor_state', { p_session: s.id });
  assert.equal(st.session.status, 'finished');
  assert.ok(st.outputs.final);
});

test('repeated prisoner\'s dilemma: anonymous pairs, random length matches, finishes', async () => {
  const { final } = await runIndividualGame('pd_live', { matches: 2, min_rounds: 10, max_rounds: 12 },
    (e, g) => ({ move: Number(e.match(/\d+/)[0]) % 3 === 0 ? 'D' : 'C' }), 9);
  const ends = final.public.filter((p) => p.match_over);
  assert.equal(ends.length, 2);
  assert.ok(final.outputs.final.ranked_by === 'average');
  const g = await as(students[0])('get_state', { p_session: final.session.id });
  assert.ok(!JSON.stringify(g).includes('student'), 'no emails leak to students');
});

test('public goods with strangers matching and punishment phase', async () => {
  const { final } = await runIndividualGame('public_goods', { rounds_no_punish: 2, rounds_punish: 2, matching: 'strangers' },
    (e, g) => (g.session.stage === 'contribute'
      ? { contribution: e.startsWith('student1') ? 0 : 15 }
      : { points: Object.fromEntries((g.assignment.others || []).filter((o) => o.contribution === 0).map((o) => [o.label, 2])) }), 12);
  const r4 = final.results.filter((r) => r.round_no === 4);
  assert.ok(r4.some((r) => r.payload.points_received > 0));
  assert.equal(final.public.length, 4);
});

test('ultimatum game: offers, responses, byes', async () => {
  const { final } = await runIndividualGame('ultimatum', { rounds: 2 },
    (e, g) => (g.session.stage === 'offer' ? { offer: 3 } : { accept: g.assignment.offer >= 3 }), 7);
  const props = final.results.filter((r) => r.payload.role === 'proposer');
  assert.ok(props.every((r) => r.payload.points === 7));
  assert.ok(final.results.some((r) => r.payload.role === 'bye'));
});

test('strategy tournament: save, rate limit hook, results saved by instructor', async () => {
  const T = as('siavash.radpour@stockton.edu');
  const s = await T('create_session', { p_class: classId, p_game_type: 'pd_tournament', p_title: 'Axelrod', p_config: {} });
  for (const e of students.slice(0, 6)) await as(e)('join_session', { p_session: s.id });
  const t1 = await as(students[0])('create_team', { p_session: s.id, p_name: 'Nice Guys' });
  await as(students[1])('join_team', { p_team: t1.team_id });
  await T('instructor_control', { p_session: s.id, p_action: 'start' });
  await drain();
  await as(students[0])('consume_translation', { p_session: s.id });
  await as(students[0])('save_strategy', { p_session: s.id, p_description: 'tit for tat', p_code: 'function strategy(){return "C"}', p_explanation: '1. C', p_submit: true });
  const g = await as(students[1])('get_state', { p_session: s.id });
  assert.equal(g.strategy.submitted, true);
  assert.equal(g.strategy.translations_used, 1);
  const st = await T('instructor_state', { p_session: s.id });
  const ranking = st.teams.map((t, i) => ({ team_id: t.id, name: t.name, total: 100 - i, rank: i + 1 }));
  await T('instructor_save_tournament', { p_session: s.id, p_results: { ranking, matches: [] } });
  const g2 = await as(students[0])('get_state', { p_session: s.id });
  assert.equal(g2.session.status, 'finished');
  assert.equal(g2.outputs.tournament.ranking.length, st.teams.length);
});

test('grading export has one row per student per round with student IDs', async () => {
  const T = as('siavash.radpour@stockton.edu');
  const home = await T('instructor_home');
  const comp = home.classes[0].sessions.find((x) => x.game_type === 'competitive' && x.status === 'finished' && x.players === 30);
  const ex = await T('export_session', { p_session: comp.id });
  assert.equal(ex.rows.length, 90);
  assert.ok(ex.rows.every((r) => r.student_id && r.email.endsWith('@go.stockton.edu')));
  assert.equal(ex.students.length, 30);
});

test('engine functions are not callable by students', async () => {
  const fns = ['engine_load', 'engine_apply', 'tick', 'engine_get_config'];
  for (const fn of fns) {
    const ok = await sql(`select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where proname = '${fn}'`);
    assert.equal(ok, 'f', fn);
  }
  const st = await sql(`select has_function_privilege('authenticated', 'public.get_state(uuid)', 'execute')`);
  assert.equal(st, 't');
});

test('admin can list and delete users and classes; others cannot', async () => {
  const A = as('siavash.radpour@stockton.edu');
  await login('zz-junk@go.stockton.edu', 'Junk Account');
  await as('zz-junk@go.stockton.edu')('join_class', { p_code: code });
  const found = await A('admin_list_users', { p_search: 'junk' });
  assert.equal(found.length, 1);
  assert.equal(found[0].classes, 1);
  await fails(as(students[0])('admin_list_users', { p_search: '' }), /Admins only/);
  await fails(as(students[0])('admin_delete_user', { p_user: found[0].id }), /Admins only/);
  await fails(A('admin_delete_user', { p_user: users['siavash.radpour@stockton.edu'] }), /own account/);
  await A('admin_delete_user', { p_user: found[0].id });
  assert.equal((await A('admin_list_users', { p_search: 'junk' })).length, 0);
  assert.equal(await sql(`select count(*) from auth.users where email = 'zz-junk@go.stockton.edu'`), '0');
  // classes
  await login('colleague@stockton.edu', 'A Colleague');
  const cc = await as('colleague@stockton.edu')('create_class', { p_name: 'Colleague Class', p_domains: [] });
  const all = await A('admin_list_classes');
  assert.ok(all.some((c) => c.name === 'Colleague Class' && c.instructor === 'A Colleague'));
  await fails(as('colleague@stockton.edu')('admin_delete_class', { p_class: cc.id }), /Admins only/);
  await A('admin_delete_class', { p_class: cc.id });
  assert.ok(!(await A('admin_list_classes')).some((c) => c.id === cc.id));
});
