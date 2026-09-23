/**
 * Placeholder art generator. Pure Node, deterministic: running it twice writes byte-identical files.
 *
 * Writes into packages/app/public/assets:
 *   sheets/parts.png + parts.json   one 64 x 64 frame per part sprite (PixiJS JSON hash)
 *   sheets/fx.png + fx.json         propeller spin and thruster flame frames plus `animations`
 *   terrain/*.png                   standalone seamless 64 x 64 tiles (not atlased, so they can repeat)
 *   manifest.json                   PixiJS asset manifest with bundles parts, fx, terrain
 *
 * Every part is drawn at rotation 0: face N is the top of the image, S the bottom. The renderer rotates.
 * Image coordinates here are pixels with y down. Real art replaces these files; frame names are the contract.
 *
 * Run: pnpm --filter @robots/app gen:assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const CELL = 64;
const SUPERSAMPLE = 4;
const PAD = 2;
const EXTRUDE = 1;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

// ---------------------------------------------------------------- color

type Rgb = readonly [number, number, number];

function hex(s: string): Rgb {
  const n = Number.parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const lighten = (c: Rgb, t: number): Rgb => mix(c, WHITE, t);
const darken = (c: Rgb, t: number): Rgb => mix(c, BLACK, t);

// ---------------------------------------------------------------- prng

/** mulberry32: tiny seeded PRNG so any noise is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- canvas

/** Coverage in [0, 1] of a continuous point. Pixel (px, py) spans [px, px + 1) x [py, py + 1). */
type Field = (x: number, y: number) => number;
/** Inside test of a continuous point. */
type Shape = (x: number, y: number) => boolean;

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  /** Source-over blend of `c` at opacity `a` into pixel (px, py), straight alpha. */
  blend(px: number, py: number, c: Rgb, a: number): void {
    if (a <= 0 || px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    if (a > 1) a = 1;
    const d = this.data;
    const i = (py * this.w + px) * 4;
    const da = d[i + 3]! / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k]! * a + d[i + k]! * da * (1 - a)) / oa);
    d[i + 3] = Math.round(oa * 255);
  }

  /** Paint `c` with per-point coverage from `f`, averaged over a 4 x 4 grid of subsamples per pixel. */
  paint(f: Field, c: Rgb, alpha = 1): void {
    const n = SUPERSAMPLE * SUPERSAMPLE;
    for (let py = 0; py < this.h; py++) {
      for (let px = 0; px < this.w; px++) {
        let sum = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const v = f(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE);
            sum += v <= 0 ? 0 : v >= 1 ? 1 : v;
          }
        }
        if (sum > 0) this.blend(px, py, c, (alpha * sum) / n);
      }
    }
  }

  fill(s: Shape, c: Rgb, alpha = 1): void {
    this.paint((x, y) => (s(x, y) ? 1 : 0), c, alpha);
  }

  /** Per-pixel callback with no supersampling (noise, gradients). */
  eachPixel(fn: (px: number, py: number) => void): void {
    for (let py = 0; py < this.h; py++) for (let px = 0; px < this.w; px++) fn(px, py);
  }

  get(px: number, py: number): [number, number, number, number] {
    const i = (py * this.w + px) * 4;
    const d = this.data;
    return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  }

  set(px: number, py: number, v: readonly [number, number, number, number]): void {
    const i = (py * this.w + px) * 4;
    this.data.set(v, i);
  }

  copyFrom(src: Canvas): void {
    this.data.set(src.data);
  }
}

// ---------------------------------------------------------------- shapes

const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

const circle =
  (cx: number, cy: number, r: number): Shape =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const ellipse =
  (cx: number, cy: number, rx: number, ry: number): Shape =>
  (x, y) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

const ring = (cx: number, cy: number, r0: number, r1: number): Shape => diff(circle(cx, cy, r1), circle(cx, cy, r0));

