// Connects the pure game engine to the database.
// `db.rpc(name, args)` must call a Postgres function with service-role rights and return its result.
import { startGame, resolveStage, finishGame } from './engine.js';

const withRound = (list, roundNo) => (list || []).map((a) => ({ round_no: a.round_no ?? roundNo, team_id: a.team_id, info: a.info }));

export async function runEngineAction(db, sessionId, action, rng = Math.random) {
  const ctx = await db.rpc('engine_load', { p_session: sessionId });
  const s = ctx?.session;
  if (!s) return { ok: false, reason: 'session not found' };
  let patch;

  if (action === 'start') {
    if (s.status !== 'lobby') return { ok: false, reason: 'already started' };
    const teams = await db.rpc('engine_prepare_start', { p_session: sessionId });
    if (!teams || teams.length === 0) throw new Error('No teams or players to start with.');
    const g = startGame(s.game_type, s.config, teams, rng);
    patch = {
      expect: { status: 'lobby', round_no: 0, stage: null },
      team_ids: teams.map((t) => t.id),
      config: g.config,
      state: g.state,
      required: g.open.required,
      assignments: withRound(g.open.assignments, g.open.round_no),
      outputs: g.outputs,
      session: { status: 'running', round_no: g.open.round_no, stage: g.open.stage, seconds: g.open.seconds },
    };
  } else if (action === 'advance') {
    if (!['running', 'paused'].includes(s.status) || !s.stage || s.game_type === 'pd_tournament') {
      return { ok: false, reason: 'nothing to advance' };
    }
    const r = resolveStage({
      gameType: s.game_type, config: s.config, state: ctx.state, round_no: s.round_no, stage: s.stage,
      teams: ctx.teams, decisions: ctx.decisions || {},
    }, rng);
    patch = {
      expect: { status: s.status, round_no: s.round_no, stage: s.stage },
      state: r.state,
      results: r.results,
      round_public: r.round_public,
      assignments: [...withRound(r.assignments, s.round_no), ...(r.open ? withRound(r.open.assignments, r.open.round_no) : [])],
      outputs: r.outputs,
      required: r.open ? r.open.required : [],
      session: r.finished
        ? { status: 'finished', stage: null }
        : { status: 'running', round_no: r.open.round_no, stage: r.open.stage, seconds: r.open.seconds },
    };
  } else if (action === 'finish') {
    if (s.status === 'finished') return { ok: false, reason: 'already finished' };
    const teams = s.status === 'lobby' ? [] : ctx.teams;
    patch = {
      expect: { status: s.status, round_no: s.round_no, stage: s.stage },
      outputs: s.status === 'lobby' ? [] : [finishGame(s.game_type, s.config, ctx.state, teams)],
      required: [],
      session: { status: 'finished', stage: null },
    };
  } else {
    throw new Error(`Unknown action ${action}`);
  }

  const applied = await db.rpc('engine_apply', { p_session: sessionId, p_patch: patch });
  return { ok: !!applied, action, round_no: patch.session?.round_no, stage: patch.session?.stage };
}
