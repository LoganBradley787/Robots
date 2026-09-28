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

function drawBattery(green = hex('#3fae5a'), edge = hex('#22703a')): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, green, edge, 3);
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

/** A small battery: a green can on a frame-grey backing, with a smaller plus. */
function drawCell(): Canvas {
  const cv = new Canvas(CELL, CELL);
  const green = hex('#3fae5a');
  plate(cv, 0, 0, CELL, CELL, hex('#6b7079'), hex('#454950'), 3);
  plate(cv, 16, 12, 48, 58, green, hex('#22703a'), 2);
  cv.fill(rect(26, 6, 38, 12), hex('#c3c8cf'));
  const plus = union(rect(30, 26, 34, 44), rect(23, 33, 41, 37));
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

function drawThruster(body = hex('#959ba4'), heat = hex('#5f646d')): Canvas {
  const cv = new Canvas(CELL, CELL);
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
  cv.fill(rect(14, 33, 50, 42), heat);
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

function drawWarhead(red = hex('#8e2323'), edge = hex('#561414'), band = hex('#c0463c'), armed = false): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, red, edge, 3);
  // Nose band on the top edge.
  cv.fill(rect(3, 3, 61, 14), band);
  cv.fill(rect(3, 3, 61, 5), WHITE, 0.25);
  cv.fill(rect(3, 14, 61, 16), edge);
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
  if (armed) {
    // M10: armed. A lit red light in the nose band (unarmed ones have a dark socket there).
    cv.fill(circle(52, 9, 7.5), hex('#ff2a1a'), 0.35);
    cv.fill(circle(52, 9, 4.6), hex('#1d1f23'));
    cv.fill(circle(52, 9, 3.6), hex('#ff3b2a'));
    cv.fill(circle(51, 8, 1.3), WHITE, 0.8);
  } else {
    cv.fill(circle(52, 9, 4.6), hex('#1d1f23'));
    cv.fill(circle(52, 9, 3.6), hex('#3a1512'));
  }
  return cv;
}

/**
 * Flare (M11): a short red tube in a small mounting plate with a striker cap on top. Lit, the cap end burns white
 * with a yellow and orange glow over the tube.
 */
function drawFlare(lit = false): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 6, 36, 58, 62, hex('#6f747d'), OUTLINE, 2);
  for (const [x, y] of [[12, 49], [52, 49]] as const) rivet(cv, x, y, 2.2);
  plate(cv, 20, 12, 44, 58, hex('#c2412b'), hex('#6e1d12'), 2.5);
  cv.fill(rect(23, 14, 27, 56), WHITE, 0.22);
  cv.fill(rect(22.5, 40, 41.5, 45), YELLOW);
  plate(cv, 18, 6, 46, 16, lit ? hex('#fff3c4') : hex('#3b3e45'), lit ? hex('#ffb13b') : hex('#1d1f23'), 2);
  if (lit) {
    cv.fill(circle(32, 11, 24), hex('#ff9a2e'), 0.28);
    cv.fill(circle(32, 11, 16), hex('#ffd24a'), 0.45);
    cv.fill(circle(32, 11, 9), hex('#fff7d6'), 0.95);
    cv.fill(circle(32, 11, 4.5), WHITE);
  }
  return cv;
}

/**
 * Gun (M13): a riveted base plate, a squat receiver, and a long barrel out of the top (the way it fires at rotation 0)
 * with a muzzle ring and a cooling sleeve.
 */
function drawGun(): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 6, 44, 58, 62, hex('#6f747d'), OUTLINE, 2);
  for (const [x, y] of [[12, 53], [52, 53]] as const) rivet(cv, x, y, 2.2);
  plate(cv, 16, 26, 48, 46, hex('#3d434c'), hex('#1b1e23'), 2.5);
  cv.fill(rect(19, 29, 45, 32), WHITE, 0.15);
  plate(cv, 27, 2, 37, 30, hex('#2b2f35'), hex('#111316'), 2);
  plate(cv, 24, 14, 40, 24, hex('#4f5660'), hex('#1b1e23'), 2);
  for (let y = 16; y < 23; y += 3) cv.fill(rect(25, y, 39, y + 1), hex('#1b1e23'), 0.8);
  plate(cv, 25, 0, 39, 6, hex('#555b64'), hex('#111316'), 2);
  cv.fill(rect(30, 0.5, 34, 4), hex('#0b0c0e'));
  cv.fill(rect(29, 7, 31, 13), WHITE, 0.2);
  return cv;
}