/** Thick line segment with round caps. */
function seg(ax: number, ay: number, bx: number, by: number, width: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = (width / 2) ** 2;
  return (x, y) => {
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r2;
  };
}

/** Even-odd polygon fill. */
function poly(pts: ReadonlyArray<readonly [number, number]>): Shape {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function diff(a: Shape, b: Shape): Shape {
  return (x, y) => a(x, y) && !b(x, y);
}

function inter(a: Shape, b: Shape): Shape {
  return (x, y) => a(x, y) && b(x, y);
}

function union(...s: Shape[]): Shape {
  return (x, y) => s.some((f) => f(x, y));
}

/** Repeat a shape on a torus so tiles stay seamless. */
function wrap(s: Shape, size = CELL): Shape {
  return (x, y) => {
    for (let oy = -size; oy <= size; oy += size) for (let ox = -size; ox <= size; ox += size) if (s(x + ox, y + oy)) return true;
    return false;
  };
}

// ---------------------------------------------------------------- drawing helpers

/** Light from the top-left: highlight bands on the top and left edges, shadow on the bottom and right. */
function bevel(cv: Canvas, x0: number, y0: number, x1: number, y1: number, b: number, hi: number, lo: number): void {
  cv.fill(poly([[x0, y0], [x1, y0], [x1 - b, y0 + b], [x0 + b, y0 + b]]), WHITE, hi);
  cv.fill(poly([[x0, y0], [x0 + b, y0 + b], [x0 + b, y1 - b], [x0, y1]]), WHITE, hi * 0.75);
  cv.fill(poly([[x0, y1], [x0 + b, y1 - b], [x1 - b, y1 - b], [x1, y1]]), BLACK, lo);
  cv.fill(poly([[x1, y0], [x1, y1], [x1 - b, y1 - b], [x1 - b, y0 + b]]), BLACK, lo * 0.8);
}

/** A bordered, bevelled plate: border color, base inside, bevel on the inner edge. */
function plate(cv: Canvas, x0: number, y0: number, x1: number, y1: number, base: Rgb, border: Rgb, borderW: number, bev = 2): void {
  cv.fill(rect(x0, y0, x1, y1), border);
  cv.fill(rect(x0 + borderW, y0 + borderW, x1 - borderW, y1 - borderW), base);
  if (bev > 0) bevel(cv, x0 + borderW, y0 + borderW, x1 - borderW, y1 - borderW, bev, 0.22, 0.28);
}

/** A disc lit from the top-left: crescent highlight and crescent shadow. */
function shadedDisc(cv: Canvas, cx: number, cy: number, r: number, c: Rgb, off = 1.2, hi = 0.35, lo = 0.35): void {
  cv.fill(circle(cx, cy, r), c);
  cv.fill(diff(circle(cx, cy, r), circle(cx + off, cy + off, r)), WHITE, hi);
  cv.fill(diff(circle(cx, cy, r), circle(cx - off, cy - off, r)), BLACK, lo);
}

function rivet(cv: Canvas, cx: number, cy: number, r = 2.6): void {
  cv.fill(circle(cx + 0.9, cy + 0.9, r), BLACK, 0.45);
  shadedDisc(cv, cx, cy, r, hex('#a7adb5'), 0.9, 0.5, 0.3);
}

/** Soft radial glow, strongest at the center. */
function glow(cv: Canvas, cx: number, cy: number, r: number, c: Rgb, alpha: number): void {
  cv.paint((x, y) => {
    const d = Math.hypot(x - cx, y - cy) / r;
    return d >= 1 ? 0 : (1 - d) ** 2;
  }, c, alpha);
}

/** Yellow and black diagonal hazard stripes clipped to `area`. */
function hazard(cv: Canvas, area: Shape, period = 12): void {
  cv.fill(area, hex('#e8c21e'));
  cv.fill(inter(area, (x, y) => ((((x + y) % period) + period) % period) < period / 2), hex('#1d1f23'));
}

// ---------------------------------------------------------------- palette

const STEEL = hex('#8a9099');
const FRAME_GRAY = hex('#7d838d');
const OUTLINE = hex('#454a52');
const DARK_METAL = hex('#2e3137');
const CYAN = hex('#38d6ff');
const YELLOW = hex('#e8c21e');

// ---------------------------------------------------------------- parts

function drawCore(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const base = hex('#1b1d23');
  cv.fill(rect(0, 0, CELL, CELL), base);
  bevel(cv, 0, 0, CELL, CELL, 3, 0.16, 0.45);
  // Inner panel line.
  cv.fill(diff(rect(6, 6, 58, 58), rect(7, 7, 57, 57)), hex('#30343d'));
  // Chevron on the top edge so rotation reads.
  cv.fill(union(seg(24, 14, 32, 8, 3.2), seg(32, 8, 40, 14, 3.2)), darken(CYAN, 0.25));
  // Eye: dark socket, soft glow, ring, bright pupil, specular dot.
  cv.fill(circle(32, 34, 15.5), hex('#0d0f13'));
  glow(cv, 32, 34, 16, CYAN, 0.5);
  cv.fill(ring(32, 34, 10, 13), CYAN);
  cv.fill(ring(32, 34, 12.2, 13), lighten(CYAN, 0.4), 0.6);
  glow(cv, 32, 34, 9, lighten(CYAN, 0.5), 0.8);
  cv.fill(circle(32, 34, 4.5), hex('#c8f6ff'));
  cv.fill(circle(30.3, 32.3, 1.4), WHITE, 0.9);
  return cv;
}

function drawFrame(): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, FRAME_GRAY, hex('#4d525a'), 3);
  // Cross brace with a soft drop shadow.
  const brace = union(seg(8, 8, 56, 56, 7), seg(56, 8, 8, 56, 7));
  cv.fill((x, y) => brace(x - 1, y - 1), BLACK, 0.25);
  cv.fill(brace, hex('#686d76'));
  cv.fill(inter(brace, (x, y) => !brace(x + 1, y + 1)), WHITE, 0.18);
  for (const [x, y] of [[10, 10], [54, 10], [10, 54], [54, 54]] as const) rivet(cv, x, y);
  return cv;
}

