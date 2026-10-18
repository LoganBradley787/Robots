import { describe, expect, it } from 'vitest';
import { asin, atan, atan2, cos, hypot, powInt, sin } from '../src/math/fdlibm';

/**
 * M16: the sim's own sin, cos, atan, atan2, asin and hypot (`src/math/fdlibm.ts`). They must give fdlibm's bits on
 * every engine, which is what V8 gives on x86-64: the values below were printed by Node 24.4.1 for x64. Node for arm64
 * differs from them in about 1 call in 200 by one unit in the last place, because the C compiler fuses V8's fdlibm
 * multiply-adds there; Chrome 155 is correctly rounded, so it differs elsewhere (cos(-0.735641360282898) is
 * 0.7414005128905229 there).
 */
const KNOWN: ([string, number, number] | [string, number, number, number])[] = [
  ['sin', 1e-300, 1e-300],
  ['sin', 3.725290298461914e-9, 3.725290298461914e-9],
  ['sin', 0.5, 0.479425538604203],
  ['sin', -0.48218379071401457, -0.4637150841790566],
  ['sin', 0.7853981633974483, 0.7071067811865475],
  ['sin', 1, 0.8414709848078965],
  ['sin', 1.5707963267948966, 1],
  ['sin', -2, -0.9092974268256817],
  ['sin', 3, 0.1411200080598672],
  ['sin', 3.141592653589793, 1.2246467991473532e-16],
  ['sin', 7.254757882626306, 0.8257736691664814],
  ['sin', 10, -0.5440211108893698],
  ['sin', 100, -0.5063656411097588],
  ['sin', 157079.63267948964, -1.6980326998151097e-11],
  ['sin', 823549.6645826427, -3.2103381051568376e-11],
  ['sin', 1000000, -0.34999350217129294],
  ['sin', 1000000000, 0.5458434494486996],
  ['sin', 1e+22, -0.8522008497671888],
  ['sin', 1.2676506002282294e+30, -0.8721836054182673],
  ['sin', 1.0715086071862673e+301, -0.15920170308624243],
  ['sin', 1.7976931348623157e+308, 0.004961954789184062],
  ['sin', -1e+22, 0.8522008497671888],
  ['cos', 1e-300, 1],
  ['cos', 3.725290298461914e-9, 1],
  ['cos', 0.2693168520927429, 0.9639528884828676],
  ['cos', -0.735641360282898, 0.741400512890523],
  ['cos', -0.882875620527912, 0.6349321603501223],
  ['cos', 0.5, 0.8775825618903728],
  ['cos', 0.7853981633974483, 0.7071067811865476],
  ['cos', 1, 0.5403023058681398],
  ['cos', 1.5707963267948966, 6.123233995736766e-17],
  ['cos', 2, -0.4161468365471424],
  ['cos', 3.141592653589793, -1],
  ['cos', 10, -0.8390715290764524],
  ['cos', 100, 0.8623188722876839],
  ['cos', 157079.63267948964, 1],
  ['cos', 1000000, 0.9367521275331447],
  ['cos', 1000000000, 0.8378871813639024],
  ['cos', 1e+22, 0.523214785395139],
  ['cos', 1.0715086071862673e+301, 0.9872460775989135],
  ['cos', 1.7976931348623157e+308, -0.9999876894265599],
  ['atan', 1e-10, 1e-10],
  ['atan', 0.1, 0.09966865249116204],
  ['atan', 0.4375, 0.4124104415973873],
  ['atan', 0.5, 0.4636476090008061],
  ['atan', 0.6875, 0.6022873461349642],
  ['atan', 1, 0.7853981633974483],
  ['atan', 1.1875, 0.870903457075653],
  ['atan', 1.5, 0.982793723247329],
  ['atan', 2.4375, 1.1814796049617557],
  ['atan', 3.6323118228391404, 1.3021449457414427],
  ['atan', 10000000000, 1.5707963266948965],
  ['atan', 73786976294838210000, 1.5707963267948966],
  ['atan', -0.1448435481470528, -0.1438431881172501],
  ['atan', -5, -1.373400766945016],
  ['asin', 1e-10, 1e-10],
  ['asin', 0.1, 0.1001674211615598],
  ['asin', 0.4491472542512558, 0.46581067660909614],
  ['asin', 0.5, 0.5235987755982989],
  ['asin', 0.7, 0.775397496610753],
  ['asin', 0.9, 1.1197695149986342],
  ['asin', 0.975, 1.3467210414930773],
  ['asin', 0.99, 1.4292568534704693],
  ['asin', -0.5602502776795737, -0.5946879188594142],
  ['asin', 1, 1.5707963267948966],
  ['asin', -1, -1.5707963267948966],
  ['atan2', 1, 1, 0.7853981633974483],
  ['atan2', 1, -1, 2.356194490192345],
  ['atan2', -1, -1, -2.356194490192345],
  ['atan2', -1, 1, -0.7853981633974483],
  ['atan2', 0.11005527533282794, 0.2574047745229865, 0.40403465850060594],
  ['atan2', 3, 1, 1.2490457723982544],
  ['atan2', 1e+300, 1e-300, 1.5707963267948966],
  ['atan2', 1e-300, -1e+300, 3.141592653589793],
  ['atan2', -2, 0.5, -1.3258176636680326],
  ['atan2', 5, -12, 2.746801533890032],
  ['hypot', 3, 4, 5],
  ['hypot', 1e+300, 1e+300, 1.4142135623730952e+300],
  ['hypot', 1e-300, 1e-300, 1.4142135623730952e-300],
  ['hypot', 0.1, 0.2, 0.223606797749979],
  ['hypot', -5, 12, 13],
  ['hypot', 1, 1e-20, 1],
];