/**
 * Fabricator bay (M12): a U three cells wide and six tall, open at the top. Armored walls in dark steel with a
 * yellow and black band at the mouth, a lit strip down the inside of each wall, and a machine bed at the bottom.
 */
function drawFabBay(): Canvas {
  const cv = new Canvas(3 * CELL, 6 * CELL);
  const W = CELL;
  const H = 6 * CELL;
  const steel = hex('#4b525c');
  const edge = hex('#262a30');
  // Walls and the floor.
  plate(cv, 0, 0, W, H, steel, edge, 3);
  plate(cv, 2 * W, 0, 3 * W, H, steel, edge, 3);
  plate(cv, 0, H - W, 3 * W, H, hex('#3c424b'), edge, 3);
  // The hollow: dark, with a faint grid of the build.
  cv.fill(rect(W, 0, 2 * W, H - W), hex('#12151a'));
  for (let y = W; y < H - W; y += W) cv.fill(rect(W + 4, y - 1, 2 * W - 4, y + 1), hex('#2a3f4a'));
  // Grip strips inside each wall, lit cyan.
  cv.fill(rect(W - 8, 10, W - 3, H - W - 6), hex('#1d6f86'));
  cv.fill(rect(2 * W + 3, 10, 2 * W + 8, H - W - 6), hex('#1d6f86'));
  cv.fill(rect(W - 7, 12, W - 5, H - W - 8), CYAN, 0.8);
  cv.fill(rect(2 * W + 5, 12, 2 * W + 7, H - W - 8), CYAN, 0.8);
  // Hazard bands at the mouth.
  hazard(cv, rect(3, 3, W - 3, 16));
  hazard(cv, rect(2 * W + 3, 3, 3 * W - 3, 16));
  // Machine bed: a press head over the floor and rivets.
  cv.fill(rect(W + 8, H - W + 6, 2 * W - 8, H - W + 20), hex('#8a9099'));
  bevel(cv, W + 8, H - W + 6, 2 * W - 8, H - W + 20, 1.5, 0.3, 0.3);
  for (const [x, y] of [[12, H - 12], [3 * W - 12, H - 12], [12, 30], [3 * W - 12, 30], [W / 2, H / 2], [2.5 * W, H / 2]] as const) rivet(cv, x, y, 3);
  return cv;
}

/** Fabricator bay tiles (M12): drawn per cell so a bay of any size looks built. Left side; the right is flipped. */
function drawFabTile(kind: 'floor' | 'corner' | 'wall' | 'mouth' | 'back'): Canvas {
  const cv = new Canvas(CELL, CELL);
  const steel = hex('#4b525c');
  const edge = hex('#262a30');
  if (kind === 'back') {
    cv.fill(rect(0, 0, CELL, CELL), hex('#12151a'), 0.6);
    cv.fill(rect(0, CELL - 2, CELL, CELL), hex('#2a3f4a'), 0.8);
    return cv;
  }
  if (kind === 'floor') {
    plate(cv, 0, 0, CELL, CELL, hex('#3c424b'), edge, 2);
    // The machine bed: a press plate on top, lit where it grips.
    cv.fill(rect(4, 3, CELL - 4, 12), hex('#8a9099'));
    bevel(cv, 4, 3, CELL - 4, 12, 1.5, 0.3, 0.3);
    cv.fill(rect(6, 1, CELL - 6, 3), CYAN, 0.8);
    rivet(cv, 12, 48, 2.6);
    rivet(cv, CELL - 12, 48, 2.6);
    return cv;
  }
  plate(cv, 0, 0, CELL, CELL, kind === 'corner' ? hex('#3c424b') : steel, edge, 2);
  if (kind !== 'corner') {
    // Grip strip on the inner (right) side.
    cv.fill(rect(CELL - 8, 0, CELL - 3, CELL), hex('#1d6f86'));
    cv.fill(rect(CELL - 7, 0, CELL - 5, CELL), CYAN, 0.8);
  }
  if (kind === 'mouth') {
    hazard(cv, rect(3, 3, CELL - 9, 16));
    rivet(cv, 12, 34, 2.6);
  } else rivet(cv, 12, 32, 2.6);
  return cv;
}