function drawBattery(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const green = hex('#3fae5a');
  plate(cv, 0, 0, CELL, CELL, green, hex('#22703a'), 3);
  // Terminal nub on the top (N) edge.
  cv.fill(rect(21, 0, 43, 11), DARK_METAL);
  cv.fill(rect(23, 0, 41, 9), hex('#c3c8cf'));
  cv.fill(rect(23, 0, 41, 2), WHITE, 0.45);
  cv.fill(rect(23, 7, 41, 9), BLACK, 0.25);
  // Label band and plus sign.
  cv.fill(rect(3, 50, 61, 54), darken(green, 0.18));
  const plus = union(rect(29, 20, 35, 44), rect(20, 29, 44, 35));
  cv.fill((x, y) => plus(x - 1, y - 1), BLACK, 0.3);
  cv.fill(plus, hex('#f4f7f5'));
  return cv;
}

/** Wheel radius 0.45 cell. */
const WHEEL_R = CELL * 0.45;

function drawWheel(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const c = 32;
  cv.fill(circle(c, c, WHEEL_R), hex('#1c1d21'));
  // Tread ring broken into blocks: the gaps are a rotation cue too.
  cv.fill(ring(c, c, 20.5, 26.3), hex('#393c43'));
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    cv.fill(seg(c + cs * 20, c + sn * 20, c + cs * 27, c + sn * 27, 2.2), hex('#1c1d21'));
  }
  // Rim edge so the tire reads against the dark world, lit from the top-left.
  cv.fill(ring(c, c, WHEEL_R - 1.1, WHEEL_R), hex('#4a4e57'));
  cv.fill(diff(circle(c, c, WHEEL_R), circle(c + 1.5, c + 1.5, WHEEL_R)), WHITE, 0.18);
  // Hub.
  cv.fill(circle(c, c, 13.5), hex('#121316'));
  shadedDisc(cv, c, c, 12.5, STEEL, 1.3, 0.35, 0.35);
  cv.fill(ring(c, c, 9.8, 10.4), BLACK, 0.25);
  // Three bolts so spin is visible.
  for (const deg of [-90, 30, 150]) {
    const a = (deg * Math.PI) / 180;
    shadedDisc(cv, c + Math.cos(a) * 7.2, c + Math.sin(a) * 7.2, 2, hex('#3a3e45'), 0.7, 0.35, 0.2);
  }
  cv.fill(circle(c, c, 2.6), hex('#2a2d33'));
  return cv;
}

