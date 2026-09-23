/**
 * Evaluated in every script context before the user's code (`04`, Script API). Sets up the API as plain globals and
 * replaces the only nondeterministic built-ins: `Math.random` becomes a seeded sfc32, and `Date` is not created at
 * all (the context has no Date intrinsic). `__seed` and `__params` are defined by the host just before this runs.
 */
export const PRELUDE = String.raw`
(function () {
  var s = __seed.slice();
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
})();
var __writes = [];
var __logs = [];
var __paramSpecs = {};
var __input = null;
var state = {};
var frame = 0, dt = 0, time = 0, self = null, parts = [];
function param(name, def, opts) {
  name = String(name);
  var spec = { default: Number(def) };
  if (opts && typeof opts.min === 'number') spec.min = opts.min;
  if (opts && typeof opts.max === 'number') spec.max = opts.max;
  __paramSpecs[name] = spec;
  return Object.prototype.hasOwnProperty.call(__params, name) ? __params[name] : spec.default;
}
function set(target, channel, value) {
  __writes.push([String(target), String(channel), Number(value)]);
}
function __matches(p, target) {
  return p.type === target || p.tags.indexOf(target) >= 0;
}
function get(target, channel) {
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (__matches(p, target) && Object.prototype.hasOwnProperty.call(p.in, channel)) return p.in[channel];
    if (__matches(p, target) && Object.prototype.hasOwnProperty.call(p.out, channel)) return p.out[channel];
  }
  return undefined;
}
var keys = {
  down: function (k) { return __input.keys.down.indexOf(String(k)) >= 0; },
  pressed: function (k) { return __input.keys.pressed.indexOf(String(k)) >= 0; },
  released: function (k) { return __input.keys.released.indexOf(String(k)) >= 0; }
};
function log() {
  if (__logs.length >= 5) return;
  var out = [];
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i];
    out.push(typeof a === 'object' ? JSON.stringify(a) : String(a));
  }
  __logs.push(out.join(' ').slice(0, 300));
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
function __load(json) {
  __input = JSON.parse(json);
  frame = __input.frame; dt = __input.dt; time = __input.time; self = __input.self; parts = __input.parts;
  __writes = [];
  __logs = [];
}
function __result() {
  return JSON.stringify({ writes: __writes, logs: __logs });
}
function __setup(json) {
  __load(json);
  state = {};
  if (typeof setup === 'function') setup();
  return __result();
}
function __tick(json) {
  __load(json);
  if (typeof tick === 'function') tick();
  return __result();
}
`;