/** Seeker (M8): a dark housing with a glass eye on the top (N) edge, the way it looks, and a green lens glow. */
function drawSeeker(): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, hex('#2f4a3a'), hex('#1b2b22'), 3);
  for (const [x, y] of [[9, 55], [55, 55]] as const) rivet(cv, x, y);
  // Eye: a dome cut by the top edge, glass over a lens.
  const cx = 32;
  const cy = 22;
  cv.fill(circle(cx, cy, 17), DARK_METAL);
  cv.fill(circle(cx, cy, 14), hex('#0f1a14'));
  cv.fill(circle(cx, cy, 9), hex('#3dff8b'), 0.9);
  cv.fill(circle(cx, cy, 4), hex('#d8ffe8'));
  glow(cv, cx, cy, 16, hex('#3dff8b'), 0.45);
  cv.fill(diff(circle(cx, cy, 14), circle(cx + 3, cy + 3, 14)), WHITE, 0.25);
  // Sight lines fanning out of the top edge: it looks up (its cone).
  cv.fill(union(seg(cx, cy - 6, 12, 3, 1.4), seg(cx, cy - 6, 52, 3, 1.4)), hex('#3dff8b'), 0.5);
  cv.fill(rect(18, 44, 46, 48), hex('#1b2b22'));
  return cv;
}

/** Radar (M8): a round dish with sweep rings; it sees all around. */
function drawRadar(): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, hex('#4a5663'), hex('#2a323b'), 3);
  for (const [x, y] of [[9, 9], [55, 9], [9, 55], [55, 55]] as const) rivet(cv, x, y);
  const cx = 32;
  const cy = 32;
  cv.fill(circle(cx, cy, 22), hex('#16202a'));
  for (const r of [8, 14, 20]) cv.fill(ring(cx, cy, r - 0.8, r + 0.8), hex('#3dff8b'), 0.55);
  // Sweep: a bright wedge from the center.
  const sweep: Shape = (x, y) => {
    const r = Math.hypot(x - cx, y - cy);
    if (r > 21) return false;
    const deg = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
    return deg >= 300 && deg <= 345;
  };
  cv.fill(sweep, hex('#3dff8b'), 0.6);
  cv.fill(seg(cx, cy, cx + 20 * Math.cos((345 * Math.PI) / 180), cy + 20 * Math.sin((345 * Math.PI) / 180), 1.6), hex('#d8ffe8'));
  cv.fill(circle(cx, cy, 3), hex('#d8ffe8'));
  return cv;
}

// ---------------------------------------------------------------- fx

/** Flame anchored at the top edge (the nozzle exit), pointing down. */
function drawGyro(violet = hex('#5b3fa8'), edge = hex('#34226a')): Canvas {
  const cv = new Canvas(CELL, CELL);
  plate(cv, 0, 0, CELL, CELL, violet, edge, 3);
  for (const [x, y] of [[9, 9], [55, 9], [9, 55], [55, 55]] as const) rivet(cv, x, y);
  // Rotor: a steel disc in a dark well, with spokes.
  const cx = 32;
  const cy = 32;
  cv.fill(circle(cx, cy, 19), hex('#1e1533'));
  shadedDisc(cv, cx, cy, 15, STEEL);
  cv.fill(ring(cx, cy, 11, 12.5), DARK_METAL, 0.8);
  cv.fill(union(seg(cx - 10, cy, cx + 10, cy, 2.4), seg(cx, cy - 10, cx, cy + 10, 2.4)), DARK_METAL, 0.7);
  cv.fill(circle(cx, cy, 4), hex('#c9b8ff'));
  glow(cv, cx, cy, 7, hex('#b89bff'), 0.5);
  // Two curved arrows around the rotor, one each way: it turns the robot both ways.
  const arc = (from: number, to: number): Shape => (x, y) => {
    const r = Math.hypot(x - cx, y - cy);
    if (r < 21.5 || r > 25) return false;
    const deg = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
    return deg >= from && deg <= to;
  };
  const tip = (deg: number, dir: 1 | -1): Shape => {
    const a = (deg * Math.PI) / 180;
    const px = cx + 23.2 * Math.cos(a);
    const py = cy + 23.2 * Math.sin(a);
    const tx = -Math.sin(a) * dir;
    const ty = Math.cos(a) * dir;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    return poly([
      [px + tx * 6, py + ty * 6],
      [px + nx * 4.5, py + ny * 4.5],
      [px - nx * 4.5, py - ny * 4.5],
    ]);
  };
  const lilac = hex('#d9ccff');
  cv.fill(union(arc(200, 300), tip(300, 1)), lilac);
  cv.fill(union(arc(20, 120), tip(120, 1)), lilac);
  return cv;
}