function drawWheelMount(): Canvas {
  const cv = new Canvas(CELL, CELL);
  // Bracket from the cell center up to the top edge (it meets the part above). 12 px wide.
  cv.fill(rect(26, 0, 38, 32), OUTLINE);
  cv.fill(rect(27.5, 0, 36.5, 32), STEEL);
  cv.fill(rect(27.5, 0, 29, 32), WHITE, 0.3);
  cv.fill(rect(35, 0, 36.5, 32), BLACK, 0.25);
  cv.fill(rect(27.5, 4, 36.5, 5), BLACK, 0.2);
  // Axle cap.
  cv.fill(circle(32.6, 32.6, 8), BLACK, 0.35);
  cv.fill(circle(32, 32, 7.5), OUTLINE);
  shadedDisc(cv, 32, 32, 6, hex('#9aa0a9'), 1, 0.4, 0.3);
  cv.fill(circle(32, 32, 1.8), OUTLINE);
  return cv;
}

function drawThruster(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const body = hex('#959ba4');
  // Mounting flanges reaching the E and W faces.
  for (const [x0, x1] of [[0, 14], [50, 64]] as const) {
    cv.fill(rect(x0, 10, x1, 26), OUTLINE);
    cv.fill(rect(x0, 12, x1, 24), hex('#6b7079'));
    cv.fill(rect(x0, 12, x1, 13.5), WHITE, 0.2);
  }
  // Body: 40 px wide, from the top edge down to 44.
  plate(cv, 12, 0, 52, 44, body, OUTLINE, 2);
  cv.fill(rect(14, 12, 50, 13), BLACK, 0.25);
  // Heat band above the nozzle.
  cv.fill(rect(14, 33, 50, 42), hex('#5f646d'));
  for (let x = 18; x < 48; x += 6) cv.fill(rect(x, 35, x + 2.5, 40), DARK_METAL);
  // Throat and flared nozzle bell, pointing south.
  cv.fill(rect(23, 44, 41, 48), DARK_METAL);
  const bell = poly([[22, 47], [42, 47], [56, 64], [8, 64]]);
  cv.fill(bell, DARK_METAL);
  const inner = poly([[24, 48.5], [40, 48.5], [53, 64], [11, 64]]);
  cv.fill(inner, hex('#50555e'));
  cv.fill(inter(inner, (x, y) => x < 32 - (y - 48) * 0.35), WHITE, 0.14);
  cv.fill(inter(inner, (x, y) => x > 34 + (y - 48) * 0.55), BLACK, 0.25);
  cv.fill(rect(9, 61, 55, 64), hex('#6b7079'));
  cv.fill(rect(9, 61, 55, 62), WHITE, 0.2);
  return cv;
}

/** Blade across the top quarter at a given apparent width (1 = full). */
function drawBlade(cv: Canvas, widthFactor: number): void {
  const half = 26 * widthFactor;
  const y = 12;
  const blade = seg(32 - half, y, 32 + half, y, 7);
  cv.fill((x, yy) => blade(x, yy - 1.2), BLACK, 0.3);
  cv.fill(blade, hex('#c9ced6'));
  cv.fill(inter(blade, (_x, yy) => yy > y + 1.2), BLACK, 0.18);
  cv.fill(inter(blade, (_x, yy) => yy < y - 2), WHITE, 0.35);
  // Painted tips.
  const tip = 7 * widthFactor;
  cv.fill(inter(blade, (x) => x < 32 - half + tip || x > 32 + half - tip), YELLOW);
}

