// One gradebook file for a whole class: a row per student, a column per game.

const UNIT = {
  competitive: 'profit $', monopolistic: 'profit $', oligopoly: 'profit $', monopoly: 'profit $',
  pd_live: 'avg points per round', pd_tournament: 'points', public_goods: 'earnings $', ultimatum: 'points',
  commons: 'earnings $', costs: 'score %',
};

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const r2 = (v) => Math.round(Number(v) * 100) / 100;

/**
 * Turns export_class output into { columns, rows } for downloadCsv.
 * A game's score is the student's total, or the average per round for the repeated prisoner's dilemma (that game ranks by average).
 * Blank = never joined that game; 0 = joined but earned nothing.
 */
export function classGradebook(ex) {
  const games = ex.games || [];
  const used = new Set();
  const colOf = {};
  for (const g of games) {
    let col = `${g.title} (${shortDate(g.created_at)}, ${UNIT[g.game_type] || 'score'})${g.status === 'finished' ? '' : ' [still open]'}`;
    for (let k = 2; used.has(col); k++) col = `${col} #${k}`;
    used.add(col);
    colOf[g.id] = col;
  }
  const byAvg = Object.fromEntries(games.map((g) => [g.id, g.ranked_by === 'average' || g.game_type === 'pd_live']));
  const score = {};
  for (const s of ex.scores || []) {
    (score[s.user_id] ||= {})[s.session_id] = byAvg[s.session_id] ? (s.rounds ? r2(s.total / s.rounds) : 0) : r2(s.total);
  }
  const rows = (ex.students || []).map((st) => {
    const mine = score[st.user_id] || {};
    const row = { student_name: st.name || '', student_id: st.student_id || '', email: st.email, still_in_class: st.in_class ? 'yes' : 'no',
      games_played: Object.keys(mine).length };
    for (const g of games) row[colOf[g.id]] = g.id in mine ? mine[g.id] : '';
    return row;
  });
  return { columns: ['student_name', 'student_id', 'email', 'still_in_class', 'games_played', ...games.map((g) => colOf[g.id])], rows };
}
