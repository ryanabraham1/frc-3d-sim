import { PLACEMENT_GAMES, rankFor, type RankInfo, type TierId } from '@engine/net/ranked';

/**
 * Rank emblems: inline SVG badges, one per tier (bolt, gear, piston, star, burst) that grow
 * more elaborate up the ladder, with three pips for the division. Animation lives in multiplayer.css
 * (.rk-emblem …): a light sweep, a glow that pulses on the top tiers, rotating rays on Apex and a pop-in.
 */

let uid = 0;

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const CX = 60;
const CY = 58;

const pts = (list: [number, number][]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const polar = (r: number, deg: number): [number, number] => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
const star = (outer: number, inner: number, n = 5) => pts(Array.from({ length: n * 2 }, (_, i) => polar(i % 2 ? inner : outer, -90 + (i * 180) / n)));

/**
 * A symmetric silhouette from its right half: [dx from the centre line, y] from the top point down to the bottom point.
 * The left half is the mirror image.
 */
function sym(right: [number, number][]): [number, number][] {
  const left = right
    .slice(1, -1)
    .reverse()
    .map(([dx, y]) => [-dx, y] as [number, number]);
  return [...right.map(([dx, y]) => [CX + dx, y] as [number, number]), ...left.map(([dx, y]) => [CX + dx, y] as [number, number])];
}

/** One distinct outline per tier: notched shield → stepped plate → winged crest → spiked crown → radiant burst. */
const SILHOUETTE: Record<TierId, [number, number][]> = {
  bolt: [[0, 10], [16, 16], [36, 10], [38, 56], [24, 88], [0, 106]],
  gear: [[0, 8], [20, 8], [28, 18], [42, 18], [42, 52], [34, 60], [34, 74], [18, 96], [0, 108]],
  piston: [[0, 2], [12, 14], [22, 6], [36, 18], [62, 10], [52, 36], [40, 46], [42, 64], [22, 94], [0, 110]],
  champion: [[0, 0], [8, 18], [17, 3], [27, 24], [42, 10], [43, 42], [56, 38], [46, 74], [24, 98], [0, 112]],
  apex: [[0, -4], [10, 14], [22, 2], [30, 24], [60, 4], [52, 38], [64, 60], [44, 82], [24, 100], [0, 118]],
};

/** Engraved motif at the centre of the plate (a nod to the tier's name). */
function motif(id: TierId, fill: string, ink: string): string {
  const g = (inner: string, y = 0) => `<g transform="translate(${CX} ${CY + y}) scale(.62) translate(${-CX} ${-CY})">${inner}</g>`;
  switch (id) {
    case 'bolt':
      return g(`<polygon points="66,30 46,60 57,60 51,88 74,52 62,52" fill="${fill}"/>`);
    case 'gear': {
      const teeth = 8;
      const step = 360 / teeth;
      const p: [number, number][] = [];
      for (let i = 0; i < teeth; i++) {
        const a = -90 + i * step;
        p.push(polar(19, a - step * 0.28), polar(25, a - step * 0.16), polar(25, a + step * 0.16), polar(19, a + step * 0.28));
      }
      return g(`<polygon points="${pts(p)}" fill="${fill}"/><circle cx="${CX}" cy="${CY}" r="8" fill="${ink}"/>`);
    }
    case 'piston':
      return g(`<rect x="52" y="30" width="16" height="28" rx="2" fill="${fill}"/><rect x="40" y="52" width="40" height="26" rx="6" fill="${fill}"/><rect x="45" y="60" width="30" height="3" fill="${ink}"/><rect x="45" y="67" width="30" height="3" fill="${ink}"/>`);
    case 'champion':
      return g(`<polygon points="${star(27, 12)}" fill="${fill}"/>`);
    case 'apex':
      return g(`<polygon points="${star(30, 9, 4)}" fill="${fill}"/><polygon points="${star(14, 5, 4)}" fill="${ink}" transform="rotate(45 ${CX} ${CY})"/>`);
  }
}

export interface EmblemOptions {
  /** Pixel width (the badge is ~0.92 as wide as tall). */
  size?: number;
  /** Play the pop-in animation. */
  pop?: boolean;
  /** Skip the pips (tiny chips). */
  noPips?: boolean;
}

/** SVG for a rank; `null` is the unranked (placement) badge. */
export function emblemSvg(rank: RankInfo | null, opts: EmblemOptions = {}): string {
  const size = opts.size ?? 64;
  const id = `e${++uid}`;
  const cls = `rk-emblem ${rank ? `tier-${rank.tier.id}` : 'unranked'} ${opts.pop ? 'pop' : ''}`;
  const h = Math.round(size * 1.08);
  if (!rank) {
    return `<svg class="${cls}" width="${size}" height="${h}" viewBox="0 0 120 130" role="img" aria-label="Unranked"><polygon points="${pts(sym(SILHOUETTE.bolt))}" fill="#15151f" stroke="#6c6b7a" stroke-width="3" stroke-dasharray="7 6"/><text x="${CX}" y="${CY + 16}" text-anchor="middle" font-size="42" font-weight="800" fill="#8d8c9c" font-family="Barlow Condensed, sans-serif">?</text></svg>`;
  }
  const c = rank.tier.color;
  const top = rank.tierIndex; // 0 bolt … 4 apex
  const outline = pts(sym(SILHOUETTE[rank.tier.id]));
  const ink = '#0d0d15';
  // Metallic body: bright crown, saturated middle, deep base — plus a darker inset for the bevel.
  const defs = `
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.7)}"/><stop offset=".28" stop-color="${shade(c, 0.2)}"/><stop offset=".62" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.6)}"/></linearGradient>
    <linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, -0.55)}"/><stop offset="1" stop-color="${shade(c, -0.85)}"/></linearGradient>
    <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}c"><polygon points="${outline}"/></clipPath>`;
  const rays =
    rank.tier.id === 'apex'
      ? `<g class="rk-rays" style="transform-origin:${CX}px ${CY}px">${Array.from({ length: 12 }, (_, i) => `<polygon points="${pts([polar(64, -90 + i * 30 - 3.5), polar(72 + (i % 2) * 6, -90 + i * 30), polar(64, -90 + i * 30 + 3.5)])}" fill="${c}" opacity=".55"/>`).join('')}</g>`
      : '';
  const inset = `transform="translate(${CX} ${CY}) scale(.8) translate(${-CX} ${-CY})"`;
  // Faceting: a bright wedge down the left, a shadowed wedge down the right, a crest highlight along the top edge.
  const facets = `
    <polygon points="${CX},${CY - 52} ${CX - 52},${CY - 20} ${CX - 30},${CY + 50} ${CX},${CY + 56}" fill="url(#${id}f)" clip-path="url(#${id}c)" opacity=".9"/>
    <polygon points="${CX},${CY - 52} ${CX + 56},${CY - 20} ${CX + 34},${CY + 52} ${CX},${CY + 56}" fill="#000" opacity=".16" clip-path="url(#${id}c)"/>
    <polyline points="${pts(sym(SILHOUETTE[rank.tier.id]).slice(0, Math.ceil(SILHOUETTE[rank.tier.id].length / 2) + 1))}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linejoin="round" clip-path="url(#${id}c)"/>`;
  // Two sharp chevrons under the motif, the signature of the set.
  const chevrons = `<path d="M${CX - 17} ${CY + 24} L${CX} ${CY + 36} L${CX + 17} ${CY + 24}" fill="none" stroke="${shade(c, 0.55)}" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/><path d="M${CX - 17} ${CY + 33} L${CX} ${CY + 45} L${CX + 17} ${CY + 33}" fill="none" stroke="${shade(c, 0.1)}" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/>`;
  const pips = rank.division
    ? [1, 2, 3]
        .map((n) => {
          const x = CX + (n - 2) * 16;
          const on = n <= rank.division;
          return `<polygon points="${pts([[x - 7, 113], [x + 7, 113], [x, 125]])}" fill="${on ? c : '#15151f'}" stroke="${on ? shade(c, 0.55) : '#4a4a5a'}" stroke-width="1.5" stroke-linejoin="round"/>`;
        })
        .join('')
    : '';
  const glow = top >= 2 ? ' glow' : '';
  return `<svg class="${cls}${glow}" style="--tier:${c}" width="${size}" height="${h}" viewBox="0 -8 120 138" role="img" aria-label="${rank.label}">
    <defs>${defs}</defs>
    ${rays}
    <polygon points="${outline}" fill="url(#${id}m)" stroke="${shade(c, 0.6)}" stroke-width="2" stroke-linejoin="round"/>
    <polygon points="${outline}" fill="url(#${id}i)" stroke="${shade(c, 0.25)}" stroke-width="1.5" stroke-linejoin="round" ${inset}/>
    ${facets}
    <g class="rk-glyph">${motif(rank.tier.id, `url(#${id}m)`, ink)}</g>
    ${chevrons}
    <g clip-path="url(#${id}c)"><rect class="rk-shine" x="-30" y="-10" width="26" height="140" fill="url(#${id}s)"/></g>
    ${opts.noPips ? '' : pips}
  </svg>`;
}

/** Small inline chip: emblem + rank name (or placement progress). */
export function rankChip(rating: number, games: number, size = 26): string {
  const rank = games < PLACEMENT_GAMES ? null : rankFor(rating);
  const label = rank ? rank.label : `Placement ${games}/${PLACEMENT_GAMES}`;
  return `<span class="rk-chip ${rank ? '' : 'unranked'}" style="--tier:${rank?.tier.color ?? '#8d8c9c'}">${emblemSvg(rank, { size, noPips: true })}<span>${label}</span></span>`;
}