function drawPropellerBase(cv: Canvas): void {
  // Housing attached to the bottom (S) edge.
  cv.fill(poly([[19, 34], [45, 34], [49, 41], [15, 41]]), OUTLINE);
  cv.fill(poly([[21, 35.5], [43, 35.5], [46, 40], [18, 40]]), hex('#9aa0a9'));
  plate(cv, 13, 40, 51, 64, FRAME_GRAY, OUTLINE, 2);
  cv.fill(rect(15, 52, 49, 53), BLACK, 0.25);
  for (const x of [19, 45]) rivet(cv, x, 58, 2);
  // Mast.
  cv.fill(rect(28.5, 12, 35.5, 35), OUTLINE);
  cv.fill(rect(30, 12, 34, 35), hex('#7d838d'));
  cv.fill(rect(30, 12, 31, 35), WHITE, 0.3);
}

function drawHubCap(cv: Canvas): void {
  cv.fill(ellipse(32, 12, 5.5, 4.5), OUTLINE);
  cv.fill(ellipse(32, 11.5, 3.8, 3), hex('#aab0b8'));
}

function drawPropeller(widthFactor: number): Canvas {
  const cv = new Canvas(CELL, CELL);
  drawPropellerBase(cv);
  drawBlade(cv, widthFactor);
  drawHubCap(cv);
  return cv;
}

function drawPropellerBlur(): Canvas {
  const cv = new Canvas(CELL, CELL);
  drawPropellerBase(cv);
  // Translucent motion disc seen edge-on, with brighter tip streaks at the ends.
  cv.paint((x, y) => {
    const d = ((x - 32) / 27) ** 2 + ((y - 12) / 5.5) ** 2;
    return d >= 1 ? 0 : 0.5 + 0.5 * (1 - d);
  }, hex('#c9ced6'), 0.6);
  cv.paint((x, y) => {
    const d = ((x - 32) / 27) ** 2 + ((y - 12) / 4) ** 2;
    return d >= 1 || d < 0.72 ? 0 : 1;
  }, YELLOW, 0.55);
  drawHubCap(cv);
  return cv;
}

function drawDecoupler(): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, hex('#868c96'), hex('#4a4f57'), 3);
  // Hazard band on the release (N) edge, with a seam under it.
  hazard(cv, rect(3, 3, 61, 17));
  cv.fill(rect(3, 3, 61, 4.5), WHITE, 0.25);
  cv.fill(rect(3, 17, 61, 20), DARK_METAL);
  cv.fill(rect(3, 20, 61, 21), WHITE, 0.2);
  // Latch block and bolts.
  cv.fill(rect(24, 30, 40, 46), OUTLINE);
  cv.fill(rect(26, 32, 38, 44), hex('#a2a8b1'));
  bevel(cv, 26, 32, 38, 44, 1.5, 0.3, 0.3);
  for (const [x, y] of [[10, 30], [54, 30], [10, 54], [54, 54]] as const) rivet(cv, x, y, 2.4);
  return cv;
}

function drawWarhead(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const red = hex('#8e2323');
  plate(cv, 0, 0, CELL, CELL, red, hex('#561414'), 3);
  // Nose band on the top edge.
  cv.fill(rect(3, 3, 61, 14), hex('#c0463c'));
  cv.fill(rect(3, 3, 61, 5), WHITE, 0.25);
  cv.fill(rect(3, 14, 61, 16), hex('#561414'));
  // Hazard circle: black ring, yellow disc, trefoil.
  const cx = 32;
  const cy = 38;
  cv.fill(circle(cx + 1, cy + 1, 15.5), BLACK, 0.35);
  cv.fill(circle(cx, cy, 15.5), hex('#1d1f23'));
  cv.fill(circle(cx, cy, 13.5), YELLOW);
  cv.fill(diff(circle(cx, cy, 13.5), circle(cx + 1, cy + 1, 13.5)), WHITE, 0.3);
  const trefoil: Shape = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (r < 3.8 || r > 11) return false;
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return [270, 30, 150].some((c) => Math.abs(((deg - c + 540) % 360) - 180) <= 30);
  };
  cv.fill(trefoil, hex('#1d1f23'));
  cv.fill(circle(cx, cy, 2.4), hex('#1d1f23'));
  return cv;
}

