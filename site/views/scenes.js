// Cartoon scene banners, one per game. Flat shapes with thick outlines, drawn in SVG so they stay crisp and light.
import { raw } from '../lib/dom.js';

const O = '#2A1B4A'; // outline
const sw = 'stroke="#2A1B4A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

let skyN = 0;
const sky = (top, bottom) => { const id = `sky${++skyN}`; return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="320" height="120" fill="url(#${id})"/>`; };
const cloud = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#fff" ${sw}><path d="M0 14 a10 10 0 0 1 12 -10 a13 13 0 0 1 24 0 a9 9 0 0 1 10 12 z"/></g>`;
const sun = (x, y) => `<g transform="translate(${x} ${y})"><circle r="13" fill="#FFD23F" ${sw}/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -18 L0 -24" transform="rotate(${a})" ${sw}/>`).join('')}</g>`;
const ground = (color) => `<path d="M0 98 Q80 90 160 96 T320 94 V120 H0 Z" fill="${color}" ${sw}/>`;

function shop(x, w, h, body, awning, sign) {
  const y = 98 - h;
  const stripes = Array.from({ length: Math.ceil(w / 10) }, (_, i) => `<rect x="${x + i * 10}" y="${y + 12}" width="10" height="12" fill="${i % 2 ? '#fff' : awning}"/>`).join('');
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${body}" ${sw}/>
    <rect x="${x + 4}" y="${y + 3}" width="${w - 8}" height="8" rx="2" fill="#FFF7D6" ${sw}/>
    <text x="${x + w / 2}" y="${y + 10}" font-size="7" text-anchor="middle" font-family="Lilita One, sans-serif" fill="${O}">${sign}</text>
    <g>${stripes}</g><rect x="${x}" y="${y + 12}" width="${w}" height="12" fill="none" ${sw}/>
    <path d="M${x} ${y + 24} ${Array.from({ length: Math.ceil(w / 10) }, (_, i) => `q5 6 10 0`).join(' ')}" fill="${awning}" ${sw}/>
    <rect x="${x + w * 0.15}" y="${y + 34}" width="${w * 0.32}" height="${h - 36}" rx="2" fill="#7DD3FC" ${sw}/>
    <rect x="${x + w * 0.58}" y="${y + 40}" width="${w * 0.26}" height="${h - 40}" rx="2" fill="#8B5A2B" ${sw}/>
    <circle cx="${x + w * 0.62}" cy="${y + 40 + (h - 40) / 2}" r="1.6" fill="#FFD23F"/>
  </g>`;
}

function market(kind, product) {
  const label = (product || 'shop').toUpperCase().slice(0, 7);
  let shops;
  if (kind === 'monopoly') {
    shops = shop(108, 104, 78, '#3B5BFF', '#FFD23F', label) + `<path d="M150 14 l6 -8 l6 8 l6 -8 l6 8 v8 h-24 z" fill="#FFD23F" ${sw}/>`;
  } else if (kind === 'oligopoly') {
    shops = shop(26, 76, 70, '#FF8A1F', '#FF3D8B', label) + shop(122, 76, 70, '#22B8F0', '#FFD23F', label) + shop(218, 76, 70, '#3DDC84', '#9B5CF6', label);
  } else if (kind === 'monopolistic') {
    const cs = [['#FF3D8B', '#FFD23F'], ['#9B5CF6', '#3DDC84'], ['#22B8F0', '#FF8A1F'], ['#FFC21A', '#FF3D8B'], ['#3DDC84', '#3B5BFF']];
    shops = cs.map(([b, a], i) => shop(10 + i * 62, 54, 52 + (i % 2) * 10, b, a, label)).join('');
  } else {
    shops = Array.from({ length: 5 }, (_, i) => shop(10 + i * 62, 54, 58, '#FFE3B3', '#22B8F0', label)).join('');
  }
  return `${sky('#7DE3FF', '#D6F7FF')}${sun(286, 22)}${cloud(30, 10, 0.9)}${cloud(200, 6, 0.7)}${ground('#3DDC84')}${shops}`;
}

