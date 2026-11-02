// Tiny rendering toolkit: views return HTML strings, `morph` patches the live DOM so that
// inputs keep their focus and typed values when the page refreshes with new data.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => (s instanceof Raw ? s : new Raw(s ?? ''));

/** Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``. Arrays are joined. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += flat(v) + strings[i + 1]; });
  return new Raw(out);
}
function flat(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return esc(v);
}

// ---------------------------------------------------------------------------
// DOM morphing

function syncAttrs(from, to) {
  // A <details> element's open/closed state belongs to the user once it is on the page.
  const keep = (name) => name === 'data-dirty' || (name === 'open' && from.tagName === 'DETAILS');
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name) && !keep(a.name)) from.removeAttribute(a.name);
  for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value && !keep(a.name)) from.setAttribute(a.name, a.value);
}

function syncFormValue(from, to) {
  const tag = from.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
  const userOwned = document.activeElement === from || from.dataset.dirty === '1';
  if (to.hasAttribute('data-force')) { from.dataset.dirty = ''; }
  else if (userOwned) return;
  if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
  else if (tag === 'TEXTAREA') { if (from.value !== to.value) from.value = to.textContent; }
  else if (tag === 'SELECT') {
    const sel = [...to.options].findIndex((o) => o.hasAttribute('selected'));
    if (sel >= 0 && from.selectedIndex !== sel) from.selectedIndex = sel;
  } else {
    const v = to.getAttribute('value') ?? '';
    if (from.value !== v) from.value = v;
  }
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);

function morphNode(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName || keyOf(from) !== keyOf(to)) {
    from.replaceWith(to);
    return;
  }
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttrs(from, to);
  syncFormValue(from, to);
  if (from.hasAttribute('data-preserve')) return;
  if (from.tagName === 'TEXTAREA') return;
  morphChildren(from, to);
}

export function morphChildren(fromParent, toParent) {
  const toKids = [...toParent.childNodes];
  let i = 0;
  for (; i < toKids.length; i++) {
    const want = toKids[i];
    let cur = fromParent.childNodes[i];
    const k = keyOf(want);
    if (k && cur && keyOf(cur) !== k) {
      const match = [...fromParent.childNodes].slice(i + 1).find((n) => keyOf(n) === k);
      if (match) { fromParent.insertBefore(match, cur); cur = match; }
    }
    if (!cur) fromParent.appendChild(want);
    else morphNode(cur, want);
  }
  while (fromParent.childNodes.length > toKids.length) fromParent.lastChild.remove();
}

export function patch(container, htmlString) {
  const t = document.createElement('template');
  t.innerHTML = String(htmlString);
  morphChildren(container, t.content);
}

// ---------------------------------------------------------------------------
// Store and render loop

export const store = { ui: {} };
let renderFn = null;
let scheduled = false;
export function setRenderer(fn) { renderFn = fn; }
export function rerender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; renderFn?.(); });
}
export function setState(patchObj) { Object.assign(store, patchObj); rerender(); }
export function setUi(key, value) {
  store.ui[key] = typeof value === 'function' ? value(store.ui[key]) : { ...(store.ui[key] || {}), ...value };
  rerender();
}

// ---------------------------------------------------------------------------
// Event delegation: data-action on buttons/links/forms, data-input / data-change on fields

const handlers = {};
export function on(name, fn) { handlers[name] = fn; }

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

// Two-click confirmation that works everywhere (some embedded browsers block confirm() pop-ups).
// First click shows the warning and arms the button for 6 seconds; a second click within that time confirms.
const armedAt = new Map();
export function confirmed(el, message) {
  const key = `${el.dataset.action}|${JSON.stringify({ ...el.dataset, armed: undefined, label: undefined })}`;
  const t = armedAt.get(key);
  if (t && Date.now() - t < 6000) {
    armedAt.delete(key);
    if (el.dataset.label) { el.textContent = el.dataset.label; delete el.dataset.label; }
    el.classList.remove('armed');
    return true;
  }
  armedAt.set(key, Date.now());
  toast(`${message} Click the button again to confirm.`, 'warn');
  if (!el.dataset.label) el.dataset.label = el.textContent;
  el.textContent = 'Click again to confirm';
  el.classList.add('armed');
  setTimeout(() => {
    if (armedAt.get(key) && Date.now() - armedAt.get(key) >= 5900) {
      armedAt.delete(key);
      if (el.isConnected && el.dataset.label) { el.textContent = el.dataset.label; delete el.dataset.label; el.classList.remove('armed'); }
    }
  }, 6000);
  return false;
}

async function run(name, el, extra) {
  const fn = handlers[name];
  if (!fn) { console.warn('No handler for', name); return; }
  const busyTarget = el.closest('button, form');
  try {
    busyTarget?.setAttribute('aria-busy', 'true');
    await fn(el, extra);
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'error');
  } finally {
    busyTarget?.removeAttribute('aria-busy');
  }
}

export function installEvents(root) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM') return;
    if (el.closest('[aria-busy="true"]')) { ev.preventDefault(); return; }
    ev.preventDefault();
    run(el.dataset.action, el);
  });
  root.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-action]');
    if (!form) return;
    ev.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    const data = Object.fromEntries(new FormData(form).entries());
    for (const f of form.querySelectorAll('[data-dirty]')) f.dataset.dirty = '';
    run(form.dataset.action, form, data);
  });
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.matches('input, textarea, select')) el.dataset.dirty = '1';
    if (el.dataset.input) run(el.dataset.input, el);
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.change) run(el.dataset.change, el);
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers

export const money = (v, digits = 0) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '−' : ''}$${s}`;
};
export const num = (v, digits = 0) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '–'
  : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(Number(v) * 100)}%`);
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
