// Turns a team's plain-English prisoner's dilemma strategy into a small JavaScript function using Gemini.
// Called from the browser by a signed-in student: POST { session_id, description, previous_code?, feedback? }
// Deploy with JWT verification ON.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `You translate a student's plain-English strategy for the repeated prisoner's dilemma into JavaScript.

Game: each round both players choose "C" (cooperate) or "D" (defect). Payoffs per round:
both C = 3 each; both D = 1 each; D against C = 5 for the defector, 0 for the cooperator.
A match lasts an unknown number of rounds (between 10 and 20); players never know which round is last.

Write exactly one function with this signature:
  function strategy(myMoves, theirMoves, round) { ... }
- myMoves, theirMoves: arrays of "C"/"D" for all previous rounds of the current match (empty in round 1).
- round: the current round number, starting at 1.
- It must return the string "C" or "D".
- Variables declared outside the function persist between rounds of the same match (use them for memory if needed).
- Math.random() is allowed for randomness. No other globals, no network, no DOM, no imports, no async code.
- Keep it short, readable, and commented so a non-programmer could follow it.
- Implement the student's intent faithfully. Do NOT improve their strategy. If something is ambiguous, pick the most natural reading and list it under "assumptions".
- If the description is not a strategy for this game, return code that always cooperates and explain the problem in "assumptions".

Respond with JSON only: {"code": "...", "explanation": "...", "assumptions": ["..."]}
"explanation" is a short numbered list in plain English (no code words) describing exactly what the function does, so the student can check it matches what they meant.`;

async function callGemini(key: string, model: string, prompt: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, text };
  const data = JSON.parse(text);
  const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  return { ok: true as const, out };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  let body: { session_id?: string; description?: string; previous_code?: string; feedback?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const description = (body.description ?? '').trim();
  if (!body.session_id || description.length < 5) return json({ error: 'Describe your strategy first.' }, 400);
  if (description.length > 3000) return json({ error: 'Please keep the description under 3000 characters.' }, 400);

  // Check membership and rate limit as the signed-in student
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { error: limitError } = await asUser.rpc('consume_translation', { p_session: body.session_id });
  if (limitError) return json({ error: limitError.message }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const key = Deno.env.get('GEMINI_API_KEY') ?? (await service.rpc('engine_get_config', { p_key: 'gemini_api_key' })).data;
  if (!key) return json({ error: 'The instructor has not set up the AI translator yet (missing Gemini key).' }, 503);
  const configured = (await service.rpc('engine_get_config', { p_key: 'gemini_model' })).data as string | null;
  const models = configured ? [configured, ...FALLBACK_MODELS] : FALLBACK_MODELS;

  let prompt = `Student's strategy:\n"""\n${description}\n"""`;
  if (body.previous_code && body.feedback) {
    prompt += `\n\nYour previous translation was:\n${body.previous_code}\n\nThe student says it is wrong because:\n"""\n${body.feedback}\n"""\nFix it.`;
  }

  let lastError = '';
  for (const model of models) {
    const r = await callGemini(key, model, prompt);
    if (!r.ok) {
      lastError = `${model}: ${r.status}`;
      if (r.status === 404 || r.status === 400) continue; // model name not available, try the next one
      if (r.status === 429) return json({ error: 'The AI translator is busy (free quota). Wait a minute and try again.' }, 429);
      continue;
    }
    try {
      const parsed = JSON.parse(r.out.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
      if (typeof parsed.code !== 'string' || !parsed.code.includes('function strategy')) throw new Error('no function');
      return json({
        code: parsed.code,
        explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String) : [],
        model,
      });
    } catch {
      lastError = `${model}: unreadable answer`;
    }
  }
  return json({ error: `The AI translator could not produce a strategy (${lastError}). Try rephrasing.` }, 502);
});
