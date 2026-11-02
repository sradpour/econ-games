// Sandboxed runner for student prisoner's dilemma strategies.
// Runs in a dedicated Web Worker: no page, no cookies, no storage, and network access is removed below.
// The page also restricts connections with a Content-Security-Policy.
'use strict';

const post = self.postMessage.bind(self);
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches',
  'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator', 'location', 'Request', 'Response', 'FileReaderSync',
  'Notification', 'postMessage', 'close', 'onmessage', 'addEventListener', 'dispatchEvent'];
// Remove network/storage access from the worker scope and everything it inherits from.
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
  for (const k of BLOCKED) {
    if (k === 'onmessage' || k === 'addEventListener') continue; // needed below; overwritten after setup
    try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) { /* ignore */ }
  }
}

function instantiate(code) {
  // Each match gets a fresh copy so variables outside the function act as per-match memory.
  const factory = new Function(`"use strict";\n${code}\n;return (typeof strategy === 'function') ? strategy : null;`);
  const fn = factory();
  if (typeof fn !== 'function') throw new Error('No function named "strategy" was found.');
  return fn;
}

function normalise(move) {
  if (typeof move === 'string') {
    const m = move.trim().toUpperCase();
    if (m === 'C' || m === 'COOPERATE') return 'C';
    if (m === 'D' || m === 'DEFECT') return 'D';
  }
  return null;
}

function payoff(a, b, p) {
  if (a === 'C' && b === 'C') return p.R;
  if (a === 'C' && b === 'D') return p.S;
  if (a === 'D' && b === 'C') return p.T;
  return p.P;
}

function playMatch(codeA, codeB, length, p) {
  const errors = { a: [], b: [] };
  let fa, fb;
  try { fa = instantiate(codeA); } catch (e) { errors.a.push(String(e.message || e)); }
  try { fb = instantiate(codeB); } catch (e) { errors.b.push(String(e.message || e)); }
  const movesA = [], movesB = [];
  let scoreA = 0, scoreB = 0;
  for (let r = 1; r <= length; r++) {
    let ma = 'C', mb = 'C';
    if (fa) {
      try {
        const v = normalise(fa(Object.freeze(movesA.slice()), Object.freeze(movesB.slice()), r));
        if (v) ma = v; else errors.a.push(`Round ${r}: did not return "C" or "D" (counted as C)`);
      } catch (e) { errors.a.push(`Round ${r}: ${e.message || e} (counted as C)`); }
    }
    if (fb) {
      try {
        const v = normalise(fb(Object.freeze(movesB.slice()), Object.freeze(movesA.slice()), r));
        if (v) mb = v; else errors.b.push(`Round ${r}: did not return "C" or "D" (counted as C)`);
      } catch (e) { errors.b.push(`Round ${r}: ${e.message || e} (counted as C)`); }
    }
    movesA.push(ma); movesB.push(mb);
    scoreA += payoff(ma, mb, p); scoreB += payoff(mb, ma, p);
  }
  return { movesA: movesA.join(''), movesB: movesB.join(''), scoreA, scoreB,
    errorsA: errors.a.slice(0, 5), errorsB: errors.b.slice(0, 5) };
}

const handler = (ev) => {
  const { id, type, entrants, matches, payoffs } = ev.data;
  try {
    if (type === 'check') {
      instantiate(entrants[0].code);
      post({ id, ok: true });
      return;
    }
    const byId = Object.fromEntries(entrants.map((e) => [e.id, e.code]));
    const out = [];
    for (const m of matches) {
      out.push({ ...m, ...playMatch(byId[m.a], byId[m.b], m.length, payoffs) });
      if (out.length % 25 === 0) post({ id, progress: out.length / matches.length });
    }
    post({ id, ok: true, results: out });
  } catch (e) {
    post({ id, ok: false, error: String(e.message || e) });
  }
};
self.addEventListener('message', handler);
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
  for (const k of ['onmessage', 'addEventListener', 'removeEventListener']) {
    try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) { /* ignore */ }
  }
}
