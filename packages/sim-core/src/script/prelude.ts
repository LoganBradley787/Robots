/**
 * Evaluated in every script context before the user's code (`04`, Script API). Everything the host relies on lives
 * in a closure the script cannot reach: the write and log buffers, the param specs, and the `JSON` functions,
 * captured before any user code runs. The expression's value is the host's entry object, which the host keeps a
 * handle to, so reassigning globals (`__tick = 5`, `JSON.stringify = ...`) can only break the script itself.
 * `Math.random` becomes a seeded sfc32 and cannot be redefined; `Date` is not created (no Date intrinsic).
 * `__seed`, `__params`, `__inspect`, and `__arena` are defined by the host just before this runs and are read once here.
 */
export const PRELUDE = String.raw`
(function (seed, given, hostScan, hostSend, inspecting, arena) {
  delete globalThis.__scan;
  delete globalThis.__send;
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var newFunction = Function;
  var hasOwn = Object.prototype.hasOwnProperty;
  var writes = [];
  var logs = [];
  var specs = {};
  var keyState = { down: [], pressed: [], released: [] };
  // Keys it asked about this tick (M16, for the readout), at most 16.
  var asked = [];
  function ask(k) {
    if (asked.length < 16 && asked.indexOf(k) < 0) asked.push(k);
    return k;
  }
  var seen = '';
  var scans = 0;
  var sends = 0;
  var finite = isFinite;
  var nanWarned = false;
  var marks = [];
  // Ticks to sleep after this one (sleep(n)), 0 for none: the last call of the tick wins.
  var sleepFor = 0;
  var sleepWarned = false;
  var scanWarned = false;
  var optWarned = {};
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
  // Made when first read in a tick (contactsNow); a script that writes it reads what it wrote until the next tick.
  Object.defineProperty(globalThis, 'contacts', { get: contactsNow, set: contactsSet, enumerable: true, configurable: true });
  globalThis.inbox = [];
  // The match's edge, fixed for the whole run: { x, y } (frozen), or null. Not writable; configurable, so a script's own
  // top level let or const named arena still compiles (and hides it).
  Object.defineProperty(globalThis, 'arena', { value: arena ? Object.freeze({ x: arena.x, y: arena.y }) : null, writable: false, enumerable: true, configurable: true });
  globalThis.send = function (to, data) {
    if (sends >= 32 || !hostSend) return false;
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
  globalThis.scan = function (id, opts) {
    if (scans >= 4) {
      if (!scanWarned && logs.length < 5) logs[logs.length] = 'scan(): at most 4 calls per tick; this one returned null';
      scanWarned = true;
      return null;
    }
    // Counted before the options are turned into text: a toJSON on them could call scan() again.
    scans++;
    if (!hostScan) return null;
    var text = '';
    if (opts !== undefined && opts !== null) {
      try { text = stringify(opts); } catch (e) { text = undefined; }
      if (typeof text !== 'string') text = '!scan(): the options could not be read';
    }
    // A line starting with '!' is what is wrong with the options: logged once per message, and nothing is returned.
    var out = text.charCodeAt(0) === 33 ? text : hostScan(Number(id), text);
    if (out.charCodeAt(0) === 33) {
      out = out.slice(1);
      if (!hasOwn.call(optWarned, out) && logs.length < 5) logs[logs.length] = out;
      optWarned[out] = true;
      return null;
    }
    return parse(out);
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
  // The first part, in parts order, of that type or with that tag that has the value: looked up in the parts kept per
  // type and tag (below), not by walking every part. A part's in and out cannot be replaced, so reading them off the
  // part is reading the real ones.
  globalThis.get = function (target, channel) {
    if (typeof target !== 'string') return undefined;
    if (index === null) buildIndex();
    var bucket = index[target];
    if (bucket === undefined) return undefined;
    for (var i = 0; i < bucket.length; i++) {
      var o = bucket[i];
      if (hasOwn.call(o.in, channel)) return o.in[channel];
      if (hasOwn.call(o.out, channel)) return o.out[channel];
    }
    return undefined;
  };
  // Skips the script's next n ticks (at most 30): the world calls nothing and makes this tick's set() calls again on
  // each of them (ScriptRunner). sleep(0) takes back an earlier call this tick. Not a number: no sleep, one log line.
  globalThis.sleep = function (n) {
    n = Number(n);
    if (!finite(n)) {
      if (!sleepWarned && logs.length < 5) logs[logs.length] = 'sleep(' + String(n) + '): not a number of ticks; it does not sleep';
      sleepWarned = true;
      sleepFor = 0;
      return;
    }
    sleepFor = n <= 0 ? 0 : n >= 30 ? 30 : n | 0;
  };
  globalThis.keys = {
    down: function (k) { return keyState.down.indexOf(ask(String(k))) >= 0; },
    pressed: function (k) { return keyState.pressed.indexOf(ask(String(k))) >= 0; },
    released: function (k) { return keyState.released.indexOf(ask(String(k))) >= 0; }
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
  // Captured before any user code, like parse and stringify. Every object and array below is made by parse or a
  // literal, and filled only through properties it already has, so a setter a script puts on Object.prototype or
  // Array.prototype never sees the refill (as with the old JSON input).
  var rows = [];
  var nulls = '[]';
  // Made again from the rows after the layout changes (null until then), for the refill: the rows' part objects in
  // order (each tick's parts is a copy of it; its constructor is its own undefined, so the copy is a plain array
  // whatever a script does to Array), their pos objects, how many numbers each part has, and the rows with values
  // grouped by the names they have (shapes), each group with where its rows' values start (counted from the first
  // part's numbers).
  var objs = null;
  var poses = null;
  var widths = null;
  var shapes = null;
  function refillLists() {
    var n = rows.length;
    objs = parse(nulls);
    poses = parse(nulls);
    widths = new Int32Array(n);
    // Each row with values gets its shape's key, and each shape a count and its place in the list.
    var keys = parse(nulls);
    var found = create(null);
    var kinds = 0;
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      if (r.inN.length + r.outN.length === 0) continue;
      var key = stringify([r.inN, r.outN]);
      keys[i] = key;
      var f = found[key];
      if (f === undefined) found[key] = { n: 1, i: kinds++ };
      else f.n++;
    }
    shapes = parse(nullsFor(kinds));
    var at = 0;
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      objs[i] = r.o;
      poses[i] = r.pos;
      var w = 3 + r.inN.length + r.outN.length;
      widths[i] = w;
      if (w > 3) {
        var f = found[keys[i]];
        var s = shapes[f.i];
        if (s === null) {
          s = { fill: shapeFill(keys[i], r.inN, r.outN), rows: parse(nullsFor(f.n)), at: new Int32Array(f.n), n: 0 };
          shapes[f.i] = s;
        }
        s.rows[s.n] = r;
        s.at[s.n] = at + 3;
        s.n++;
      }
      at += w;
    }
    defineProperty(objs, 'constructor', { value: undefined });
  }
  // The refill of one shape's values, made once per script for each different list of names: the names are written
  // into the code, so QuickJS sets each value by its name directly instead of looking a name up per value per tick
  // (about half the cost of refilling a big robot).
  var shapeFills = null;
  function shapeFill(key, inN, outN) {
    if (shapeFills === null) shapeFills = create(null);
    var fill = shapeFills[key];
    if (fill !== undefined) return fill;
    var body = 'for (var q = 0; q < n; q++) { var r = rows[q]; var a = base + at[q]; var t = r.inO;';
    for (var j = 0; j < inN.length; j++) body += ' t' + member(inN[j]) + ' = f[a + ' + j + '];';
    body += ' t = r.outO;';
    for (var j = 0; j < outN.length; j++) body += ' t' + member(outN[j]) + ' = f[a + ' + (inN.length + j) + '];';
    fill = newFunction('rows', 'at', 'n', 'f', 'base', body + ' }');
    shapeFills[key] = fill;
    return fill;
  }
  /** A name as code that reads that property: .name when it is a plain name, else ["name"]. */
  function member(name) {
    var plain = name.length > 0;
    for (var j = 0; plain && j < name.length; j++) {
      var c = charCode(name, j);
      plain = c === 36 || c === 95 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (j > 0 && c >= 48 && c <= 57);
    }
    return plain ? '.' + name : '[' + stringify(name) + ']';
  }
  var F64 = Float64Array;
  var freeze = Object.freeze;
  var seal = Object.seal;
  var defineProperty = Object.defineProperty;
  var create = Object.create;
  // Built-ins taken with their receiver bound, so nothing a script does to Array.prototype, String.prototype, or
  // Function.prototype reaches them.
  var bind = Function.prototype.call.bind(Function.prototype.bind);
  var call = Function.prototype.call;
  var indexOf = bind(call, Array.prototype.indexOf);
  var copyWithin = bind(call, Array.prototype.copyWithin);
  var slice = bind(call, Array.prototype.slice);
  var repeat = bind(call, String.prototype.repeat);
  var charCode = bind(call, String.prototype.charCodeAt);
  var keysOf = Object.keys;
  var fixed = ['id', 'type', 'tags', 'pos', 'mass', 'in', 'out'];
  // The tick's contacts as numbers and their by lists (frame.ts, contactFrame), and the list made from them once the
  // script reads contacts (or what it wrote there).
  var describe = Object.getOwnPropertyDescriptor;
  var contactNums = null;
  var contactBy = null;
  var contactList = [];
  var contactMade = true;
  var SIDES = ['enemy', 'friend', 'none'];
  function contactsNow() {
    if (!contactMade) {
      contactList = makeContacts();
      contactMade = true;
    }
    return contactList;
  }
  function contactsSet(v) {
    contactList = v;
    contactMade = true;
  }
  /** What JSON.parse(JSON.stringify(contacts)) gives, from the numbers: -0 came as 0, a number not finite as null. */
  function makeContacts() {
    if (contactNums === null) return [];
    var f = new F64(contactNums);
    var ok = f[0] === 1;
    var n = f[1];
    var list = parse(nullsFor(n));
    var k = 2;
    var v;
    for (var i = 0; i < n; i++) {
      v = f[k++]; var id = ok || v - v === 0 ? v : null;
      var side = SIDES[f[k++]];
      var core = f[k++] === 1;
      v = f[k++]; var px = ok || v - v === 0 ? v : null;
      v = f[k++]; var py = ok || v - v === 0 ? v : null;
      v = f[k++]; var vx = ok || v - v === 0 ? v : null;
      v = f[k++]; var vy = ok || v - v === 0 ? v : null;
      v = f[k++]; var cx = ok || v - v === 0 ? v : null;
      v = f[k++]; var cy = ok || v - v === 0 ? v : null;
      v = f[k++]; var mass = ok || v - v === 0 ? v : null;
      v = f[k++]; var count = ok || v - v === 0 ? v : null;
      v = f[k++]; var distance = ok || v - v === 0 ? v : null;
      list[i] = { id: id, side: side, core: core, pos: { x: px, y: py }, vel: { x: vx, y: vy }, center: { x: cx, y: cy }, mass: mass, parts: count, distance: distance, by: copyOf(contactBy[f[k++]]) };
    }
    return list;
  }
  /** Each contact's own copy of its by list: literals for the usual short ones, else filled through its own indices. */
  function copyOf(b) {
    var n = b.length;
    if (n === 1) return [b[0]];
    if (n === 2) return [b[0], b[1]];
    if (n === 3) return [b[0], b[1], b[2]];
    var out = parse(nullsFor(n));
    for (var i = 0; i < n; i++) out[i] = b[i];
    return out;
  }
  // M16: each part type's static numbers (partSpec.ts), as sent, and the ones already frozen for use. Every part of
  // a type shares one spec object, frozen all the way down the first time a part of that type is made.
  var specTable = create(null);
  var specReady = create(null);
  function deepFreeze(v) {
    if (v === null || typeof v !== 'object') return v;
    var names = keysOf(v);
    for (var j = 0; j < names.length; j++) deepFreeze(v[names[j]]);
    return freeze(v);
  }
  function specOf(type) {
    var ready = specReady[type];
    if (ready !== undefined) return ready;
    if (!hasOwn.call(specTable, type)) return undefined;
    return (specReady[type] = deepFreeze(specTable[type]));
  }
  var lock = { writable: false, configurable: false };
  // M16 review: the middle of a part of one cell is its position. Shared by all of them, so frozen.
  var noCenter = freeze({ x: 0, y: 0 });
  // The parts by type and by tag, each list in parts order, for get(): null until a get() needs it, then kept up to
  // date as the layout is patched (or dropped, when a patch moves parts about, and built again on the next get()).
  var index = null;
  /** '{"a":0,"b":0}' for the names, so parse makes the object with its keys in order. */
  function zeros(names) {
    var text = '{';
    for (var j = 0; j < names.length; j++) text += (j > 0 ? ',' : '') + stringify(names[j]) + ':0';
    return text + '}';
  }
  /** '[null,null,...]' with n nulls: parse makes an array whose every index is its own, ready to be filled. */
  function nullsFor(n) {
    return n === 0 ? '[]' : '[' + repeat('null,', n - 1) + 'null]';
  }
  /** One part from its layout entry: [id, type, tags, mass, in names, out names], then (M16) rot and on when it has them, and its center [x, y] when it is not 0, 0. */
  function makeRow(l) {
    var inO = parse(zeros(l[4]));
    var outO = parse(zeros(l[5]));
    var pos = { x: 0, y: 0 };
    var r = { pos: pos, type: l[1], tags: freeze(l[2]), inN: l[4], inO: inO, outN: l[5], outO: outO, o: null };
    // How it was built turned, the joint that carries it (M16) and where its middle is come after out, and its type's spec last; each
    // only when the host sent it: without them a part is as it was before M16. Always a literal, never a property
    // added later, so a setter a script puts on Object.prototype never sees the part being made.
    var sp = specOf(r.type);
    var o;
    if (l.length > 7 && l[6] !== null && l[7] !== null) {
      var mid = l.length > 8 && l[8] !== null ? freeze({ x: l[8][0], y: l[8][1] }) : noCenter;
      o = sp === undefined
        ? { id: l[0], type: r.type, tags: r.tags, pos: pos, angle: 0, mass: l[3], in: inO, out: outO, rot: l[6], on: l[7], center: mid }
        : { id: l[0], type: r.type, tags: r.tags, pos: pos, angle: 0, mass: l[3], in: inO, out: outO, rot: l[6], on: l[7], center: mid, spec: sp };
      defineProperty(o, 'rot', lock);
      defineProperty(o, 'on', lock);
      defineProperty(o, 'center', lock);
    } else {
      o = sp === undefined
        ? { id: l[0], type: r.type, tags: r.tags, pos: pos, angle: 0, mass: l[3], in: inO, out: outO }
        : { id: l[0], type: r.type, tags: r.tags, pos: pos, angle: 0, mass: l[3], in: inO, out: outO, spec: sp };
    }
    if (sp !== undefined) defineProperty(o, 'spec', lock);
    // Only the numbers change from tick to tick: nothing can be replaced, added, or deleted, so the refill always
    // reaches what the script sees and a script's own writes last one tick at most.
    for (var j = 0; j < fixed.length; j++) defineProperty(o, fixed[j], lock);
    seal(o);
    seal(pos);
    seal(inO);
    seal(outO);
    r.o = o;
    return r;
  }
  function setLayout(json) {
    var list = parse(json);
    nulls = nullsFor(list.length);
    rows = parse(nulls);
    for (var i = 0; i < list.length; i++) rows[i] = makeRow(list[i]);
    index = null;
    objs = null;
  }
  function put(key, o) {
    var bucket = index[key];
    if (bucket === undefined) index[key] = [o];
    else if (bucket[bucket.length - 1] !== o) bucket[bucket.length] = o;
  }
  function addIndex(r) {
    put(r.type, r.o);
    var tags = r.tags;
    for (var j = 0; j < tags.length; j++) put(tags[j], r.o);
  }
  function buildIndex() {
    index = create(null);
    for (var i = 0; i < rows.length; i++) addIndex(rows[i]);
  }
  /** Takes a part out of one list, or puts another in its place. */
  function swap(bucket, o, other) {
    var at = indexOf(bucket, o);
    if (at < 0) return;
    if (other !== null) {
      bucket[at] = other;
      return;
    }
    copyWithin(bucket, at, at + 1);
    bucket.length = bucket.length - 1;
  }
  function reindex(r, other) {
    swap(index[r.type], r.o, other);
    var tags = r.tags;
    for (var j = 0; j < tags.length; j++) swap(index[tags[j]], r.o, other);
  }
  // The layout after the robot changed, as a patch on the one held (frame.ts, layoutPatch): the parts that are as
  // they were keep their objects, so nothing is made again for them. A kept part object stays live across the change.
  function patchLayout(json) {
    objs = null;
    var p = parse(json);
    var n = p[0];
    var ops = p[2];
    var live = index !== null;
    if (p[1] === 2) {
      // Only parts gone: the rest close up in place, last gap first.
      for (var i = ops.length - 1; i >= 0; i--) {
        var gap = ops[i];
        if (live) for (var j = gap[0]; j < gap[1]; j++) reindex(rows[j], null);
        copyWithin(rows, gap[0], gap[1]);
      }
      rows.length = n;
      nulls = nullsFor(n);
      return;
    }
    // Kept parts in their old order with new ones only after them (p[1] is 1): the lists for get() follow along.
    live = live && p[1] === 1;
    var text = nullsFor(n);
    var next = parse(text);
    var k = 0;
    var seen = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (typeof op[0] === 'number') {
        // Old parts op[0] up to op[1], as they are.
        if (live) for (var j = seen; j < op[0]; j++) reindex(rows[j], null);
        for (var j = op[0]; j < op[1]; j++) next[k++] = rows[j];
        seen = op[1];
      } else {
        var r = makeRow(op);
        if (live) {
          if (op.length > 9) {
            // The old part op[9] with other values present: the new one stands where it stood.
            for (var j = seen; j < op[9]; j++) reindex(rows[j], null);
            reindex(rows[op[9]], r.o);
            seen = op[9] + 1;
          } else {
            addIndex(r);
          }
        }
        next[k++] = r;
      }
    }
    if (live) for (var j = seen; j < rows.length; j++) reindex(rows[j], null);
    else index = null;
    rows = next;
    nulls = text;
  }
  function load(buf, extras, cbuf) {
    var f = new F64(buf);
    // Every number finite (the usual case), or check each and hand over null as JSON would.
    var ok = f[0] === 1;
    var v;
    var k = 1;
    v = f[k++]; globalThis.frame = ok || v - v === 0 ? v : null;
    v = f[k++]; globalThis.dt = ok || v - v === 0 ? v : null;
    v = f[k++]; globalThis.time = ok || v - v === 0 ? v : null;
    v = f[k++]; var px = ok || v - v === 0 ? v : null;
    v = f[k++]; var py = ok || v - v === 0 ? v : null;
    v = f[k++]; var vx = ok || v - v === 0 ? v : null;
    v = f[k++]; var vy = ok || v - v === 0 ? v : null;
    v = f[k++]; var angle = ok || v - v === 0 ? v : null;
    v = f[k++]; var angVel = ok || v - v === 0 ? v : null;
    v = f[k++]; var mass = ok || v - v === 0 ? v : null;
    v = f[k++]; var stored = ok || v - v === 0 ? v : null;
    v = f[k++]; var capacity = ok || v - v === 0 ? v : null;
    v = f[k++]; var age = ok || v - v === 0 ? v : null;
    globalThis.self = { pos: { x: px, y: py }, vel: { x: vx, y: vy }, angle: angle, angVel: angVel, mass: mass, energy: { stored: stored, capacity: capacity }, age: age };
    if (objs === null) refillLists();
    var list = slice(objs);
    if (ok) {
      // Every part's place and angle, then the values of the parts that have any. Only the numbers are written, into
      // objects nothing outside this closure holds a setter on, so the order they are written in cannot be seen.
      var base = k;
      var P = poses;
      var O = objs;
      var W = widths;
      var n = P.length;
      for (var i = 0; i < n; i++) {
        var pos = P[i];
        pos.x = f[k];
        pos.y = f[k + 1];
        O[i].angle = f[k + 2];
        k += W[i];
      }
      for (var g = 0; g < shapes.length; g++) {
        var s = shapes[g];
        s.fill(s.rows, s.at, s.n, f, base);
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
      }
    }
    globalThis.parts = list;
    var e = extras === '' ? null : parse(extras);
    contactNums = cbuf === undefined ? null : cbuf;
    contactBy = e === null ? null : e[1];
    contactMade = false;
    // A script that put its own contacts in place of the one above (a function of that name) gets the list now.
    var d = describe(globalThis, 'contacts');
    if (!d || d.get !== contactsNow) globalThis.contacts = makeContacts();
    if (e === null) {
      keyState = { down: [], pressed: [], released: [] };
      globalThis.inbox = [];
    } else {
      keyState = e[0];
      globalThis.inbox = e[2];
    }
    scans = 0;
    sends = 0;
    nanWarned = false;
    sleepWarned = false;
    sleepFor = 0;
    marks = [];
    writes = [];
    logs = [];
    asked = [];
    // Tests only (the parity test compiles with inspect on): what the script sees, before it runs.
    if (inspecting) seen = stringify({ frame: globalThis.frame, dt: globalThis.dt, time: globalThis.time, self: globalThis.self, parts: globalThis.parts, keys: keyState, contacts: globalThis.contacts, inbox: globalThis.inbox });
  }
  function result() {
    return stringify({ writes: writes, logs: logs, marks: marks, keys: asked, sleep: sleepFor });
  }
  return {
    layout: function (json) { setLayout(json); return ''; },
    // Parts made from here on take their spec from this table; parts already made keep the one they have.
    partSpecs: function (json) { specTable = parse(json); specReady = create(null); return ''; },
    patch: function (json) { patchLayout(json); return ''; },
    setup: function (buf, extras, cbuf) {
      load(buf, extras, cbuf);
      globalThis.state = {};
      if (typeof globalThis.setup === 'function') globalThis.setup();
      return result();
    },
    tick: function (buf, extras, cbuf) {
      load(buf, extras, cbuf);
      if (typeof globalThis.tick === 'function') globalThis.tick();
      return result();
    },
    specs: function () { return stringify(specs); },
    // Host only (the parity test): what the script saw on its last call, taken before it ran, as one JSON text in
    // the order the old input had. Empty unless compiled with inspect on.
    inspect: function () { return seen; },
    hasTick: function () { return typeof globalThis.tick === 'function' ? 'true' : 'false'; }
  };
})(__seed, __params, typeof __scan === 'function' ? __scan : null, typeof __send === 'function' ? __send : null, __inspect === true, typeof __arena === 'object' ? __arena : null)
`;
