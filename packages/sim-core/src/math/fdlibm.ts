/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * sin, cos, atan, atan2 and asin below are a TypeScript port of fdlibm 5.3 (http://www.netlib.org/fdlibm: s_sin.c,
 * s_cos.c, k_sin.c, k_cos.c, e_rem_pio2.c, k_rem_pio2.c, s_atan.c, e_atan2.c, e_asin.c), the library V8 ships as
 * src/base/ieee754.cc.
 */

/**
 * Math that gives the same bits on every JS engine (M16). ECMAScript lets each engine approximate `Math.sin`, `cos`,
 * `atan2`, `hypot`, `pow` and the rest its own way, and they do: Chrome 155's `Math.cos` is correctly rounded, Node 24's
 * is fdlibm, and they part by one unit in the last place often enough that a battle seen in the browser ended
 * somewhere else when replayed in Node. These are written only with `+ - * /`, `Math.sqrt`, `Math.abs`, `Math.floor`,
 * integer ops and reading a double's bits, which IEEE 754 and the spec make exact everywhere, so they are the same
 * in every engine. They are fdlibm's own algorithms, so they give what Node 24 for x64 gives, bit for bit (Node for
 * arm64 differs in about 1 call in 200, as its C compiler fuses fdlibm's multiply-adds), and the sim's recorded
 * hashes did not move.
 *
 * `sim-core` calls these instead of the host's `Math`; `test/hostMath.test.ts` fails on a `Math` call that is not exact.
 */

const bits = new DataView(new ArrayBuffer(8));

/** The high 32 bits of x as a signed integer (fdlibm's `__HI`): sign, exponent and the top 20 bits of the fraction. */
function highWord(x: number): number {
  bits.setFloat64(0, x);
  return bits.getInt32(0);
}

/** The low 32 bits of x, unsigned (fdlibm's `__LO`). */
function lowWord(x: number): number {
  bits.setFloat64(0, x);
  return bits.getUint32(4);
}

/** The double whose high and low words these are (fdlibm's `INSERT_WORDS`). */
function fromWords(hi: number, lo: number): number {
  bits.setInt32(0, hi | 0);
  bits.setUint32(4, lo >>> 0);
  return bits.getFloat64(0);
}

/** x times 2^n, exact: the reduction only asks for n where 2^n is a normal double (-1022 to 1023). */
function scalbn(x: number, n: number): number {
  return x * fromWords((n + 1023) << 20, 0);
}

// k_sin.c: sin on [-pi/4, pi/4], x + y the argument (y the tail of a reduced one), iy 0 when y is 0.
const S1 = -1.66666666666666324348e-1; /* 0xBFC55555, 0x55555549 */
const S2 = 8.33333333332248946124e-3; /* 0x3F811111, 0x1110F8A6 */
const S3 = -1.98412698298579493134e-4; /* 0xBF2A01A0, 0x19C161D5 */
const S4 = 2.75573137070700676789e-6; /* 0x3EC71DE3, 0x57B1FE7D */
const S5 = -2.50507602534068634195e-8; /* 0xBE5AE5E6, 0x8A2B9CEB */
const S6 = 1.58969099521155010221e-10; /* 0x3DE5D93A, 0x5ACFD57C */