const ONE = { sin, cos, atan, asin } as Record<string, (x: number) => number>;
const TWO = { atan2, hypot } as Record<string, (y: number, x: number) => number>;

const bits = new DataView(new ArrayBuffer(8));
/** How many doubles apart a and b are (0 for the same bits, or both NaN). */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  bits.setFloat64(0, a);
  const ha = bits.getBigInt64(0);
  bits.setFloat64(0, b);
  const hb = bits.getBigInt64(0);
  return Number(ha > hb ? ha - hb : hb - ha);
}

/** A seeded stream of doubles of every kind the sim feeds these: small angles, big ones, and any bits at all. */
function sampler(seed: number): () => number {
  let s = seed >>> 0;
  const u32 = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  };
  let k = 0;
  return () => {
    const u = u32() / 4294967296;
    switch (k++ % 4) {
      case 0:
        return (u * 2 - 1) * 4;
      case 1:
        return (u * 2 - 1) * 1e4;
      case 2:
        return (u * 2 - 1) * 2 ** -(u32() % 40);
      default:
        bits.setUint32(0, u32());
        bits.setUint32(4, u32());
        return bits.getFloat64(0);
    }
  };
}

describe('fdlibm', () => {
  it('gives fdlibm\'s bits for known arguments on every path (tiny, the kernels, near pi/2, medium and huge reductions)', () => {
    for (const k of KNOWN) {
      const got = k.length === 3 ? (ONE[k[0]] as (x: number) => number)(k[1]) : (TWO[k[0]] as (y: number, x: number) => number)(k[1], k[2]);
      expect(Object.is(got, k[k.length - 1]), `${k[0]}(${k.slice(1, -1).join(', ')}) = ${got}, fdlibm ${k[k.length - 1]}`).toBe(true);
    }
  });

  it('keeps the sign of zero, and gives NaN and infinities their values', () => {
    for (const f of [sin, atan, asin]) {
      expect(Object.is(f(0), 0)).toBe(true);
      expect(Object.is(f(-0), -0)).toBe(true);
      expect(f(NaN)).toBeNaN();
    }
    expect(cos(0)).toBe(1);
    expect(cos(-0)).toBe(1);
    for (const f of [sin, cos]) for (const x of [NaN, Infinity, -Infinity]) expect(f(x)).toBeNaN();
    expect(asin(1.0000000000000002)).toBeNaN();
    expect(asin(-2)).toBeNaN();
    expect(atan(Infinity)).toBe(Math.PI / 2);
    expect(atan(-Infinity)).toBe(-Math.PI / 2);
    expect(Object.is(atan2(0, 1), 0)).toBe(true);
    expect(Object.is(atan2(-0, 1), -0)).toBe(true);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(atan2(0, -0)).toBe(Math.PI);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, -0)).toBe(-Math.PI / 2);
    expect(atan2(Infinity, Infinity)).toBe(Math.PI / 4);
    expect(atan2(-Infinity, -Infinity)).toBe((-3 * Math.PI) / 4);
    expect(Object.is(atan2(-1, Infinity), -0)).toBe(true);
    expect(atan2(1, -Infinity)).toBe(Math.PI);
    expect(atan2(NaN, 1)).toBeNaN();
    expect(atan2(1, NaN)).toBeNaN();
    expect(hypot(0, -0)).toBe(0);
    expect(hypot(NaN, Infinity)).toBe(Infinity);
    expect(hypot(NaN, 1)).toBeNaN();
    expect(hypot(1e308, 1e308)).toBe(1.4142135623730952e308);
  });

  it('is within a unit of this engine\'s Math right next to multiples of pi/2, where the reduction cancels most', () => {
    // Each of these is the double nearest k pi/2 or one of its neighbours: the reduced argument is tiny there.
    let worst = 0;
    for (let k = 1; k < 2000; k++) {
      const x = k * (Math.PI / 2);
      for (const d of [-2, -1, 0, 1, 2]) {
        bits.setFloat64(0, x);
        bits.setBigInt64(0, bits.getBigInt64(0) + BigInt(d));
        const y = bits.getFloat64(0);
        worst = Math.max(worst, ulps(sin(y), Math.sin(y)), ulps(cos(y), Math.cos(y)));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('matches this engine\'s Math on a large random sample to the last bit, or (where the engine is not plain fdlibm) to one unit', () => {
    const n = 100_000;
    const report: string[] = [];
    const check = (name: string, f: () => [number, number]): void => {
      let differ = 0;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const [a, b] = f();
        const u = ulps(a, b);
        if (u > 0) differ++;
        worst = Math.max(worst, u);
      }
      report.push(`${name} ${differ}/${n} differ, at most ${worst} ulp`);
      // x64 Node: none differ. arm64 Node (fused multiply-adds): about 0.5%. A wrong port is far off.
      expect(worst, name).toBeLessThanOrEqual(1);
      expect(differ, name).toBeLessThan(n * 0.02);
    };
    const next = sampler(7);
    for (const [name, f] of Object.entries(ONE)) {
      const host = (Math as unknown as Record<string, (x: number) => number>)[name] as (x: number) => number;
      check(name, () => {
        const x = next();
        return [f(x), host(x)];
      });
    }
    check('atan2', () => {
      const y = next();
      const x = next();
      return [atan2(y, x), Math.atan2(y, x)];
    });
    check('hypot', () => {
      const y = next();
      const x = next();
      return [hypot(y, x), Math.hypot(y, x)];
    });
    console.log(`fdlibm against ${process.arch} Node ${process.versions.node}: ${report.join('; ')}`);
  });

  it('powInt multiplies, exactly for halves', () => {
    expect(powInt(0.5, 0)).toBe(1);
    expect(powInt(0.5, 3)).toBe(0.125);
    expect(powInt(0.5, 1074)).toBe(5e-324);
    expect(powInt(3, 4)).toBe(81);
  });
});