function pond() {
  const fish = (x, y, r = 0, c = '#FF8A1F') => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0 C6 -8 18 -8 22 0 C18 8 6 8 0 0 Z" fill="${c}" ${sw}/><path d="M21 0 L30 -6 L28 0 L30 6 Z" fill="${c}" ${sw}/><circle cx="6" cy="-1.5" r="1.6" fill="${O}"/></g>`;
  const reeds = (x) => `<g ${sw} fill="#3DDC84"><path d="M${x} 96 q-4 -26 2 -40" fill="none"/><path d="M${x + 6} 96 q2 -30 -2 -46" fill="none"/><ellipse cx="${x + 2}" cy="54" rx="3" ry="8" fill="#8B5A2B"/><ellipse cx="${x + 4}" cy="48" rx="3" ry="8" fill="#8B5A2B"/></g>`;
  return `${sky('#9BE7FF', '#E7FBFF')}${sun(40, 22)}${cloud(240, 8, 0.9)}${cloud(150, 18, 0.6)}
    <path d="M0 62 Q160 52 320 62 V120 H0 Z" fill="#3DDC84" ${sw}/>
    <ellipse cx="170" cy="92" rx="140" ry="26" fill="#14B8A6" ${sw}/>
    <path d="M60 88 q10 -5 20 0 M200 100 q10 -5 20 0 M120 104 q10 -5 20 0 M250 86 q8 -4 16 0" stroke="#A7F3EB" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <g ${sw}><ellipse cx="95" cy="96" rx="14" ry="5" fill="#3DDC84"/><circle cx="99" cy="93" r="3" fill="#FF3D8B"/><ellipse cx="236" cy="100" rx="12" ry="4.5" fill="#3DDC84"/></g>
    ${fish(140, 70, -25)}${fish(190, 98, 8, '#FFD23F')}${fish(110, 104, -4, '#FF3D8B')}
    <path d="M150 74 q-6 -8 -2 -14" stroke="#A7F3EB" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <g ${sw}><path d="M244 76 h44 l-8 10 h-30 z" fill="#FF4757"/><path d="M262 76 v-24 l14 18 z" fill="#fff"/><path d="M262 76 V50" fill="none"/></g>
    ${reeds(18)}${reeds(296)}
    <g ${sw}><rect x="0" y="74" width="40" height="6" fill="#B07A45"/><path d="M8 80 v16 M30 80 v16" fill="none"/></g>`;
}

function cards() {
  const card = (x, r, color, letter) => `<g transform="translate(${x} 20) rotate(${r} 32 44)"><rect width="64" height="88" rx="8" fill="#fff" ${sw}/><rect x="7" y="7" width="50" height="74" rx="5" fill="none" stroke="${color}" stroke-width="3"/><text x="32" y="58" font-size="36" text-anchor="middle" font-family="Lilita One, sans-serif" fill="${color}">${letter}</text></g>`;
  const chip = (x, y, c) => `<g transform="translate(${x} ${y})"><ellipse rx="16" ry="6" cy="6" fill="${c}" ${sw}/><ellipse rx="16" ry="6" fill="${c}" ${sw}/><ellipse rx="9" ry="3.2" fill="#fff" opacity=".7"/></g>`;
  return `<rect width="320" height="120" fill="#127A4E"/><g opacity=".18">${Array.from({ length: 12 }, (_, i) => `<circle cx="${i * 30}" cy="${(i % 3) * 40 + 10}" r="22" fill="#fff"/>`).join('')}</g>
    <ellipse cx="160" cy="130" rx="190" ry="40" fill="#0B5A39"/>
    ${card(92, -10, '#3B5BFF', 'C')}${card(164, 10, '#FF4757', 'D')}
    ${chip(52, 86, '#FF3D8B')}${chip(52, 78, '#FFD23F')}${chip(270, 92, '#22B8F0')}${chip(282, 84, '#FF8A1F')}${chip(262, 76, '#3DDC84')}`;
}

function trophy() {
  const conf = Array.from({ length: 22 }, (_, i) => `<rect x="${(i * 53) % 320}" y="${(i * 37) % 110}" width="7" height="4" rx="1" fill="${['#FF3D8B', '#FFD23F', '#22B8F0', '#3DDC84', '#9B5CF6', '#FF8A1F'][i % 6]}" transform="rotate(${(i * 47) % 180} ${(i * 53) % 320} ${(i * 37) % 110})"/>`).join('');
  return `<rect width="320" height="120" fill="#3B1A78"/>${conf}
    <g ${sw}><path d="M130 22 h60 v20 a30 30 0 0 1 -60 0 z" fill="#FFD23F"/><path d="M130 28 h-14 a14 14 0 0 0 16 20 M190 28 h14 a14 14 0 0 1 -16 20" fill="none"/>
    <rect x="152" y="70" width="16" height="14" fill="#FFC21A"/><rect x="138" y="84" width="44" height="14" rx="3" fill="#B07A45"/></g>
    <path d="M140 30 q4 18 14 24" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
    <g fill="#fff">${[[60, 30], [262, 40], [96, 84], [236, 92]].map(([x, y]) => `<path d="M${x} ${y - 8} l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z"/>`).join('')}</g>`;
}

function jar() {
  const coin = (x, y) => `<g transform="translate(${x} ${y})"><ellipse rx="10" ry="4" cy="3" fill="#E0A800" ${sw}/><ellipse rx="10" ry="4" fill="#FFD23F" ${sw}/></g>`;
  const people = [40, 76, 244, 280].map((x, i) => `<g ${sw}><circle cx="${x}" cy="66" r="11" fill="${['#FFB27A', '#8B5A2B', '#F5C9A0', '#C68642'][i]}"/><path d="M${x - 16} 104 q16 -34 32 0 z" fill="${['#FF3D8B', '#22B8F0', '#9B5CF6', '#3DDC84'][i]}"/></g>`).join('');
  return `${sky('#C4F1FF', '#F2FCFF')}${ground('#3DDC84')}${people}
    <g ${sw}><path d="M126 34 h68 v8 q14 8 14 30 v20 q0 10 -10 10 h-76 q-10 0 -10 -10 v-20 q0 -22 14 -30 z" fill="#BFF0FF" fill-opacity=".85"/><rect x="122" y="26" width="76" height="10" rx="3" fill="#FF8A1F"/></g>
    ${coin(140, 92)}${coin(162, 94)}${coin(182, 90)}${coin(150, 84)}${coin(172, 82)}${coin(160, 74)}
    ${coin(118, 14)}${coin(204, 8)}<path d="M126 18 q8 4 12 12 M200 12 q-4 8 -8 16" stroke="${O}" stroke-width="2" fill="none" stroke-dasharray="3 3"/>`;
}