function kernelSin(x: number, y: number, iy: number): number {
  // |x| < 2^-27: sin x is x to the last bit.
  if ((highWord(x) & 0x7fffffff) < 0x3e400000) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

// k_cos.c: cos on [-pi/4, pi/4].
const C1 = 4.16666666666666019037e-2; /* 0x3FA55555, 0x5555554C */
const C2 = -1.38888888888741095749e-3; /* 0xBF56C16C, 0x16C15177 */
const C3 = 2.48015872894767294178e-5; /* 0x3EFA01A0, 0x19CB1590 */
const C4 = -2.75573143513906633035e-7; /* 0xBE927E4F, 0x809C52AD */
const C5 = 2.08757232129817482790e-9; /* 0x3E21EE9E, 0xBDB4B1C4 */
const C6 = -1.13596475577881948265e-11; /* 0xBDA8FAE9, 0xBE8838D4 */

function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  // |x| < 2^-27: cos x is 1 to the last bit.
  if (ix < 0x3e400000) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  // |x| < 0.3
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  // qx is x/4 (its high word only), or 0.28125 past 0.78125, so 1 - qx is exact.
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// e_rem_pio2.c: x - n * pi/2 as y0 + y1, |y0 + y1| <= pi/4, returning n.
const INVPIO2 = 6.36619772367581382433e-1; /* 0x3FE45F30, 0x6DC9C883 */
const PIO2_1 = 1.57079632673412561417; /* 0x3FF921FB, 0x54400000: first 33 bits of pi/2 */
const PIO2_1T = 6.07710050650619224932e-11; /* 0x3DD0B461, 0x1A626331: pi/2 - PIO2_1 */
const PIO2_2 = 6.07710050630396597660e-11; /* 0x3DD0B461, 0x1A600000: second 33 bits */
const PIO2_2T = 2.02226624879595063154e-21; /* 0x3BA3198A, 0x2E037073: pi/2 - (PIO2_1 + PIO2_2) */
const PIO2_3 = 2.02226624871116645580e-21; /* 0x3BA3198A, 0x2E000000: third 33 bits */
const PIO2_3T = 8.47842766036889956997e-32; /* 0x397B839A, 0x252049C1: pi/2 - (PIO2_1 + PIO2_2 + PIO2_3) */
const TWO24 = 16777216; /* 0x41700000, 0x00000000 */
const TWON24 = 5.9604644775390625e-8; /* 0x3E700000, 0x00000000 */

/** The high word of n * pi/2 for n = 1 to 32: an argument this near one may cancel, and takes more of pi/2. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c,
  0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

/** 2/pi in 24-bit pieces, 1584 bits: enough for the largest double. */
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7, 0x246e3a, 0x424dd2, 0xe00649,
  0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c, 0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b,
  0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5,
  0xf17b3d, 0x0739f7, 0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e, 0xe61b08,
  0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];

/** pi/2 in 24-bit pieces, each a double. */
const PIO2 = [
  1.57079625129699707031 /* 0x3FF921FB, 0x40000000 */, 7.54978941586159635335e-8 /* 0x3E74442D, 0x00000000 */,
  5.39030252995776476554e-15 /* 0x3CF84698, 0x80000000 */, 3.28200341580791294123e-22 /* 0x3B78CC51, 0x60000000 */,
  1.27065575308067607349e-29 /* 0x39F01B83, 0x80000000 */, 1.22933308981111328932e-36 /* 0x387A2520, 0x40000000 */,
  2.73370053816464559624e-44 /* 0x36E38222, 0x80000000 */, 2.16741683877804819444e-51 /* 0x3569F31D, 0x00000000 */,
];

/** The reduced argument, head and tail, left here by `remPio2` (fdlibm's `y[0]`, `y[1]`). */
let y0 = 0;
let y1 = 0;

function remPio2(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  // |x| <= pi/4: nothing to take off.
  if (ix <= 0x3fe921fb) {
    y0 = x;
    y1 = 0;
    return 0;
  }
  // |x| < 3pi/4: n is 1 or -1. 33 + 53 bits of pi/2 is enough, but near pi/2 itself 33 + 33 + 53.
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y0 = z - PIO2_1T;
        y1 = z - y0 - PIO2_1T;
      } else {
        z -= PIO2_2;
        y0 = z - PIO2_2T;
        y1 = z - y0 - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y0 = z + PIO2_1T;
      y1 = z - y0 + PIO2_1T;
    } else {
      z += PIO2_2;
      y0 = z + PIO2_2T;
      y1 = z - y0 + PIO2_2T;
    }
    return -1;
  }
  // |x| <= 2^19 * pi/2: n * pi/2 taken off in 33-bit pieces, one more each time the result cancels too far.
  if (ix <= 0x413921fb) {
    const t = Math.abs(x);
    const n = (t * INVPIO2 + 0.5) | 0;
    const fn = n;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      y0 = r - w;
    } else {
      const j = ix >> 20;
      y0 = r - w;
      let i = j - ((highWord(y0) >> 20) & 0x7ff);
      if (i > 16) {
        let u = r;
        w = fn * PIO2_2;
        r = u - w;
        w = fn * PIO2_2T - (u - r - w);
        y0 = r - w;
        i = j - ((highWord(y0) >> 20) & 0x7ff);
        if (i > 49) {
          u = r;
          w = fn * PIO2_3;
          r = u - w;
          w = fn * PIO2_3T - (u - r - w);
          y0 = r - w;
        }
      }
    }
    y1 = r - y0 - w;
    if (hx < 0) {
      y0 = -y0;
      y1 = -y1;
      return -n;
    }
    return n;
  }
  // Infinity or NaN.
  if (ix >= 0x7ff00000) {
    y0 = y1 = x - x;
    return 0;
  }
  // Larger: |x| scaled to [2^23, 2^24) and cut into three 24-bit pieces, then reduced with as much of 2/pi as needed.
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), lowWord(x));
  const tx = [0, 0, 0];
  for (let i = 0; i < 2; i++) {
    tx[i] = z | 0;
    z = (z - (tx[i] as number)) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  const n = kernelRemPio2(tx, e0, nx);
  if (hx < 0) {
    y0 = -y0;
    y1 = -y1;
    return -n;
  }
  return n;
}

