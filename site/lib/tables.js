// Tables that work with Excel: a "Copy table" button that puts tab-separated cells on the clipboard,
// and pasting a block of cells from Excel into a worksheet fills the inputs down and across.
import { html, on, toast } from './dom.js';

/** A copy button for the nearest enclosing `.copyable` block (it copies the first table inside). */
export const copyButton = (label = 'Copy table') =>
  html`<button type="button" class="link copy-btn" data-action="copy-table" title="Copies the table so you can paste it into Excel or Google Sheets">⧉ ${label}</button>`;

// "$1,178.50" → "1178.50", "−25.50" → "-25.50"; anything else is left as text.
const MONEYISH = /^\s*[−-]?\s*\$?\s*[−-]?[\d,]+(\.\d+)?\s*%?\s*$/;
export function cleanNumber(text) {
  const t = String(text ?? '').trim();
  if (!MONEYISH.test(t) || t.endsWith('%')) return t;
  const neg = /[−-]/.test(t);
  const n = t.replace(/[−\-$,\s]/g, '');
  return neg ? `-${n}` : n;
}

function cellText(cell) {
  const input = cell.querySelector('input:not([type=checkbox]):not([type=radio])');
  if (input) return cleanNumber(input.value);
  const sel = cell.querySelector('select');
  if (sel) return sel.value === '' ? '' : (sel.selectedOptions[0]?.dataset.copy ?? sel.selectedOptions[0]?.textContent ?? sel.value).trim();
  const txt = (cell.dataset.copy ?? cell.innerText ?? cell.textContent ?? '').replace(/\s+/g, ' ').trim();
  return cleanNumber(txt === '–' ? '' : txt);
}

export function tableToTsv(table) {
  return [...table.querySelectorAll('tr')]
    .filter((tr) => !tr.closest('table table') || tr.closest('table') === table)
    .map((tr) => [...tr.children].map(cellText).join('\t')).join('\n');
}

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

on('copy-table', async (el) => {
  const table = el.closest('.copyable')?.querySelector('table');
  if (!table) return;
  const ok = await writeClipboard(tableToTsv(table));
  toast(ok ? 'Copied. Paste it into Excel or Google Sheets.' : 'Copying is blocked in this browser. Select the table and press Ctrl+C instead.', ok ? 'info' : 'error');
});

// Paste from Excel into worksheet inputs: a block of cells fills the inputs to the right and below.
function onPaste(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement) || !target.closest('table.worksheet')) return;
  const text = ev.clipboardData?.getData('text/plain') ?? '';
  const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'));
  const multi = rows.length > 1 || rows[0].length > 1;
  const single = cleanNumber(rows[0][0]);
  if (!multi && single === rows[0][0].trim() && single === rows[0][0]) return; // nothing to clean: normal paste
  ev.preventDefault();
  const td = target.closest('td');
  const tr = td.parentElement;
  const body = tr.parentElement;
  const r0 = [...body.children].indexOf(tr);
  const c0 = [...tr.children].indexOf(td);
  let filled = 0;
  rows.forEach((cols, i) => {
    const row = body.children[r0 + i];
    if (!row) return;
    cols.forEach((val, j) => {
      const input = row.children[c0 + j]?.querySelector('input:not([disabled])');
      if (!input) return;
      input.value = cleanNumber(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      filled++;
    });
  });
  if (multi) toast(`Pasted ${filled} ${filled === 1 ? 'cell' : 'cells'}.`);
}
if (typeof document !== 'undefined' && !window.__pasteInstalled) {
  window.__pasteInstalled = true;
  document.addEventListener('paste', onPaste, true);
}