const TURRET = hex('#b8732e');

/** Drawn on the parent body at the joint (it does not turn): a base block from the cell center down to the bottom edge. */
function drawRotatorMount(): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.fill(poly([[10, 64], [54, 64], [46, 36], [18, 36]]), OUTLINE);
  cv.fill(poly([[12.5, 62.5], [51.5, 62.5], [44.5, 38], [19.5, 38]]), STEEL);
  cv.fill(rect(12.5, 58, 51.5, 62.5), BLACK, 0.25);
  for (const x of [18, 46] as const) rivet(cv, x, 56, 2.2);
  return cv;
}

/** The turning part: a turntable with a turret plate on top; the notch points where it aims (N at rotation 0). */
function drawRotator(): Canvas {
  const cv = new Canvas(CELL, CELL);
  // Turret plate across the top and sides (what it carries attaches there).
  cv.fill(rect(0, 0, 64, 30), OUTLINE);
  cv.fill(rect(2.5, 2.5, 61.5, 27.5), TURRET);
  bevel(cv, 2.5, 2.5, 61.5, 27.5, 2, 0.3, 0.3);
  for (const [x, y] of [[9, 9], [55, 9]] as const) rivet(cv, x, y);
  // Turntable disc on the axle.
  cv.fill(circle(32.8, 32.8, 20), BLACK, 0.35);
  cv.fill(circle(32, 32, 19.5), OUTLINE);
  shadedDisc(cv, 32, 32, 17, lighten(TURRET, 0.15), 1.2, 0.35, 0.35);
  cv.fill(ring(32, 32, 11, 12.5), DARK_METAL, 0.7);
  // Aim notch toward N.
  cv.fill(poly([[32, 6], [39, 20], [25, 20]]), YELLOW);
  cv.fill(poly([[32, 6], [39, 20], [25, 20]]), BLACK, 0.15);
  cv.fill(circle(32, 32, 4.5), DARK_METAL);
  shadedDisc(cv, 32, 32, 3, STEEL, 0.8, 0.4, 0.3);
  return cv;
}

const PISTON = hex('#3f8f8b');

/** Batch: the piston's head, which slides (N at rotation 0): a plate across the top and a rod stub down to the bottom edge. */
function drawPiston(): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.fill(rect(24, 20, 40, 64), OUTLINE);
  cv.fill(rect(26.5, 20, 37.5, 64), STEEL);
  cv.fill(rect(26.5, 20, 29.5, 64), WHITE, 0.3);
  cv.fill(rect(0, 0, 64, 24), OUTLINE);
  cv.fill(rect(2.5, 2.5, 61.5, 21.5), PISTON);
  bevel(cv, 2.5, 2.5, 61.5, 21.5, 2, 0.3, 0.3);
  for (const [x, y] of [[9, 12], [55, 12]] as const) rivet(cv, x, y);
  cv.fill(poly([[32, 5], [38, 12], [26, 12]]), YELLOW);
  return cv;
}