/**
 * k_rem_pio2.c at fdlibm's precision 2 (53 + 53 bits): x (nx 24-bit pieces, times 2^e0) minus a multiple of pi/2,
 * into y0 + y1, returning the multiple mod 8. `(int)` casts of non-negative values are `| 0`.
 */
function kernelRemPio2(x: readonly number[], e0: number, nx: number): number {
  const jk = 4;
  const jp = jk;
  const jx = nx - 1;
  const jv = Math.max(0, ((e0 - 3) / 24) | 0);
  let q0 = e0 - 24 * (jv + 1);
  const at = (a: readonly number[], i: number): number => a[i] as number;
  const f: number[] = [];
  const q: number[] = [];
  const iq: number[] = [];
  const fq: number[] = [];
  // f[0] to f[jx + jk], f[jx + jk] = TWO_OVER_PI[jv + jk].
  for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++) f[i] = j < 0 ? 0 : at(TWO_OVER_PI, j);
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (let j = 0; j <= jx; j++) fw += at(x, j) * at(f, jx + i - j);
    q[i] = fw;
  }
  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    // Distill q[] into iq[], last first.
    z = at(q, jz);
    for (let i = 0, j = jz; j > 0; i++, j--) {
      const fw = (TWON24 * z) | 0;
      iq[i] = (z - TWO24 * fw) | 0;
      z = at(q, j - 1) + fw;
    }
    // n, after the integer part past 8 is dropped.
    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      // iq[jz - 1] holds part of n.
      const i = at(iq, jz - 1) >> (24 - q0);
      n += i;
      iq[jz - 1] = at(iq, jz - 1) - (i << (24 - q0));
      ih = at(iq, jz - 1) >> (23 - q0);
    } else if (q0 === 0) ih = at(iq, jz - 1) >> 23;
    else if (z >= 0.5) ih = 2;
    // The fraction is over a half: take 1 minus it, and one more for n.
    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (let i = 0; i < jz; i++) {
        const j = at(iq, i);
        if (carry === 0) {
          if (j !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else iq[i] = 0xffffff - j;
      }
      if (q0 === 1) iq[jz - 1] = at(iq, jz - 1) & 0x7fffff;
      else if (q0 === 2) iq[jz - 1] = at(iq, jz - 1) & 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }
    // Everything after the leading pieces cancelled: take k more pieces of 2/pi and do it again.
    if (z !== 0) break;
    let j = 0;
    for (let i = jz - 1; i >= jk; i--) j |= at(iq, i);
    if (j !== 0) break;
    let k = 1;
    while (at(iq, jk - k) === 0) k++;
    for (let i = jz + 1; i <= jz + k; i++) {
      f[jx + i] = at(TWO_OVER_PI, jv + i);
      let fw = 0;
      for (let jj = 0; jj <= jx; jj++) fw += at(x, jj) * at(f, jx + i - jj);
      q[i] = fw;
    }
    jz += k;
  }
  // Drop zero pieces, or split z into 24-bit ones.
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (at(iq, jz) === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      const fw = (TWON24 * z) | 0;
      iq[jz] = (z - TWO24 * fw) | 0;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else iq[jz] = z | 0;
  }
  // The pieces as doubles, then times pi/2.
  let fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    q[i] = fw * at(iq, i);
    fw *= TWON24;
  }
  for (let i = jz; i >= 0; i--) {
    fw = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += at(PIO2, k) * at(q, i + k);
    fq[jz - i] = fw;
  }
  // Into y0 + y1.
  fw = 0;
  for (let i = jz; i >= 0; i--) fw += at(fq, i);
  y0 = ih === 0 ? fw : -fw;
  fw = at(fq, 0) - fw;
  for (let i = 1; i <= jz; i++) fw += at(fq, i);
  y1 = ih === 0 ? fw : -fw;
  return n & 7;
}

