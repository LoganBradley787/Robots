/**
 * Evaluated in every script context before the user's code (`04`, Script API). Everything the host relies on lives
 * in a closure the script cannot reach: the write and log buffers, the param specs, and the `JSON` functions,
 * captured before any user code runs. The expression's value is the host's entry object, which the host keeps a
 * handle to, so reassigning globals (`__tick = 5`, `JSON.stringify = ...`) can only break the script itself.
 * `Math.random` becomes a seeded sfc32 and cannot be redefined; `Date` is not created (no Date intrinsic).
 * `__seed` and `__params` are defined by the host just before this runs and are read once here.
 */
export const PRELUDE = String.raw`
(function (seed, given) {
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var hasOwn = Object.prototype.hasOwnProperty;
  var writes = [];
  var logs = [];
  var specs = {};
  var input = null;
  var s = seed.slice();
  function next() {
    var t = (((s[0] + s[1]) | 0) + s[3]) | 0;
    s[3] = (s[3] + 1) | 0;
    s[0] = s[1] ^ (s[1] >>> 9);
    s[1] = (s[2] + (s[2] << 3)) | 0;
    s[2] = (s[2] << 21) | (s[2] >>> 11);
    s[2] = (s[2] + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  Object.defineProperty(Math, 'random', { value: next, writable: false, configurable: false });
  globalThis.random = next;
  globalThis.state = {};
  globalThis.frame = 0;
  globalThis.dt = 0;
  globalThis.time = 0;
  globalThis.self = null;
  globalThis.parts = [];
  globalThis.param = function (name, def, opts) {
    name = String(name);
    var spec = { default: Number(def) };
    if (opts && typeof opts.min === 'number') spec.min = opts.min;
    if (opts && typeof opts.max === 'number') spec.max = opts.max;
    specs[name] = spec;
    return hasOwn.call(given, name) ? given[name] : spec.default;
  };
  globalThis.set = function (target, channel, value) {
    if (writes.length < 1000) writes[writes.length] = [String(target), String(channel), Number(value)];
  };
  function matches(p, target) {
    return p.type === target || p.tags.indexOf(target) >= 0;
  }
  globalThis.get = function (target, channel) {
    var ps = input ? input.parts : [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (matches(p, target) && hasOwn.call(p.in, channel)) return p.in[channel];
      if (matches(p, target) && hasOwn.call(p.out, channel)) return p.out[channel];
    }
    return undefined;
  };
  globalThis.keys = {
    down: function (k) { return input.keys.down.indexOf(String(k)) >= 0; },
    pressed: function (k) { return input.keys.pressed.indexOf(String(k)) >= 0; },
    released: function (k) { return input.keys.released.indexOf(String(k)) >= 0; }
  };
  globalThis.log = function () {
    if (logs.length >= 5) return;
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      var text;
      try { text = typeof a === 'object' ? stringify(a) : String(a); } catch (e) { text = '[unprintable]'; }
      out[out.length] = String(text);
    }
    logs[logs.length] = out.join(' ').slice(0, 300);
  };
  globalThis.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  globalThis.lerp = function (a, b, t) { return a + (b - a) * t; };
  globalThis.sign = function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0; };
  function load(json) {
    input = parse(json);
    globalThis.frame = input.frame;
    globalThis.dt = input.dt;
    globalThis.time = input.time;
    globalThis.self = input.self;
    globalThis.parts = input.parts;
    writes = [];
    logs = [];
  }
  function result() {
    return stringify({ writes: writes, logs: logs });
  }
  return {
    setup: function (json) {
      load(json);
      globalThis.state = {};
      if (typeof globalThis.setup === 'function') globalThis.setup();
      return result();
    },
    tick: function (json) {
      load(json);
      if (typeof globalThis.tick === 'function') globalThis.tick();
      return result();
    },
    specs: function () { return stringify(specs); },
    hasTick: function () { return typeof globalThis.tick === 'function' ? 'true' : 'false'; }
  };
})(__seed, __params)
`;
