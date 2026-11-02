// CSV helpers for grading exports.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, columns) {
  const cols = columns || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export function downloadCsv(filename, rows, columns) {
  const blob = new Blob(['﻿' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Flatten nested result payloads into columns (others → "2, 15, 20"). */
export function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) out[prefix + k] = v.map((x) => (typeof x === 'object' ? (x.contribution ?? JSON.stringify(x)) : x)).join(', ');
    else if (typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}_`));
    else out[prefix + k] = v;
  }
  return out;
}