/** sin x, fdlibm's s_sin.c: the same bits on every engine. */
export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  switch (remPio2(x) & 3) {
    case 0:
      return kernelSin(y0, y1, 1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, 1);
    default:
      return -kernelCos(y0, y1);
  }
}

/** cos x, fdlibm's s_cos.c: the same bits on every engine. */
export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  switch (remPio2(x) & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, 1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, 1);
  }
}

// s_atan.c: atan of 0.5, 1, 1.5 and infinity, head and tail, and the polynomial.
const ATAN_HI = [
  4.63647609000806093515e-1 /* 0x3FDDAC67, 0x0561BB4F */, 7.85398163397448278999e-1 /* 0x3FE921FB, 0x54442D18 */,
  9.82793723247329054082e-1 /* 0x3FEF730B, 0xD281F69B */, 1.57079632679489655800 /* 0x3FF921FB, 0x54442D18 */,
];
const ATAN_LO = [
  2.26987774529616870924e-17 /* 0x3C7A2B7F, 0x222F65E2 */, 3.06161699786838301793e-17 /* 0x3C81A626, 0x33145C07 */,
  1.39033110312309984516e-17 /* 0x3C700788, 0x7AF0CBBD */, 6.12323399573676603587e-17 /* 0x3C91A626, 0x33145C07 */,
];
const AT0 = 3.33333333333329318027e-1; /* 0x3FD55555, 0x5555550D */
const AT1 = -1.99999999998764832476e-1; /* 0xBFC99999, 0x9998EBC4 */
const AT2 = 1.42857142725034663711e-1; /* 0x3FC24924, 0x920083FF */
const AT3 = -1.11111104054623557880e-1; /* 0xBFBC71C6, 0xFE231671 */
const AT4 = 9.09088713343650656196e-2; /* 0x3FB745CD, 0xC54C206E */
const AT5 = -7.69187620504482999495e-2; /* 0xBFB3B0F2, 0xAF749A6D */
const AT6 = 6.66107313738753120669e-2; /* 0x3FB10D66, 0xA0D03D51 */
const AT7 = -5.83357013379057348645e-2; /* 0xBFADDE2D, 0x52DEFD9A */
const AT8 = 4.97687799461593236017e-2; /* 0x3FA97B4B, 0x24760DEB */
const AT9 = -3.65315727442169155270e-2; /* 0xBFA2B444, 0x2C6A6C2F */
const AT10 = 1.62858201153657823623e-2; /* 0x3F90AD3A, 0xE322DA11 */

/** atan x, fdlibm's s_atan.c: the same bits on every engine. */
export function atan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  // |x| >= 2^66: pi/2 to the last bit, or NaN.
  if (ix >= 0x44100000) {
    if (x !== x) return x + x;
    const z = (ATAN_HI[3] as number) + (ATAN_LO[3] as number);
    return hx > 0 ? z : -z;
  }
  let id: number;
  let t = x;
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375. Under 2^-27 atan x is x to the last bit.
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    t = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0;
        t = (2 * t - 1) / (2 + t);
      } else {
        // 11/16 <= |x| < 19/16
        id = 1;
        t = (t - 1) / (t + 1);
      }
    } else if (ix < 0x40038000) {
      // 19/16 <= |x| < 39/16
      id = 2;
      t = (t - 1.5) / (1 + 1.5 * t);
    } else {
      // 39/16 <= |x| < 2^66
      id = 3;
      t = -1 / t;
    }
  }
  // The odd and even halves of the sum of AT[i] z^(i + 1).
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return t - t * (s1 + s2);
  const r = (ATAN_HI[id] as number) - (t * (s1 + s2) - (ATAN_LO[id] as number) - t);
  return hx < 0 ? -r : r;
}