/** Drawn on the parent body at the joint (it does not slide): the sleeve the head slides out of, over the cell's lower half. */
function drawPistonMount(): Canvas {
  const cv = new Canvas(CELL, CELL);
  cv.fill(rect(10, 36, 54, 64), OUTLINE);
  cv.fill(rect(12.5, 38.5, 51.5, 61.5), lighten(PISTON, -0.1));
  bevel(cv, 12.5, 38.5, 51.5, 61.5, 2, 0.3, 0.3);
  cv.fill(rect(12.5, 36, 51.5, 42), DARK_METAL);
  cv.fill(rect(24, 36, 40, 42), BLACK, 0.5);
  for (const x of [18, 46] as const) rivet(cv, x, 54, 2.2);
  return cv;
}

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
  // One-cell frames in a square grid, as before; bigger ones (M12: multi-cell parts) in a row underneath.
  const small = frames.filter((f) => f.canvas.w === CELL && f.canvas.h === CELL);
  const big = frames.filter((f) => !small.includes(f));
  const cols = Math.max(1, Math.ceil(Math.sqrt(small.length)));
  const rows = Math.ceil(small.length / cols);
  const slot = CELL + 2 * EXTRUDE + PAD;
  const at = new Map<NamedFrame, { x: number; y: number }>();
  small.forEach((f, i) => at.set(f, { x: PAD + (i % cols) * slot + EXTRUDE, y: PAD + Math.floor(i / cols) * slot + EXTRUDE }));
  let x = PAD;
  const top = PAD + rows * slot;
  let bigH = 0;
  for (const f of big) {
    at.set(f, { x: x + EXTRUDE, y: top + EXTRUDE });
    x += f.canvas.w + 2 * EXTRUDE + PAD;
    bigH = Math.max(bigH, f.canvas.h + 2 * EXTRUDE + PAD);
  }
  const w = Math.max(PAD + cols * slot, x);
  const h = top + bigH;
  const sheet = new Canvas(w, h);
  const out: Record<string, SheetFrame> = {};
  for (const f of frames) {
    const { name, canvas } = f;
    const p = at.get(f) as { x: number; y: number };
    for (let y = -EXTRUDE; y < canvas.h + EXTRUDE; y++) {
      for (let x2 = -EXTRUDE; x2 < canvas.w + EXTRUDE; x2++) {
        const sx = Math.max(0, Math.min(canvas.w - 1, x2));
        const sy = Math.max(0, Math.min(canvas.h - 1, y));
        sheet.set(p.x + x2, p.y + y, canvas.get(sx, sy));
      }
    }
    out[name] = {
      frame: { x: p.x, y: p.y, w: canvas.w, h: canvas.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: canvas.w, h: canvas.h },
      sourceSize: { w: canvas.w, h: canvas.h },
    };
  }
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
    { name: 'part.cell', canvas: drawCell() },
    { name: 'part.wheel', canvas: drawWheel() },
    { name: 'part.wheel.mount', canvas: drawWheelMount() },
    { name: 'part.thruster', canvas: drawThruster() },
    { name: 'part.propeller', canvas: drawPropeller(1) },
    { name: 'part.decoupler', canvas: drawDecoupler() },
    { name: 'part.warhead', canvas: drawWarhead() },
    { name: 'part.warhead.armed', canvas: drawWarhead(undefined, undefined, undefined, true) },
    { name: 'part.gyro', canvas: drawGyro() },
    { name: 'part.rotator', canvas: drawRotator() },
    { name: 'part.rotator.mount', canvas: drawRotatorMount() },
    { name: 'part.seeker', canvas: drawSeeker() },
    // Booster (Gate 7): the thruster in orange, with a hot band; heavy warhead: the warhead in near black with an orange band.
    { name: 'part.booster', canvas: drawThruster(hex('#d0762c'), hex('#8a3b12')) },
    { name: 'part.heavywarhead', canvas: drawWarhead(hex('#2a2c31'), hex('#121316'), hex('#e0712c')) },
    { name: 'part.heavywarhead.armed', canvas: drawWarhead(hex('#2a2c31'), hex('#121316'), hex('#e0712c'), true) },
    // Heavy gyro: the gyro in dark teal.
    { name: 'part.heavygyro', canvas: drawGyro(hex('#1f7a78'), hex('#0f4543')) },
    // Dense battery (Logan): the battery in blue.
    { name: 'part.densebattery', canvas: drawBattery(hex('#3f7fd6'), hex('#224a80')) },
    { name: 'part.radar', canvas: drawRadar() },
    { name: 'part.flare', canvas: drawFlare() },
    { name: 'part.flare.lit', canvas: drawFlare(true) },
    { name: 'part.gun', canvas: drawGun() },
    { name: 'part.piston', canvas: drawPiston() },
    { name: 'part.piston.mount', canvas: drawPistonMount() },
    { name: 'part.fabbay', canvas: drawFabBay() },
    { name: 'part.fabbay.floor', canvas: drawFabTile('floor') },
    { name: 'part.fabbay.corner', canvas: drawFabTile('corner') },
    { name: 'part.fabbay.wall', canvas: drawFabTile('wall') },
    { name: 'part.fabbay.mouth', canvas: drawFabTile('mouth') },
    { name: 'part.fabbay.back', canvas: drawFabTile('back') },
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
