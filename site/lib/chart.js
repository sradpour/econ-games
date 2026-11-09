// Small SVG line charts that follow the page's colour tokens (works in light and dark mode).
import { esc, raw } from './dom.js';

const nice = (max) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const fmt = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * series: [{ name, points: [[x, y], ...], color: 'demand'|'supply'|'ink'|'muted'|'mark', dashed?, dots? }]
 * refs:   [{ y, label }] horizontal reference lines
 */
export function lineChart({ series, refs = [], xLabel = '', yLabel = '', height = 220, xInteger = false, title = '', yMax = null, xTicks = null }) {
  const W = 560, H = height, L = 46, R = 14, T = yLabel ? 28 : 14, B = 34;
  const pts = series.flatMap((s) => s.points).filter((p) => p[1] !== null && p[1] !== undefined && Number.isFinite(p[1]));
  if (!pts.length) return raw(`<div class="chart-empty">No data yet</div>`);
  const xs = pts.map((p) => p[0]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const ys = [...pts.map((p) => p[1]), ...refs.map((r) => r.y)];
  let y0 = Math.min(0, ...ys), y1 = yMax && Math.max(...ys) <= yMax ? yMax : nice(Math.max(...ys) * 1.08 || 1);
  if (y0 < 0) y0 = -nice(-y0);
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / ticks);
  const xTickVals = xTicks ? xTicks.filter((v) => v >= x0 && v <= x1) : xInteger
    ? Array.from(new Set(xs)).sort((a, b) => a - b).filter((v, i, arr) => arr.length <= 12 || i % Math.ceil(arr.length / 12) === 0)
    : Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const path = (s) => {
    let d = '', pen = false;
    for (const [x, y] of s.points) {
      if (y === null || y === undefined || !Number.isFinite(y)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`; pen = true;
    }
    return d;
  };
  const legend = series.filter((s) => s.name).map((s) => `<span class="lg lg-${s.color || 'ink'}${s.dashed ? ' dashed' : ''}">${esc(s.name)}</span>`).join('');
  return raw(`<figure class="chart">${title ? `<figcaption>${esc(title)}</figcaption>` : ''}
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || yLabel)}">
    ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('')}
    ${y0 < 0 ? `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>` : ''}
    ${xTickVals.map((v) => `<text class="tick" x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${fmt(v)}</text>`).join('')}
    ${refs.map((r) => `<line class="ref" x1="${L}" x2="${W - R}" y1="${sy(r.y)}" y2="${sy(r.y)}"/><text class="ref-label" x="${W - R - 4}" y="${sy(r.y) - 5}" text-anchor="end">${esc(r.label)}</text>`).join('')}
    ${series.map((s) => `<path class="line c-${s.color || 'ink'}${s.dashed ? ' dashed' : ''}" d="${path(s)}"/>${(s.dots || s.points.filter((p) => Number.isFinite(p[1])).length < 3) ? s.points.filter((p) => Number.isFinite(p[1])).map(([x, y]) => `<circle class="dot c-${s.color || 'ink'}" cx="${sx(x)}" cy="${sy(y)}" r="3.5"/>`).join('') : ''}`).join('')}
    ${xLabel ? `<text class="axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>` : ''}
    ${yLabel ? `<text class="axis" x="4" y="12" text-anchor="start">${esc(yLabel)}</text>` : ''}
  </svg>${legend ? `<div class="legend">${legend}</div>` : ''}</figure>`);
}

/** Plot a function y = f(x) on [x0, x1]. */
export const sample = (f, x0, x1, n = 60) => Array.from({ length: n + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / n; return [x, f(x)]; });

/** Horizontal bars, e.g. a distribution of offers or contributions. */
export function barChart({ bars, max, unit = '' }) {
  const top = max ?? Math.max(1, ...bars.map((b) => b.value));
  return raw(`<div class="bars">${bars.map((b) => `<div class="bar-row"><span class="bar-label">${esc(b.label)}</span>
    <span class="bar-track"><span class="bar-fill${b.mine ? ' mine' : ''}" style="width:${Math.max(0, (b.value / top) * 100)}%"></span></span>
    <span class="bar-value">${esc(b.text ?? `${b.value}${unit}`)}</span></div>`).join('')}</div>`);
}
