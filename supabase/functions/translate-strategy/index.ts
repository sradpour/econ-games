// Turns a team's plain-English prisoner's dilemma strategy into a small JavaScript function using Gemini.
// Called from the browser by a signed-in user: POST { session_id | demo: true, description, previous_code?, feedback? }
// Deploy with JWT verification ON.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Fast, cheap models first. Google retires model names from time to time; if every name here is gone,
// the function asks Google which Flash models this key can use (see discoverModels).
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest', 'gemini-flash-latest'];

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

const PER_MODEL_TIMEOUT_MS = 22000;
const TOTAL_BUDGET_MS = 75000;

// Translation needs little "thinking", and less thinking is much faster.
// Gemini 3 and later take a thinking level; older models took a token budget.
const lowThinking = (model: string) =>
  /^gemini-(2\.|1\.)/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };

async function discoverModels(key: string): Promise<string[]> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = (data?.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => String(m.name).replace(/^models\//, ''))
      .filter((n: string) => /flash/.test(n) && !/(image|tts|audio|live|embedding|preview|exp)/.test(n));
    const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    // Newest first; Flash-Lite before Flash within a version (faster).
    return names.sort((a, b) => version(b) - version(a) || Number(/lite/.test(b)) - Number(/lite/.test(a)));
  } catch {
    return [];
  }
}

async function callGemini(key: string, model: string, prompt: string, thinking: Record<string, unknown> | null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_MODEL_TIMEOUT_MS);
  const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json', temperature: 0.2 };
  if (thinking) generationConfig.thinkingConfig = thinking;
  const started = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });
    const text = await res.text();
    console.log('gemini', model, res.status, `${Date.now() - started}ms`);
    if (!res.ok) {
      let message = text.slice(0, 300);
      try { message = JSON.parse(text)?.error?.message ?? message; } catch { /* not json */ }
      return { ok: false as const, status: res.status, message };
    }
    const data = JSON.parse(text);
    const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!out) return { ok: false as const, status: 502, message: `empty answer (${data?.candidates?.[0]?.finishReason ?? 'no candidates'})` };
    return { ok: true as const, out };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    console.log('gemini', model, aborted ? 'timeout' : 'network error', `${Date.now() - started}ms`);
    return { ok: false as const, status: aborted ? 504 : 502, message: aborted ? `no answer within ${PER_MODEL_TIMEOUT_MS / 1000} s` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  let body: { session_id?: string; demo?: boolean; description?: string; previous_code?: string; feedback?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const description = (body.description ?? '').trim();
  if ((!body.session_id && body.demo !== true) || description.length < 5) return json({ error: 'Describe your strategy first.' }, 400);
  if (description.length > 3000) return json({ error: 'Please keep the description under 3000 characters.' }, 400);

  // Check membership and rate limit as the signed-in user (demo: a small daily allowance per person)
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { error: limitError } = body.session_id
    ? await asUser.rpc('consume_translation', { p_session: body.session_id })
    : await asUser.rpc('consume_demo_translation');
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

  const errors: string[] = [];
  const startedAll = Date.now();
  const queue = [...new Set(models)];
  const tried = new Set<string>();
  let discovered = false;
  let busy = false;
  while (queue.length) {
    const model = queue.shift()!;
    if (tried.has(model)) continue;
    tried.add(model);
    if (Date.now() - startedAll > TOTAL_BUDGET_MS - PER_MODEL_TIMEOUT_MS) break;
    let r = await callGemini(key, model, prompt, lowThinking(model));
    // Some models don't offer the "minimal" level (e.g. Gemini 3.8 Flash): step up to "low", then to the model's default.
    const rejectsThinking = () => !r.ok && r.status === 400 && /thinking/i.test(r.message);
    if (rejectsThinking() && !/^gemini-(2\.|1\.)/.test(model)) r = await callGemini(key, model, prompt, { thinkingLevel: 'low' });
    if (rejectsThinking()) r = await callGemini(key, model, prompt, null);
    if (!r.ok) {
      errors.push(`${model}: ${r.message}`);
      if (r.status === 401 || (r.status === 403 && /API key|permission/i.test(r.message)) || /API key not valid/i.test(r.message)) {
        return json({ error: `Gemini rejected the API key: ${r.message}. Ask your instructor to check the key on the Admin page.` }, 502);
      }
      if (r.status === 429 && !/high demand|overloaded/i.test(r.message)) {
        return json({ error: `The AI translator hit Google's free limit (${r.message}). Wait a minute and try again.` }, 429);
      }
      if (r.status === 503 || r.status === 504 || /high demand|overloaded/i.test(r.message)) busy = true;
      // A retired or unknown model name: ask Google which models this key can use, once.
      if (r.status === 404 && !discovered && queue.every((m) => tried.has(m) || /latest$/.test(m))) {
        discovered = true;
        const found = (await discoverModels(key)).filter((m) => !tried.has(m));
        console.log('discovered models', found.slice(0, 8));
        queue.unshift(...found.slice(0, 4));
      }
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
      errors.push(`${model}: answer was not a usable strategy`);
    }
  }
  console.log('translate failed', errors);
  if (busy) {
    return json({ error: 'Google\'s AI service is busy right now, so the translator could not answer. Wait a minute and press Translate again.', details: errors }, 503);
  }
  return json({ error: `The AI translator could not produce a strategy. Details: ${errors.join(' | ') || 'no models tried'}` }, 502);
});
