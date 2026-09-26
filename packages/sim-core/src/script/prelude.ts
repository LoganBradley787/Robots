/**
 * Evaluated in every script context before the user's code (`04`, Script API). Everything the host relies on lives
 * in a closure the script cannot reach: the write and log buffers, the param specs, and the `JSON` functions,
 * captured before any user code runs. The expression's value is the host's entry object, which the host keeps a
 * handle to, so reassigning globals (`__tick = 5`, `JSON.stringify = ...`) can only break the script itself.
 * `Math.random` becomes a seeded sfc32 and cannot be redefined; `Date` is not created (no Date intrinsic).
 * `__seed` and `__params` are defined by the host just before this runs and are read once here.
 */
export const PRELUDE = String.raw`
(function (seed, given, hostScan, hostSend) {
  delete globalThis.__scan;
  delete globalThis.__send;
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var hasOwn = Object.prototype.hasOwnProperty;
  var writes = [];
  var logs = [];
  var specs = {};
  var keyState = { down: [], pressed: [], released: [] };
  var scans = 0;
  var sends = 0;
  var finite = isFinite;
  var nanWarned = false;
  var marks = [];
  var scanWarned = false;
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
  globalThis.contacts = [];
  globalThis.inbox = [];
  globalThis.send = function (to, data) {
    if (sends >= 16 || !hostSend) return false;
    // Counted before the data is turned into text: a toJSON on it could call send() again.
    sends++;
    var text;
    try { text = stringify(data === undefined ? null : data); } catch (e) { return false; }
    if (typeof text !== 'string' || text.length > 1024) return false;
    return hostSend(String(to), text) === 'true';
  };
  globalThis.mark = function (x, y, label) {
    x = Number(x);
    y = Number(y);
    // A point that is not a number is skipped: it would not survive the trip to the host as JSON.
    if (marks.length < 4 && finite(x) && finite(y)) marks[marks.length] = [x, y, label === undefined ? '' : String(label)];
  };
  globalThis.scan = function (id) {
    if (scans >= 4) {
      if (!scanWarned && logs.length < 5) logs[logs.length] = 'scan(): at most 4 calls per tick; this one returned null';
      scanWarned = true;
      return null;
    }
    scans++;
    return hostScan ? parse(hostScan(Number(id))) : null;
  };
  globalThis.param = function (name, def, opts) {
    name = String(name);
    var spec = { default: Number(def) };
    if (opts && typeof opts.min === 'number') spec.min = opts.min;
    if (opts && typeof opts.max === 'number') spec.max = opts.max;
    specs[name] = spec;
    return hasOwn.call(given, name) ? given[name] : spec.default;
  };
  globalThis.set = function (target, channel, value) {
    value = Number(value);
    if (!finite(value)) {
      // NaN or Infinity (a division by zero) is dropped, with one line in the log, instead of stopping the script.
      if (!nanWarned && logs.length < 5) logs[logs.length] = 'set(' + String(target) + ', ' + String(channel) + '): the value is not a number; ignored';
      nanWarned = true;
      return;
    }
    if (writes.length < 1000) writes[writes.length] = [String(target), String(channel), value];
  };
  function matches(r, target) {
    return r.type === target || r.tags.indexOf(target) >= 0;
  }
  globalThis.get = function (target, channel) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (matches(r, target) && hasOwn.call(r.inO, channel)) return r.inO[channel];
      if (matches(r, target) && hasOwn.call(r.outO, channel)) return r.outO[channel];
    }
    return undefined;
  };
  globalThis.keys = {
    down: function (k) { return keyState.down.indexOf(String(k)) >= 0; },
    pressed: function (k) { return keyState.pressed.indexOf(String(k)) >= 0; },
    released: function (k) { return keyState.released.indexOf(String(k)) >= 0; }
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
  // M9: the part objects, built once per layout and refilled from the numbers every tick. Private, so get() and
  // the refill never depend on what a script did to its own parts array or objects.
  var rows = [];
  var freeze = Object.freeze;
  var defineProperty = Object.defineProperty;
  var fixed = ['id', 'type', 'tags', 'pos', 'mass', 'in', 'out'];
  function setLayout(json) {
    var list = parse(json);
    rows = [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      var inO = {};
      var outO = {};
      for (var j = 0; j < l[4].length; j++) inO[l[4][j]] = 0;
      for (var j = 0; j < l[5].length; j++) outO[l[5][j]] = 0;
      var r = { pos: { x: 0, y: 0 }, type: l[1], tags: freeze(l[2]), inN: l[4], inO: inO, outN: l[5], outO: outO, o: null };
      var o = { id: l[0], type: r.type, tags: r.tags, pos: r.pos, angle: 0, mass: l[3], in: inO, out: outO };
      // Only the numbers change from tick to tick; the rest cannot be replaced, so the refill always reaches them.
      for (var j = 0; j < fixed.length; j++) defineProperty(o, fixed[j], { writable: false, configurable: false });
      r.o = o;
      rows[i] = r;
    }
  }
  function load(buf, extras) {
    var f = new Float64Array(buf);
    // Every number finite (the usual case), or check each and hand over null as JSON would.
    var ok = f[0] === 1;
    var v;
    var k = 1;
    v = f[k++]; globalThis.frame = ok || v - v === 0 ? v : null;
    v = f[k++]; globalThis.dt = ok || v - v === 0 ? v : null;
    v = f[k++]; globalThis.time = ok || v - v === 0 ? v : null;
    var n = [];
    for (var i = 0; i < 9; i++) { v = f[k++]; n[i] = ok || v - v === 0 ? v : null; }
    globalThis.self = { pos: { x: n[0], y: n[1] }, vel: { x: n[2], y: n[3] }, angle: n[4], angVel: n[5], mass: n[6], energy: { stored: n[7], capacity: n[8] } };
    var list = [];
    if (ok) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var o = r.o;
        var pos = r.pos;
        pos.x = f[k++];
        pos.y = f[k++];
        o.angle = f[k++];
        var names = r.inN;
        var target = r.inO;
        for (var j = 0; j < names.length; j++) target[names[j]] = f[k++];
        names = r.outN;
        target = r.outO;
        for (var j = 0; j < names.length; j++) target[names[j]] = f[k++];
        list[i] = o;
      }
    } else {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var o = r.o;
        var pos = r.pos;
        v = f[k++]; pos.x = v - v === 0 ? v : null;
        v = f[k++]; pos.y = v - v === 0 ? v : null;
        v = f[k++]; o.angle = v - v === 0 ? v : null;
        var names = r.inN;
        var target = r.inO;
        for (var j = 0; j < names.length; j++) { v = f[k++]; target[names[j]] = v - v === 0 ? v : null; }
        names = r.outN;
        target = r.outO;
        for (var j = 0; j < names.length; j++) { v = f[k++]; target[names[j]] = v - v === 0 ? v : null; }
        list[i] = o;
      }
    }
    globalThis.parts = list;
    if (extras === '') {
      keyState = { down: [], pressed: [], released: [] };
      globalThis.contacts = [];
      globalThis.inbox = [];
    } else {
      var e = parse(extras);
      keyState = e[0];
      globalThis.contacts = e[1];
      globalThis.inbox = e[2];
    }
    scans = 0;
    sends = 0;
    nanWarned = false;
    marks = [];
    writes = [];
    logs = [];
  }
  function result() {
    return stringify({ writes: writes, logs: logs, marks: marks });
  }
  return {
    layout: function (json) { setLayout(json); return ''; },
    setup: function (buf, extras) {
      load(buf, extras);
      globalThis.state = {};
      if (typeof globalThis.setup === 'function') globalThis.setup();
      return result();
    },
    tick: function (buf, extras) {
      load(buf, extras);
      if (typeof globalThis.tick === 'function') globalThis.tick();
      return result();
    },
    specs: function () { return stringify(specs); },
    // Host only (the parity test): what the script sees, as one JSON text in the order the old input had.
    inspect: function () {
      return stringify({ frame: globalThis.frame, dt: globalThis.dt, time: globalThis.time, self: globalThis.self, parts: globalThis.parts, keys: keyState, contacts: globalThis.contacts, inbox: globalThis.inbox });
    },
    hasTick: function () { return typeof globalThis.tick === 'function' ? 'true' : 'false'; }
  };
})(__seed, __params, typeof __scan === 'function' ? __scan : null, typeof __send === 'function' ? __send : null)
`;