// ---------------------------------------------------------------- fx

/** Flame anchored at the top edge (the nozzle exit), pointing down. */
function drawFlame(length: number, width: number, seed: number): Canvas {
  const cv = new Canvas(CELL, CELL);
  const rnd = mulberry32(seed);
  const wobble = rnd() * Math.PI * 2;
  const halfWidth = (y: number, scale: number): number => {
    const t = y / (length * scale);
    if (t >= 1) return 0;
    const bulge = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, t * 1.6));
    return (width / 2) * scale * bulge * (1 - t) ** 0.8;
  };
  const layer = (scale: number, c: Rgb, alpha: number, soft: number): void => {
    cv.paint((x, y) => {
      const w = halfWidth(y, scale);
      if (w <= 0) return 0;
      const sway = Math.sin(y * 0.18 + wobble) * 1.2 * (y / length);
      const t = Math.abs(x - 32 - sway) / w;
      return (1 - t) * soft;
    }, c, alpha);
  };
  layer(1, hex('#ff5a14'), 0.75, 2.2);
  layer(0.8, hex('#ff9a1f'), 0.85, 2.5);
  layer(0.55, hex('#ffd23a'), 0.95, 3);
  layer(0.3, hex('#fff6c8'), 1, 3);
  return cv;
}

// ---------------------------------------------------------------- terrain

/** Periodic value noise in [-1, 1] on a lattice of `cells` per tile. Seamless by construction. */
function tileNoise(seed: number, cells: number): (px: number, py: number) => number {
  const rnd = mulberry32(seed);
  const lattice: number[] = [];
  for (let i = 0; i < cells * cells; i++) lattice.push(rnd() * 2 - 1);
  const at = (i: number, j: number): number => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
  const step = CELL / cells;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (px, py) => {
    const fx = (px + 0.5) / step;
    const fy = (py + 0.5) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = smooth(fx - i);
    const ty = smooth(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function shadeNoise(cv: Canvas, noise: (px: number, py: number) => number, amount: number): void {
  cv.eachPixel((px, py) => {
    const n = noise(px, py);
    if (n > 0) cv.blend(px, py, WHITE, n * amount);
    else cv.blend(px, py, BLACK, -n * amount);
  });
}

function speckle(cv: Canvas, seed: number, count: number, light: Rgb, dark: Rgb, yMin = 0): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * CELL;
    const y = yMin + rnd() * (CELL - yMin);
    const r = 0.5 + rnd() * 1.1;
    const isLight = rnd() < 0.45;
    const a = 0.35 + rnd() * 0.4;
    cv.fill(wrap(circle(x, y, r)), isLight ? light : dark, a);
  }
}

const GROUND = hex('#3d352e');

function drawGround(): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.fill(rect(0, 0, CELL, CELL), GROUND);
  shadeNoise(cv, tileNoise(11, 4), 0.07);
  shadeNoise(cv, tileNoise(12, 16), 0.04);
  speckle(cv, 13, 60, hex('#5a5046'), hex('#231e1a'));
  // A few pebbles.
  const rnd = mulberry32(14);
  for (let i = 0; i < 4; i++) {
    const x = rnd() * CELL;
    const y = rnd() * CELL;
    const r = 1.2 + rnd() * 1;
    cv.fill(wrap(circle(x + 0.7, y + 0.7, r)), BLACK, 0.25);
    cv.fill(wrap(circle(x, y, r)), hex('#4f463d'));
    cv.fill(wrap(diff(circle(x, y, r), circle(x + 0.7, y + 0.7, r))), WHITE, 0.1);
  }
  return cv;
}