// e_atan2.c
const PI_O_4 = 7.8539816339744827900e-1; /* 0x3FE921FB, 0x54442D18 */
const PI_O_2 = 1.5707963267948965580; /* 0x3FF921FB, 0x54442D18 */
const PI = 3.1415926535897931160; /* 0x400921FB, 0x54442D18 */
const PI_LO = 1.2246467991473531772e-16; /* 0x3CA1A626, 0x33145C07 */

/** atan2(y, x), the angle of (x, y), fdlibm's e_atan2.c: the same bits on every engine. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1) return atan(y);
  const hx = highWord(x);
  const hy = highWord(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  // 2 * (x's sign bit) + (y's sign bit)
  const m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2);
  if (y === 0) {
    // atan2(+-0, +anything) = +-0, atan2(+-0, -anything) = +-pi
    if (m < 2) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return m === 0 ? PI_O_4 : m === 1 ? -PI_O_4 : m === 2 ? 3 * PI_O_4 : -3 * PI_O_4;
    return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z: number;
  let quadrant = m;
  if (k > 60) {
    // |y/x| > 2^60
    z = PI_O_2 + 0.5 * PI_LO;
    quadrant &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (quadrant) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

// e_asin.c
const PIO2_HI = 1.57079632679489655800; /* 0x3FF921FB, 0x54442D18 */
const PIO2_LO = 6.12323399573676603587e-17; /* 0x3C91A626, 0x33145C07 */
const PIO4_HI = 7.85398163397448278999e-1; /* 0x3FE921FB, 0x54442D18 */
const PS0 = 1.66666666666666657415e-1; /* 0x3FC55555, 0x55555555 */
const PS1 = -3.25565818622400915405e-1; /* 0xBFD4D612, 0x03EB6F7D */
const PS2 = 2.01212532134862925881e-1; /* 0x3FC9C155, 0x0E884455 */
const PS3 = -4.00555345006794114027e-2; /* 0xBFA48228, 0xB5688F3B */
const PS4 = 7.91534994289814532176e-4; /* 0x3F49EFE0, 0x7501B288 */
const PS5 = 3.47933107596021167570e-5; /* 0x3F023DE1, 0x0DFDF709 */
const QS1 = -2.40339491173441421878; /* 0xC0033A27, 0x1C8A2D4B */
const QS2 = 2.02094576023350569471; /* 0x40002AE5, 0x9C598AC8 */
const QS3 = -6.88283971605453293030e-1; /* 0xBFE6066C, 0x1B8D0159 */
const QS4 = 7.70381505559019352791e-2; /* 0x3FB3B8C5, 0xB12E9282 */

/** asin x, fdlibm's e_asin.c: the same bits on every engine. */
export function asin(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // asin(+-1) = +-pi/2; past 1 (or NaN), NaN.
    if (x === 1 || x === -1) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5. Under 2^-27 asin x is x to the last bit.
    if (ix < 0x3e400000) return x;
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  // 0.5 <= |x| < 1
  const w = 1 - Math.abs(x);
  const t = w * 0.5;
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  let r: number;
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    r = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    // s with its low word cleared, and the rounding it dropped.
    const sh = fromWords(highWord(s), 0);
    const c = (t - sh * sh) / (s + sh);
    const pp = 2 * s * (p / q) - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * sh;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

/**
 * sqrt(x^2 + y^2) the way V8 computes `Math.hypot(x, y)` (its Torque builtin: both scaled by the larger, the squares
 * summed with Kahan's compensation, which for two terms adds nothing, then the square root scaled back), so it gives
 * what Node gives, without overflow, and the same bits on every engine.
 */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const max = ax > ay ? ax : ay;
  if (max === 0) return 0;
  const nx = ax / max;
  const ny = ay / max;
  return Math.sqrt(nx * nx + ny * ny) * max;
}

/** base^n for a whole n >= 0 by n multiplications (exact when base is a power of two), not the host's `**`. */
export function powInt(base: number, n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
}