function pie() {
  return `${sky('#FFE0F0', '#FFF6FB')}
    <g ${sw}><ellipse cx="160" cy="98" rx="96" ry="14" fill="#fff"/><path d="M90 86 a70 26 0 0 0 140 0 v-14 h-140 z" fill="#E6A15C"/>
    <ellipse cx="160" cy="72" rx="70" ry="22" fill="#F5C77E"/><path d="M160 72 L230 72 A70 22 0 0 1 196 91 Z" fill="#FF4757"/></g>
    <g fill="#FF4757">${[110, 130, 150, 176, 120, 146].map((x, i) => `<circle cx="${x}" cy="${66 + (i % 2) * 8}" r="3.5" stroke="${O}" stroke-width="2"/>`).join('')}</g>
    <g ${sw}><path d="M250 30 l20 10 -20 10 z" fill="#9B5CF6"/><path d="M70 30 l-20 10 20 10 z" fill="#22B8F0"/></g>
    <g ${sw} fill="#FFD23F"><circle cx="40" cy="80" r="10"/><circle cx="282" cy="80" r="10"/></g>`;
}

// Costs and supply: a long receipt, a calculator, and a chalkboard with a rising supply curve.
function books(c) {
  const lines = [0, 1, 2, 3, 4, 5].map((i) => `<path d="M${46} ${30 + i * 9} h${i % 2 ? 34 : 44}" stroke="#B9A9D9" stroke-width="3" stroke-linecap="round"/><text x="104" y="${33 + i * 9}" font-size="7" font-family="Lilita One, sans-serif" fill="${O}" text-anchor="end">$${[150, 60, 120, 20, 80, 3][i]}</text>`).join('');
  const keys = Array.from({ length: 12 }, (_, i) => `<rect x="${238 + (i % 3) * 14}" y="${50 + Math.floor(i / 3) * 11}" width="10" height="7" rx="2" fill="${['#FF3D8B', '#FFD23F', '#22B8F0', '#3DDC84'][i % 4]}" stroke="${O}" stroke-width="1.6"/>`).join('');
  return `${sky('#FFE9C7', '#FFF7E3')}
    <path d="M0 100 H320 V120 H0 Z" fill="#C98A4B" ${sw}/>
    <g transform="rotate(-4 75 60)"><path d="M36 14 H112 V100 l-6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 Z" fill="#fff" ${sw}/>
      <text x="74" y="25" font-size="8" font-family="Lilita One, sans-serif" fill="${O}" text-anchor="middle">${String(c.business || 'BILLS').toUpperCase().slice(0, 12)}</text>${lines}</g>
    <g ${sw}><rect x="130" y="16" width="92" height="74" rx="6" fill="#1F6B45"/><rect x="136" y="22" width="80" height="62" rx="3" fill="#2E8B57"/></g>
    <path d="M146 76 V30 M146 76 H208" stroke="#E6F6DF" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M150 74 H160 V64 H170 V56 H180 V46 H190 V38 H202" fill="none" stroke="#FFD23F" stroke-width="3.4" stroke-linejoin="round"/>
    <text x="196" y="34" font-size="9" font-family="Lilita One, sans-serif" fill="#FFD23F">S</text>
    <g ${sw}><rect x="230" y="28" width="56" height="70" rx="7" fill="#9B5CF6"/><rect x="237" y="34" width="42" height="12" rx="2" fill="#DFF7E2"/></g>
    <text x="275" y="44" font-size="8" font-family="Lilita One, sans-serif" fill="${O}" text-anchor="end">MC=P</text>${keys}
    <g ${sw} fill="#FFD23F"><circle cx="300" cy="104" r="7"/><circle cx="20" cy="106" r="6"/></g>`;
}

const SCENES = {
  competitive: (c) => market('competitive', c.product), monopolistic: (c) => market('monopolistic', c.product),
  oligopoly: (c) => market('oligopoly', c.product), monopoly: (c) => market('monopoly', c.product),
  pd_live: cards, pd_tournament: trophy, public_goods: jar, ultimatum: pie, commons: pond, costs: books,
};

/** A cartoon banner for a game. */
export function scene(gameType, cfg = {}, cls = 'scene') {
  const f = SCENES[gameType];
  if (!f) return '';
  return raw(`<svg class="${cls}" viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">${f(cfg)}</svg>`);
}
