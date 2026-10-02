// The pilot of titan-bastion: a ground fortress that never moves. No keys. One script runs everything, so the
// big parts list is handed over once a tick.
// - Hiding: two 1 by 1 bays near the core build jammer pods; a held pod is lit, one bay at a time, so the core is
//   always inside a bubble and no sensor outside sees the fortress. Its radars stand on the end masts, outside.
// - Darts: every dart bay lets its copy go as soon as it is built, at the other titan's main robot (contact id 1
//   or 2) when the radars track it, else at the heaviest tracked robot of the other side. Every dart flies at that
//   robot's core, so they dig on one spot. With nothing tracked it sends them to where it last tracked one, and
//   otherwise blind: one dart every `blindGap` s, over the top onto the mirror of its own start (the other side
//   starts at -x), down the whole column. The rest wait in their bays for a target.
// - Turrets: the rotators with guns on the tower's top each point at a near robot of the other side (darts and
//   small fliers first come first), ahead of it by the shell's flight and up by its fall, and blast while on
//   target with nothing of ours on the gun's sight.
// - Anchors: grapples in the floor, cast down at the ground once it rests. The ropes hold the mesa where it stands
//   against a push toward the arena's edge. One that lost its rope is cast again.
const anchors = param('anchors', 0, { min: 0, max: 200 }); // how many anchors the floor holds (the generator sets it)
const anchorAt = param('anchorAt', 30, { min: 2, max: 600 }); // tick of the first cast
const recast = param('recast', 60, { min: 10, max: 6000 }); // ticks between two tries for an anchor with no rope
const minMass = param('minMass', 10, { min: 0, max: 1000 }); // kg: lighter robots (not the main one) are not worth a dart
const high = param('high', 15, { min: -100, max: 300 }); // m over the base: targets above this get a straight dart, the rest an arc
const gap = param('gap', 0.05, { min: 0, max: 5 }); // s between two bays letting go
const overlap = param('overlap', 2.6, { min: 0.5, max: 5 }); // s between one jammer bay's pod lighting and the other's
const burn = param('burn', 5.1, { min: 1, max: 10 }); // s after lighting a pod its bay is cleared (a pod jams 5 s)
const blindGap = param('blindGap', 0.7, { min: 0.05, max: 30 }); // s between darts sent blind
const keepLast = param('keepLast', 12, { min: 0, max: 240 }); // s a last tracked place is used before going blind
const reach = param('reach', 280, { min: 10, max: 300 }); // m: turrets blast within this
const track = param('track', 450, { min: 10, max: 1000 }); // m: turrets point at things within this
const turnGain = param('turnGain', 8, { min: 0.1, max: 50 }); // rotator turn rate per radian off the aim

function setup() {
  state.bays = [];
  state.turrets = [];
  for (const p of parts) {
    if (p.type === 'fabbay') {
      const tag = p.tags.find((t) => t.length === 2 && t.charAt(0) === 'd');
      if (tag !== undefined) state.bays.push(tag);
    } else if (p.type === 'gun') {
      const tag = p.tags.find((t) => t.slice(-4) === '.gun');
      // The part object is the same every tick, updated in place: keep it to read the gun's place and sight.
      if (tag !== undefined) state.turrets.push({ gun: p, gunTag: tag, rotTag: tag.slice(0, -4) + '.rot' });
    }
  }
  state.home = { x: self.pos.x, y: self.pos.y };
  state.mirrorX = -self.pos.x;
  state.blind = 0;
  state.last = null;
  state.lit = -100;
  state.jbays = [
    { tag: 'jl', lit: -1, wait: 0 },
    { tag: 'jr', lit: -1, wait: 0 },
  ];
  state.released = -100;
  state.next = 0;
}

/**
 * Jammer pods. A pod is lit while its bay still holds it. A burnt out pod leaves its bay thinking it still holds
 * something, so `burn` s after lighting the bay is told to let go, and it builds the next. The two bays take
 * turns, `overlap` s apart, so one bubble is always up.
 */
function jam() {
  for (const b of state.jbays) {
    if (time < b.wait || !(get(b.tag, 'ready') > 0)) continue;
    if (b.lit < 0) {
      if (time - state.lit < overlap) continue;
      set(b.tag + get(b.tag, 'built'), 'ignite', 1);
      b.lit = time;
      state.lit = time;
    } else if (time - b.lit > burn) {
      set(b.tag, 'release', 1);
      b.lit = -1;
      b.wait = time + 0.3;
    }
  }
}

/** The other titan's main robot (id 1 or 2) when tracked, else the heaviest tracked robot of the other side. */
function pick() {
  let main = null;
  let best = null;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.id <= 2) main = c;
    else if (c.mass >= minMass && (!best || c.mass > best.mass)) best = c;
  }
  return main || best;
}

/** Casts every anchor that holds no rope. A cast needs a rise, and `fire` is only set on the beat tick. */
function castAnchors() {
  if (anchors < 1 || frame < anchorAt || (frame - anchorAt) % recast !== 0) return;
  for (let i = 1; i <= anchors; i++) {
    const tag = 'an' + i;
    if (!(get(tag, 'hooked') > 0.5)) set(tag, 'fire', 1);
  }
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Turrets: each takes one of the nearest robots of the other side in turn, so they do not all take the same. */
function turrets() {
  const near = [];
  for (const c of contacts) {
    if (c.distance > track) break; // nearest first
    if (c.side === 'enemy') near.push(c);
    if (near.length >= 4) break;
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const t = state.turrets[i];
    const gun = t.gun;
    if (near.length === 0) {
      set(t.gunTag, 'fire', 0);
      set(t.rotTag, 'turn', 0);
      continue;
    }
    const c = near[i % near.length];
    let dx = c.pos.x - gun.pos.x;
    let dy = c.pos.y - gun.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const flight = d / 300;
    dx += c.vel.x * flight;
    dy += c.vel.y * flight + 4.905 * flight * flight;
    const err = wrap(Math.atan2(dy, dx) - gun.out.aim);
    set(t.rotTag, 'turn', clamp(turnGain * err, -1, 1));
    const side = gun.out.sightSide;
    const ok = d < reach && Math.abs(err) < Math.max(0.012, 1.2 / d) && side !== 1 && side !== 2;
    set(t.gunTag, 'fire', ok ? 1 : 0);
  }
}

function tick() {
  jam();
  castAnchors();
  turrets();
  const t = pick();
  if (t) state.last = { x: t.pos.x, y: t.pos.y, vx: t.vel.x, vy: t.vel.y, id: t.id, at: time };
  let aim = state.last;
  const blind = !t && (!aim || time - aim.at > keepLast);
  if (blind) {
    // Over the top onto the mirror column: from 60 m over the ground, or from 60 m over 150 and on down.
    aim = { x: state.mirrorX, y: state.blind % 2 === 0 ? 1 : 150, vx: 0, vy: 0, at: time };
  }
  if (time - state.released < (t ? gap : blindGap)) return;
  // One bay per tick, round robin.
  for (let i = 0; i < state.bays.length; i++) {
    const tag = state.bays[(state.next + i) % state.bays.length];
    if (!(get(tag, 'ready') > 0)) continue;
    const msg = { x: aim.x, y: aim.y, vx: t ? aim.vx : 0, vy: t ? aim.vy : 0, arc: !blind && aim.y > state.home.y + high ? 0 : 1 };
    if (t) msg.id = t.id;
    if (blind) state.blind++;
    send(tag + get(tag, 'built'), msg);
    set(tag, 'release', 1);
    state.released = time;
    state.next = (state.next + i + 1) % state.bays.length;
    return;
  }
}