function drawGroundTop(ground: Canvas): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.copyFrom(ground);
  // Wavy lower edge, periodic across the tile width so it repeats left to right.
  const edge = (x: number): number => 7 + 0.9 * Math.sin((x / CELL) * Math.PI * 2 * 3) + 0.5 * Math.sin((x / CELL) * Math.PI * 2 * 5 + 1.3);
  cv.fill((x, y) => y >= edge(x) && y < edge(x) + 2, BLACK, 0.35);
  const band: Shape = (x, y) => y < edge(x);
  cv.fill(band, hex('#6b5d4a'));
  const n = tileNoise(21, 8);
  cv.eachPixel((px, py) => {
    if (py > 9) return;
    const v = n(px, py);
    if (band(px + 0.5, py + 0.5)) cv.blend(px, py, v > 0 ? WHITE : BLACK, Math.abs(v) * 0.08);
  });
  const rnd = mulberry32(22);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * CELL;
    const y = 2 + rnd() * 4;
    cv.fill(inter(band, wrap(circle(x, y, 0.6 + rnd() * 0.6))), rnd() < 0.5 ? hex('#857660') : hex('#4d4234'), 0.6);
  }
  cv.fill(rect(0, 0, CELL, 1), hex('#8a7b63'));
  cv.fill(rect(0, 1, CELL, 2), hex('#7a6c56'), 0.6);
  return cv;
}

function drawBlock(): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.fill(rect(0, 0, CELL, CELL), hex('#585d65'));
  shadeNoise(cv, tileNoise(31, 4), 0.05);
  shadeNoise(cv, tileNoise(32, 32), 0.035);
  speckle(cv, 33, 40, hex('#6d737b'), hex('#43474e'));
  // Faint cracks: short random walks kept away from the edges.
  const rnd = mulberry32(34);
  for (let c = 0; c < 2; c++) {
    let x = 14 + rnd() * 36;
    let y = 14 + rnd() * 36;
    let a = rnd() * Math.PI * 2;
    const parts: Shape[] = [];
    for (let s = 0; s < 5; s++) {
      a += (rnd() - 0.5) * 1.3;
      const nx = Math.max(6, Math.min(58, x + Math.cos(a) * 4.5));
      const ny = Math.max(6, Math.min(58, y + Math.sin(a) * 4.5));
      parts.push(seg(x, y, nx, ny, 1.1 - s * 0.12));
      x = nx;
      y = ny;
    }
    cv.fill(union(...parts), hex('#33373d'), 0.4);
  }
  // Subtle bevel: tiled blocks read as panels with a groove between them.
  bevel(cv, 0, 0, CELL, CELL, 2, 0.1, 0.3);
  cv.fill(rect(0, 0, CELL, 1), WHITE, 0.06);
  return cv;
}

// ---------------------------------------------------------------- atlas

interface NamedFrame {
  name: string;
  canvas: Canvas;
}

interface SheetFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

/** Grid atlas: every frame gets 1 px of edge extrusion and 2 px of transparent padding between neighbors. */
function packSheet(frames: NamedFrame[], image: string, animations?: Record<string, string[]>): { png: Buffer; json: string } {
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const slot = CELL + 2 * EXTRUDE + PAD;
  const w = PAD + cols * slot;
  const h = PAD + rows * slot;
  const sheet = new Canvas(w, h);
  const out: Record<string, SheetFrame> = {};
  frames.forEach(({ name, canvas }, i) => {
    const fx = PAD + (i % cols) * slot + EXTRUDE;
    const fy = PAD + Math.floor(i / cols) * slot + EXTRUDE;
    for (let y = -EXTRUDE; y < CELL + EXTRUDE; y++) {
      for (let x = -EXTRUDE; x < CELL + EXTRUDE; x++) {
        const sx = Math.max(0, Math.min(CELL - 1, x));
        const sy = Math.max(0, Math.min(CELL - 1, y));
        sheet.set(fx + x, fy + y, canvas.get(sx, sy));
      }
    }
    out[name] = {
      frame: { x: fx, y: fy, w: CELL, h: CELL },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL },
      sourceSize: { w: CELL, h: CELL },
    };
  });
  const json: Record<string, unknown> = { frames: out };
  if (animations) json.animations = animations;
  json.meta = { image, format: 'RGBA8888', size: { w, h }, scale: '1' };
  return { png: encodePng(sheet), json: JSON.stringify(json, null, 2) + '\n' };
}

function encodePng(cv: Canvas): Buffer {
  const png = new PNG({ width: cv.w, height: cv.h });
  png.data = Buffer.from(cv.data);
  return PNG.sync.write(png, { colorType: 6, inputHasAlpha: true, deflateLevel: 9 });
}

function write(rel: string, content: Buffer | string): void {
  const path = join(OUT_DIR, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote public/assets/${rel}`);
}

// ---------------------------------------------------------------- main

function main(): void {
  const parts: NamedFrame[] = [
    { name: 'part.core', canvas: drawCore() },
    { name: 'part.frame', canvas: drawFrame() },
    { name: 'part.battery', canvas: drawBattery() },
    { name: 'part.wheel', canvas: drawWheel() },
    { name: 'part.wheel.mount', canvas: drawWheelMount() },
    { name: 'part.thruster', canvas: drawThruster() },
    { name: 'part.propeller', canvas: drawPropeller(1) },
    { name: 'part.decoupler', canvas: drawDecoupler() },
    { name: 'part.warhead', canvas: drawWarhead() },
  ];
  const partsSheet = packSheet(parts, 'parts.png');
  write('sheets/parts.png', partsSheet.png);
  write('sheets/parts.json', partsSheet.json);

  // Propeller frames are the whole propeller (housing, mast, blade phase) so the animation can replace the static sprite.
  const fx: NamedFrame[] = [
    { name: 'fx.propeller.0', canvas: drawPropeller(1) },
    { name: 'fx.propeller.1', canvas: drawPropeller(0.7) },
    { name: 'fx.propeller.2', canvas: drawPropeller(0.3) },
    { name: 'fx.propeller.3', canvas: drawPropellerBlur() },
    { name: 'fx.flame.0', canvas: drawFlame(46, 40, 1) },
    { name: 'fx.flame.1', canvas: drawFlame(60, 42, 2) },
    { name: 'fx.flame.2', canvas: drawFlame(53, 38, 3) },
  ];
  const fxSheet = packSheet(fx, 'fx.png', {
    'fx.propeller': ['fx.propeller.0', 'fx.propeller.1', 'fx.propeller.2', 'fx.propeller.3'],
    'fx.flame': ['fx.flame.0', 'fx.flame.1', 'fx.flame.2'],
  });
  write('sheets/fx.png', fxSheet.png);
  write('sheets/fx.json', fxSheet.json);

  const ground = drawGround();
  write('terrain/ground.png', encodePng(ground));
  write('terrain/ground-top.png', encodePng(drawGroundTop(ground)));
  write('terrain/block.png', encodePng(drawBlock()));

  const manifest = {
    bundles: [
      { name: 'parts', assets: [{ alias: 'parts', src: 'sheets/parts.json' }] },
      { name: 'fx', assets: [{ alias: 'fx', src: 'sheets/fx.json' }] },
      {
        name: 'terrain',
        assets: [
          { alias: 'terrain.ground', src: 'terrain/ground.png' },
          { alias: 'terrain.groundTop', src: 'terrain/ground-top.png' },
          { alias: 'terrain.block', src: 'terrain/block.png' },
        ],
      },
    ],
  };
  write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

main();
