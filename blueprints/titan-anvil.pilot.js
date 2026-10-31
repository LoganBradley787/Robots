// titan-anvil pilot: a flying brick of armor that only rams.
// A hard hit hurts what is near the contact (about 6 m deep), so the brick aims the contact at where the enemy's
// main core is: it scans the enemy's main robot, works out how deep its core sits behind each face, and comes in on
// the thinnest one. From the side it flies through the core's row; from below it climbs into the core's column with
// its roof (gravity stops the climb, so that is safe at the arena's edge); from above it lines up over the core and
// cuts its lift, dropping onto it. A robot known only from gun sights (it hides from radar) is taken from below,
// across its whole length.
// - The main enemy (titan-darts, 2026-10, Logan): picked from what the radar reports, never by id: the heaviest enemy
//   with a live core of `mainMass` kg or more (nearest first on a tie), kept unless one twice as heavy shows up. One
//   seen as debris (no live core) is done with: the brick lands, and takes off again for the next enemy with a live
//   core it sees. One that vanished alive stays the main enemy (inside an arena; in the open sandbox only for
//   `forget` s), and gun sights that read its id keep touching it. Until a main enemy is known, sights count unless
//   they read a robot seen lighter than `mainMass`.
// - Ways in (titans v2, 2026-10): each ram is one try along one way in (its left face, its right face, from below,
//   from above). A try that ends without a hit that broke parts off counts against that way, and after `tries` such
//   in a row the brick picks the next best way, so a target that keeps slipping one approach meets another. While it
//   closes it leads the target's height to the moment of contact (a target that dives is followed down at up to free
//   fall: the lift is cut), and it leans into a long speed change (up to `tilt` degrees) so the lift rows push it
//   along too, levelling out before the hit.
// - Rams (titans v3, 2026-10, Logan: "it should be trying to go Mach 20"): from the side it closes as fast as it can
//   get (`vmax`, at most what breaks more, `sat`), backs off after each hit (or `breakOff` s pressed and going
//   nowhere) as far as its measured speeding up needs for that speed (at most `maxRun`, less for a target moving
//   away, none for one coming at it), and leans into the run-up. A way in too slow to break what it hits (from below
//   or above, on an armored brick) is left for last.
// - Rolling (titans v3, 2026-10, Logan: decisive mirror matches): a side hit is aimed from both faces' shapes to spin
//   the target and not itself (pickHeight). A brick rolled over now gets up again (see Righting).
// - Peers (titans v3, 2026-10): the rules made for two rammers of one weight (backing off apart, side hits aimed for
//   spin, finishing one that is down) apply only to a target of at least `peer` of its mass. One much lighter is
//   knocked away by each hit, so it is chased and hit again on the way to the edge.
// - Never idle (titans round 6, 2026-10, Logan: "it ain't ramming shit, bro"): an anchored ground base too heavy to
//   bump out, a heavy enemy with nothing to take hold of, and a heavy enemy hidden from radar were each waited out
//   hidden for the rest of the match, and short of energy against a heavy enemy it hid too. Against laser and dart
//   titans that was waiting to be burnt. Now everything is rammed: a ground base is breached by side hits at
//   `breachSpeed` with its underside `baseGap` over the base's low layer (breachY), the spin of a hit reckoned about
//   its real center of mass (`comUp`: the low layout keeps the core low in a floor slab). A tall heavy enemy's top is
//   no longer pushed (`pushTop`).
// - Bombing runs (titans round 7, 2026-10, Logan: "fly over the top slower and more frequently, using its downward
//   guns to obliterate everything"): a ground enemy that stays put and cannot be bumped out is crossed end to end,
//   low and slow, every floor gun firing (bombPass), and rammed only once passes stop breaking things; rams that
//   break nothing send it back to bombing. One that moves, one light enough to bump out, and anything in the air
//   are rammed as before. A base hidden from the radar is bombed where it was last seen.
// - Fire freely (titans round 7, Logan: "there's something over there, let's make sure there's nothing over there"):
//   every gun on a face toward an enemy, a dart or the last place the main enemy was seen fires at full rate,
//   whatever its own sight reads (volleyFaces). Friends are not looked out for. Jammer pods are lit on the way in to
//   an armed enemy and on the way out (see Jammers), and it works itself loose when it stops making progress (Stuck).
// Something much heavier with a thin face (lying on its side) is rammed on that face (see the heavy branch).
// It never turns round: boosters on each side push it left or right, the lift rows hold its height and its lean.
// Guns on every face blast what their sights show. Everything goes by `side` and by where its own parts are, so it
// works flipped.
// - Tough targets (anvil r10, 2026-10-30, Logan: "it's just using the guns, which ain't going to do it"): guns that have
//   stopped breaking things drop the lids and bring the lasers out, each on its own part (see Burning). A rake that
//   stopped working moves to another spot and angle (see rake). Something else tearing it up takes over as the main enemy
//   (see Threats).
// - The edge (titans v2, 2026-10): every limit on where it goes comes from the global `arena` (`{ x, y }`, or null in
//   the open sandbox, where it goes wherever its target goes). Time planning (`match`) only applies with an arena.

const mainMass = param('mainMass', 30, { min: 0, max: 100000 }); // kg: the main enemy is never lighter (darts, pods)
const vmax = param('vmax', 130, { min: 10, max: 150 }); // fastest ram, m/s of closing speed (it tops out near 125 leaning, 88 level)
const lineUp = param('lineUp', 60, { min: 10, max: 90 }); // m/s at most while lining up under or over a target, or hurrying to search
const sat = param('sat', 60, { min: 10, max: 150 }); // m/s of speed change in the target past which a harder hit breaks hardly more
const maxRun = param('maxRun', 800, { min: 40, max: 2000 }); // m of run-up at most, before a still target (less the faster it goes)
const breakOff = param('breakOff', 0.8, { min: 0.2, max: 10 }); // s pressed into it, going nowhere, before it backs off
const heavy = param('heavy', 1.3, { min: 0.1, max: 5 }); // an enemy over this share of its own mass is not rammed
const roofGap = param('roofGap', 25, { min: 5, max: 200 }); // m the core keeps under the arena's ceiling
const reserve = param('reserve', 0.05, { min: 0, max: 0.5 }); // share of energy kept for landing
const edgeGap = param('edgeGap', 50, { min: 20, max: 500 }); // m the core keeps inside the arena's side edges
const hideHeight = param('hideHeight', 200, { min: 50, max: 230 }); // m: where it waits out an enemy too heavy to ram
const lapEnd = param('lapEnd', 700, { min: 100, max: 900 }); // m from where it last saw the enemy that a search sweeps, with no arena
const shove = param('shove', 5000, { min: 0, max: 100000 }); // kg: a ground enemy heavier than this with a deep core is not worth bumping
const jamEvery = param('jamEvery', 4.7, { min: 1, max: 5 }); // s between jammer pods (a pod jams 5 s)
const match = param('match', 240, { min: 10, max: 10000 }); // s a match lasts (only with an arena): pushing a heavy enemy stops while the energy left still covers hovering to the end
const hold = param('hold', 60, { min: 0, max: 10000 }); // s of hovering it keeps in hand against a heavy enemy in the open sandbox (no match end)
const pushTop = param('pushTop', 0, { min: 0, max: 1 }); // 1: a heavy enemy standing tall is pushed over by its top (off since round 6: up there its lasers burnt the floor slab from below, and it was carried out of the arena at the ceiling)
const tall = param('tall', 60, { min: 10, max: 250 }); // m: a heavy enemy standing this far over its core is pushed over by its top
const touch = param('touch', 12, { min: 1, max: 40 }); // m/s it closes on that top at
const thin = param('thin', 5, { min: 0, max: 20 }); // m: a heavy enemy's core this near a side face is rammed there anyway
const breach = param('breach', 78, { min: 10, max: 90 }); // m/s for that ram (it costs the face that hits)
const pushGap = param('pushGap', 40, { min: 5, max: 500 }); // m inside the arena's edge its core may go while shoving
const local = param('local', 1, { min: 0, max: 1 }); // 1: a crash only hurts near the contact (round 2), so `breach` rams are worth it
const sweepSpeed = param('sweepSpeed', 40, { min: 5, max: 60 }); // m/s while searching with the gun sights
const sweepHeight = param('sweepHeight', 110, { min: 30, max: 200 }); // m: from here the roof and floor guns' sights cover ground to ceiling
const sweepHigh = param('sweepHigh', 185, { min: 30, max: 220 }); // m: the first pass, where the roof guns reach the ceiling
const uppercut = param('uppercut', 32, { min: 5, max: 45 }); // m/s at most when ramming straight up
const drop = param('drop', 75, { min: 20, max: 150 }); // m it sinks under a target before climbing into it
const perch = param('perch', 40, { min: 10, max: 150 }); // m over a target's top it lines up before dropping onto it
const fall = param('fall', 60, { min: 5, max: 90 }); // m/s at most when dropping onto something (it still brakes for the ground)
const tries = param('tries', 2, { min: 1, max: 10 }); // tries in a row that break nothing before it changes its way in
const tryTime = param('tryTime', 20, { min: 5, max: 120 }); // s a try may take before it counts as one that failed
const hitParts = param('hitParts', 4, { min: 1, max: 100 }); // parts the enemy must lose in a try for it to count as a hit
const tipSpin = param('tipSpin', 0.2, { min: 0.05, max: 2 }); // rad/s: the most spin a hit may give it (it rights about 0.5 rad of spin at 0.2)
const baseSpin = param('baseSpin', 0.35, { min: 0.05, max: 2 }); // rad/s: the same for a hit on a ground base (see breachY)
const breachSpeed = param('breachSpeed', 75, { min: 20, max: 150 }); // m/s it rams a ground base at (it cannot dodge, and this breaks plates)
const baseGap = param('baseGap', 3, { min: 0.5, max: 20 }); // m its underside keeps over a ground base's low layer when breaching it
const giveUp = param('giveUp', 6, { min: 2, max: 100 }); // tries in a row that break nothing on a ground enemy before it regroups
const regroup = param('regroup', 6, { min: 0, max: 120 }); // s it waits high, out of reach of ground guns, before trying again (titans round 6: was 20, Logan: never idle)
const stuckTime = param('stuckTime', 3, { min: 1, max: 30 }); // s going nowhere before it climbs out and backs off
const tilt = param('tilt', 25, { min: 0, max: 40 }); // degrees it leans at most to speed up or slow down
const keepLow = param('keepLow', 80, { min: 0, max: 250 }); // m over the floor under which levelling never costs height (anvil-hard, 2026-10-29)
const forget = param('forget', 30, { min: 1, max: 10000 }); // s a main enemy that vanished alive is kept, with no arena
const pingKeep = param('pingKeep', 15, { min: 1, max: 60 }); // s it keeps going for the place gun sights last touched the enemy
const lead = param('lead', 0.4, { min: 0, max: 1 }); // share of the climb or dive of a target flying at it that it leads
const peer = param('peer', 0.5, { min: 0, max: 10 }); // share of its own mass from which a target is a peer (see fromSide)
const spinAim = param('spinAim', 1, { min: 0, max: 1 }); // 1: picks the height of a side hit from both faces' shapes (see pickHeight)
const volley = param('volley', 1, { min: 0, max: 1 }); // 1: every gun on a face toward an enemy fires, whatever its sight reads (see volleyFaces); 0: a gun fires only on its own sight
const volleyRange = param('volleyRange', 320, { min: 50, max: 1000 }); // m: an enemy this near lights the face toward it (a shell flies about 300 m)
const bomb = param('bomb', 1, { min: 0, max: 1 }); // 1: a ground enemy that stays put is bombed by passes low over it (see bombPass)
const bombSpeed = param('bombSpeed', 14, { min: 4, max: 60 }); // m/s over the target on a bombing pass
const bombGap = param('bombGap', 7, { min: 2, max: 60 }); // m its floor guns keep over the tallest part under it on a pass
const bombOver = param('bombOver', 25, { min: 0, max: 300 }); // m past the target's end before it turns for the next pass
const bombGuns = param('bombGuns', 20, { min: 0, max: 1000 }); // a ground enemy with more guns and lasers pointing up than this is rammed, not bombed
const bombDry = param('bombDry', 2, { min: 1, max: 20 }); // passes in a row that break fewer than `hitParts` before it rams instead
const jam = param('jam', 1, { min: 0, max: 1 }); // 1: lights jammer pods on the way in to an armed enemy and on the way out (see Jammers)
const jamFar = param('jamFar', 170, { min: 0, max: 2000 }); // m: a pod is lit only this far from the enemy (closer, sensors see through the bubble)
const zap = param('zap', 1, { min: 0, max: 1 }); // 1: finishes a target whose guns, lasers and bays are mostly gone with its pop-out lasers (see Finishing)
const zapArms = param('zapArms', 2, { min: 0, max: 1000 }); // guns, lasers and bays a target may have left and still be finished
const zapShare = param('zapShare', 0.12, { min: 0, max: 1 }); // or this share of the most it was seen with, whichever is more
const zapGap = param('zapGap', 15, { min: 3, max: 100 }); // m its slab keeps over the tallest part under it while it burns
const zapStall = param('zapStall', 15, { min: 3, max: 120 }); // s of burning that break nothing before it burns from another spot
const zapEdge = param('zapEdge', 80, { min: 0, max: 500 }); // m: a flier closer than this to where its side would meet the edge is rammed, not finished
const lidFall = param('lidFall', 0.6, { min: 0, max: 5 }); // s after a bay's lid is dropped before its laser is pushed out
const zapKeep = param('zapKeep', 1.15, { min: 1, max: 3 }); // the lasers burn only while the energy left covers this many times hovering to the match's end
const gunnery = param('gunnery', 1, { min: 0, max: 1 }); // 1: a heavy ground gun titan is raked from high and to the side, never rammed (see Gunnery)
const gunMass = param('gunMass', 3, { min: 1, max: 100 }); // times its own mass from which a ground enemy with more than `bombGuns` guns up is raked
const gunRange = param('gunRange', 170, { min: 30, max: 290 }); // m from its near end to the brick's near face while raking (its turrets fire within 150 m, our shells fly 300)
const gunTilt = param('gunTilt', 25, { min: 0, max: 35 }); // degrees it tilts its near face down at it while raking
const gunCross = param('gunCross', 1, { min: 0, max: 1 }); // 1: crosses over to rake the other side, over what stands there (see rake)
const gunHigh = param('gunHigh', 125, { min: 0, max: 220 }); // m over its core its underside keeps while raking (a juggernaut sweeps its mast through a heavy flier lower than 112 m, and parks under one higher up)
const gunSwap = param('gunSwap', 45, { min: 10, max: 1000 }); // s on one side before it crosses over to rake the other side
const gunRoom = param('gunRoom', 550, { min: 50, max: 900 }); // m of room it wants behind its back toward the edge, or it crosses over now
// Round 9 tried crossing only at the start (`gunCrossBy` 30), a hard first crossing (`hardCross` 1: met the mast at 75
// m/s instead of 50, which spun the brick into a tumble), and never crossing into a standing mast: each lost all 6
// seeded juggernaut duels (shoved out at 84 to 121 s, or burnt in its beams' reach at 40 s). Round 8's rules with the
// deeper keel went 2-1-3, so they stay the default; the switches are kept to try again.
const gunCrossBy = param('gunCrossBy', 1000, { min: 0, max: 1000 }); // s into the match after which it never crosses over a raked target
const gunCrossLate = param('gunCrossLate', 0, { min: 0, max: 1 }); // 1: after `gunCrossBy` it still crosses once nothing stands over the ceiling there
const hardCross = param('hardCross', 0, { min: 0, max: 1 }); // 1: the crossing at the start is one run from where it starts, climbing as it closes
const cutRun = param('cutRun', 110, { min: 50, max: 600 }); // m off its end it climbs before crossing over (the run-up; backing off 220 m first used up the room a juggernaut chasing at 30 m/s left)
const nearEnd = param('nearEnd', 0.6, { min: 0, max: 1 }); // throttle of the end it pivots on while tipping off its back (a corner lifts a little sooner)
const crossBack = param('crossBack', 4, { min: 0, max: 20 }); // s it pulls back after a crossing meets something, before it runs at it again
const rakeDry = param('rakeDry', 15, { min: 3, max: 120 }); // s of raking that break nothing before it changes what it does (see rake)
const rakeRam = param('rakeRam', 450, { min: 0, max: 2000 }); // m from a raked target to the edge behind it, under which a dry rake turns into ramming it out
const rakeParts = param('rakeParts', 6, { min: 1, max: 100 }); // parts under which a spell of `rakeDry` s counts as dry
const burn = param('burn', 1, { min: 0, max: 1 }); // 1: the lasers also come out on a target that still shoots back (see Burning)
const burnDry = param('burnDry', 20, { min: 3, max: 120 }); // s of breaking fewer than `burnParts` before they do
const burnParts = param('burnParts', 8, { min: 1, max: 100 }); // parts it must break in `burnDry` s for the guns to count as working
const burnTime = param('burnTime', 25, { min: 1, max: 200 }); // s a beam may need to get through to a part for it to be worth it
const cutStand = param('cutStand', 25, { min: 10, max: 250 }); // m from its near end to a mast it holds off, to cut it (see rake)
const burnHigh = param('burnHigh', 185, { min: 60, max: 215 }); // m over its core it burns from, over its guns' reach
const burnGuns = param('burnGuns', 25, { min: 0, max: 500 }); // guns pointing up under which it crosses over the hull with its lids gone
const burnEdge = param('burnEdge', 200, { min: 0, max: 800 }); // m to the edge behind it under which it crosses anyway
const burnTilt = param('burnTilt', 15, { min: 0, max: 35 }); // degrees its floor tilts in toward what its lasers burn
const beamTilt = param('beamTilt', 20, { min: 0, max: 35 }); // degrees its floor tilts forward there, onto the end past the mast
const cutTilt = param('cutTilt', 22, { min: 0, max: 35 }); // degrees it tilts its floor toward what its lasers burn
const cutWait = param('cutWait', 20, { min: 1, max: 30 }); // s it holds off a standing mast with its lasers before it goes on without cutting it
const beamWait = param('beamWait', 9, { min: 1, max: 30 }); // s it holds there for a beam by the mast to go
const beamGuns = param('beamGuns', 6, { min: 0, max: 30 }); // s of that for its floor guns alone, before the lasers join in
const threatParts = param('threatParts', 10, { min: 1, max: 500 }); // parts lost in `threatTime` s that make it look for who did it (see Threats)
const threatTime = param('threatTime', 6, { min: 1, max: 30 }); // s it counts its own losses over
const threatMass = param('threatMass', 1000, { min: 0, max: 100000 }); // kg: nothing lighter is worth turning on (a shatter's 58 kg gunship pulled it off the king and cost its lids)
const threatHold = param('threatHold', 20, { min: 3, max: 120 }); // s it stays on a threat that has stopped hurting it
const threatNear = param('threatNear', 400, { min: 50, max: 1500 }); // m: a lighter enemy this near while it is losing parts is the one doing it
const threatDarts = param('threatDarts', 3, { min: 1, max: 100 }); // darts in the air from one enemy that make it the one doing it
const say = param('say', 1, { min: 0, max: 1 }); // 1 logs each change of plan

// Limits from the arena (titans v2, 2026-10): none in the open sandbox.
const edge = arena ? arena.x - edgeGap : Infinity; // the core stays within this of the middle, m
const pushEdge = arena ? arena.x - pushGap : Infinity; // how far out its core may go while shoving
const ceiling = arena ? arena.y - roofGap : Infinity; // the core never goes above this

let guns = null;
let zaps = []; // the pop-out lasers: { laser, rot, push } (see runZap)
let pods = []; // jammer pods not yet used
let gunParts = -1;
let pings = []; // one entry per tick a sight touched the enemy's main robot: its reach that tick
const BURNS = [12, 45, 25, 65]; // spots it burns from: m from that end of the hull to its near end
const RAKES = [[1, 0.5], [1.3, 1.2], [1.3, 0.2], [1.12, 1.6]]; // spots a rake moves through: times `gunTilt`, and the point it lands on (see rake)
const WAYS = ['S', 'L', 'R', 'B', 'T']; // either side face (whichever it meets), its left face (going right), its right face, from below, from above

function setup() {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let minY = 1e9;
  let maxY = -1e9;
  let minX = 1e9;
  let maxX = -1e9;
  for (const p of parts) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.y < minY) minY = p.pos.y;
    if (p.pos.y > maxY) maxY = p.pos.y;
    m += p.mass;
    sx += p.mass * p.pos.x;
    sy += p.mass * p.pos.y;
  }
  const cx = sx / m;
  const cy = sy / m;
  let inertia = 0;
  let arms = 0;
  let laX = 0;
  let pushes = 0;
  let paX = 0;
  let pushY = 0;
  let raX = 0;
  for (const p of parts) {
    const dx = p.pos.x - cx;
    const dy = p.pos.y - cy;
    inertia += p.mass * (dx * dx + dy * dy);
    if (p.type !== 'booster') continue;
    const t = p.tags;
    if (t.indexOf('la') >= 0) {
      arms += Math.abs(dx);
      laX += dx;
    } else if (t.indexOf('lb') >= 0) arms += Math.abs(dx);
    else if (t.indexOf('pa') >= 0) {
      pushes++;
      paX += dx;
      pushY += dy;
    } else if (t.indexOf('pb') >= 0) {
      pushes++;
      pushY += dy;
    } else if (t.indexOf('ra') >= 0) raX += dx;
  }
  state.inertia = inertia;
  state.comUp = cy - self.pos.y; // its center of mass over its core (the low layout buries the core in the floor slab)
  state.leanTorque = Math.max(arms * 400, 1); // N m per unit of throttle difference between the two lift halves
  state.laLeft = laX < 0; // the `la` lift half sits left of the middle (it does not when flipped)
  state.raPlus = raX < 0; // the `ra` righting boosters sit at the left end, so they turn it counterclockwise (see Righting)
  state.paDir = paX < 0 ? 1 : -1; // the `pa` boosters sit on the left and push right (the other way when flipped)
  state.pushArm = pushes > 0 ? pushY / pushes : 0; // how far the push line is above the center of mass
  state.bottom = self.pos.y - minY + 0.5; // the core's height over the lowest part's underside
  state.top = maxY - self.pos.y + 0.5; // and under the highest part's top
  state.halfWidth = (maxX - minX) / 2 + 0.5;
  state.home = { x: self.pos.x, y: self.pos.y };
  state.liftForce = 1;
  state.endPlus = 0; // N m the righting boosters at the left end give, and those at the right end
  state.endMinus = 0;
  state.pushRight = 1;
  state.pushLeft = 1;
  state.mainId = -1;
  state.mainMass = 0;
  state.mainSeen = -100; // when the main enemy was last on the radar
  state.light = {}; // ids of enemy robots seen lighter than `mainMass`
  state.last = null;
  state.shape = null;
  state.shapeAt = -100;
  state.dir = 0;
  state.up = false;
  state.upAt = 0;
  state.upCount = 0;
  state.down = false;
  state.downAt = 0;
  state.stallAt = 0;
  state.backing = false;
  state.hitAt = -100;
  state.down2 = false; // the target was seen down (still, on the ground)
  state.finish = false; // the target is down and being bumped out (see pushOut)
  state.climbOver = false; // backing off with lost push boosters: over the target first
  state.mine = null; // its own faces (faces), remade each second
  state.mineAt = -100;
  state.jamAt = -100;
  state.leg = 0;
  state.push = 0;
  state.won = false;
  state.plan = '';
  state.way = ''; // the way in of the try under way ('' for none)
  state.wayAt = 0;
  state.wayParts = 0; // the enemy's parts when the try started
  state.wayHit = false; // it touched the enemy hard during the try
  state.fails = { S: 0, L: 0, R: 0, B: 0, T: 0 };
  state.prevVx = 0;
  state.prevVy = 0;
  state.tvx = 0; // the target's speed a tick ago, for its acceleration
  state.tvy = 0;
  state.tay = 0;
  state.lostAt = -100; // when it last had a target
  state.partCount = parts.length;
  state.hurtAt = -1000; // when it last lost a part
  state.misses = 0; // tries in a row, any way, that broke nothing
  state.regroupUntil = -100;
  state.prog = null; // where it last made progress, and when (see Stuck)
  state.unstick = -100; // until when it climbs out of where it got stuck
  state.escape = null; // titans round 7: getting out of where it is stuck ({ x, y, t, dir, free })
  state.passDir = 0; // the way the bombing pass under way goes (0: none)
  state.passParts = -1; // the enemy's parts when the pass started
  state.passArms = 0; // and its guns, lasers and bays
  state.passes = 0;
  state.unmoved = 0; // hits in a row after which the target did not move (anchored)
  state.hitWatch = null;
  state.dry = 0; // bombing passes in a row that broke little
  state.overSpan = false; // over the target on a bombing pass: every floor gun fires
  state.zapFiring = 0; // lasers burning last tick
  state.zapping = false; // finishing the main enemy (see Finishing)
  state.zapId = -1;
  state.rakeId = -1;
  state.armsId = -1;
  state.armsMax = 0;
  state.rakeAt = -1; // when a rake last broke something, and the enemy's parts then
  state.rakeParts = 0;
  state.rakeStep = 0; // dry spells so far (see rake)
  state.partCount0 = parts.length;
  state.partLog = []; // the main enemy's parts, once a second (see lostOver)
  state.partLogAt = -100;
  state.partLogId = -1;
  state.burnOn = false; // guns stopped working: lasers on what they can reach (see Burning)
  state.burnList = [];
  state.burnSkip = {};
  state.burnAt = -100;
  state.cutMast = false;
  state.cutFrom = -1;
  state.cutBeam = -1;
  state.stationAt = 0; // when a rake last moved to a new spot
  state.lost = []; // when it lost its parts (see Threats)
  state.threatId = -1;
  state.threatUntil = -100;
  state.dartFrom = {}; // each dart's launcher, worked out at first sight
  state.righting = false; // rolled over: everything goes into getting back up (see Righting)
  state.rollDir = 0; // the way it is turning itself over on the ground (1: counterclockwise)
  state.rollAt = 0;
  state.rollTries = 0;
}

function plan(name) {
  if (state.plan === name) return;
  state.plan = name;
  if (say > 0.5) log(name, 'x', self.pos.x.toFixed(0), 'y', self.pos.y.toFixed(0));
}

// Guns: blast whatever enemy is on the sight, and note where the enemy's main robot was touched by one.
function runGuns() {
  if (guns === null || gunParts !== parts.length) {
    // Parts were lost (or this is the first tick): find the guns again and count the boosters still working.
    guns = [];
    pods = [];
    gunParts = parts.length;
    let lifts = 0;
    let pa = 0;
    let pb = 0;
    let endPlus = 0;
    let endMinus = 0;
    const ca = Math.cos(self.angle);
    const sa = Math.sin(self.angle);
    const lasers = [];
    const rots = [];
    const pushes = [];
    const lids = [];
    for (const p of parts) {
      if (p.type === 'gun') guns.push(p);
      else if (p.type === 'laser') lasers.push(p);
      else if (p.type === 'rotator') rots.push(p);
      else if (p.type === 'piston') pushes.push(p);
      else if (p.type === 'decoupler') lids.push(p);
      else if (p.type === 'jammer') {
        if (!(p.out.jamming > 0.5)) pods.push(p);
      } else if (p.type === 'booster') {
        const t = p.tags;
        if (t.indexOf('pa') >= 0) pa++;
        else if (t.indexOf('pb') >= 0) pb++;
        else if (t.indexOf('ra') >= 0) endPlus += Math.abs((p.pos.x - self.pos.x) * ca + (p.pos.y - self.pos.y) * sa) * 400;
        else if (t.indexOf('rb') >= 0) endMinus += Math.abs((p.pos.x - self.pos.x) * ca + (p.pos.y - self.pos.y) * sa) * 400;
        else lifts++;
      }
    }
    // Each laser with the rotator and the piston over it (the nearest of each).
    const zaps0 = zaps;
    zaps = [];
    const nearest = (list, p) => {
      let best = null;
      for (const q of list) if (!best || Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) < Math.hypot(best.pos.x - p.pos.x, best.pos.y - p.pos.y)) best = q;
      return best && Math.hypot(best.pos.x - p.pos.x, best.pos.y - p.pos.y) < 4 ? best : null;
    };
    for (const l of lasers) {
      const rot = nearest(rots, l);
      if (!rot) continue;
      const old = zaps0.find((z) => z.laser.id === l.id);
      // The decouplers that hold this bay's lid (2 m either side of it, in the slab's bottom row).
      const mine = lids.filter((d) => Math.hypot(d.pos.x - l.pos.x, d.pos.y - l.pos.y) < 4);
      zaps.push({ laser: l, rot, push: nearest(pushes, l), lids: mine, lidAt: old ? old.lidAt : undefined, sign: old ? old.sign : undefined, aim: old ? old.aim : null });
    }
    state.liftForce = Math.max(lifts * 400, 1);
    state.endPlus = state.raPlus ? endPlus : endMinus;
    state.endMinus = state.raPlus ? endMinus : endPlus;
    state.pushRight = Math.max((state.paDir > 0 ? pa : pb) * 400, 1); // push toward +x
    state.pushLeft = Math.max((state.paDir > 0 ? pb : pa) * 400, 1); // push toward -x
  }
  // Volleys (titans round 7, 2026-10, Logan: "there's something over there, let's make sure there's nothing over
  // there"): every gun on a face that points at an enemy, a dart, or where the main enemy was last known fires at full
  // rate, whatever its own sight reads. Shells cost nothing (no ammo, no energy). Before, a gun fired only while its
  // own sight read an enemy: a dart coming in at an angle slipped between the two guns whose lines met it, and a
  // friend in a gun's line held its fire. The one gun that holds is one whose sight reads its own robot (it would
  // shoot itself). Friends are not looked out for.
  const lit = volleyFaces();
  const turn = self.angle;
  let lo = 1e9;
  let hi = -1e9;
  let ylo = 1e9;
  for (const p of guns) {
    let rel = p.out.aim - turn;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    const face = Math.abs(rel) < Math.PI / 4 ? 0 : Math.abs(rel) > (3 * Math.PI) / 4 ? 2 : rel > 0 ? 1 : 3; // right, up, left, down
    const side = p.out.sightSide;
    if (side !== 1 && (side === 3 || (volley > 0.5 && lit[face]))) {
      if (!(p.in.fire > 0.5)) set(p.id, 'fire', 1);
    } else if (p.in.fire > 0.5) set(p.id, 'fire', 0);
    if (side === 3) {
      const id = p.out.sightId;
      if (state.mainId >= 0 ? id === state.mainId : !state.light[id]) {
        const d = p.out.sight;
        const px = p.pos.x + Math.cos(p.out.aim) * d;
        const py = p.pos.y + Math.sin(p.out.aim) * d;
        if (px < lo) lo = px;
        if (px > hi) hi = px;
        if (py < ylo) ylo = py;
      }
    }
  }
  if (hi >= lo) {
    pings.push({ lo, hi, ylo, t: time });
    if (pings.length > 300) pings.shift();
  }
}

// The faces whose guns all fire this tick (titans round 7, 2026-10): [right, up, left, down] in its own frame, so a
// tilted brick fires the face that points at the threat. A face is lit by any enemy with a live core within
// `volleyRange` (a dart, a drone, the main enemy) whose bearing is within 55 degrees of it (one on a diagonal lights
// two), by where the main enemy was last known while it hides, by the target under it on a bombing pass (`overSpan`),
// and all of them while it is stuck (whatever holds it may break).
function volleyFaces() {
  const lit = [false, false, false, false];
  if (time < state.unstick) return [true, true, true, true];
  const ca = Math.cos(self.angle);
  const sa = Math.sin(self.angle);
  const light = (dx, dy) => {
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    const d = Math.hypot(lx, ly) || 1;
    if (lx > 0.57 * d) lit[0] = true;
    if (ly > 0.57 * d) lit[1] = true;
    if (lx < -0.57 * d) lit[2] = true;
    if (ly < -0.57 * d) lit[3] = true;
  };
  const reach = state.shape ? Math.max(-state.shape.hullLo, state.shape.hullHi, 0) : 0;
  let mainSeen = false;
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core) continue;
    const big = c.id === state.mainId;
    if (big) mainSeen = true;
    if (c.distance > volleyRange + (big ? reach : 0)) continue;
    light(c.pos.x - self.pos.x, c.pos.y - self.pos.y);
  }
  // Hidden from radar: the place it was last seen (a base does not move) is filled with fire all the same.
  if (!mainSeen && state.last && state.mainId >= 0 && Math.hypot(state.last.x - self.pos.x, state.last.y - self.pos.y) < volleyRange + reach) light(state.last.x - self.pos.x, state.last.y - self.pos.y);
  if (state.overSpan) lit[3] = true;
  return lit;
}

// The pop-out lasers (anvil r8, 2026-10-29, Logan: "once it's taken out what seems to be a threat, it pops a laser out
// and finishes the job"). Each sits in a notch of the floor slab on a piston, under a rotator, pointing down. `out`:
// the pistons push them 2 m down (the barrel's end 1 m under the slab), and each rotator swings its laser onto `aim`
// (the enemy's core, at most 50 degrees off straight down); stowed,
// they are pulled back in, pointing down. A laser burns while it is out, within 4 degrees of its aim, `burn` is set,
// the core is within its reach, and its sight does not read its own robot or the ground (both would only cost energy).
// Aiming goes by the rotator's `angle` (its share of 90 degrees from how it was built, pointing down from the slab), so
// it works flipped: which way a positive angle swings the barrel in the world is read from the laser's own aim.
function runZap(aim, out, burn, aimOf) {
  let firing = 0;
  for (const z of zaps) {
    const l = z.laser;
    const ang = z.rot.out.angle || 0;
    // In its slot it swings only straight down: turned, it jams against the slab (a robot's own bodies touch) and the
    // piston stalled at 37%. So it swings once the piston is all the way out, and goes back in only once straight.
    const pos = z.push ? z.push.out.position || 0 : 1;
    const clear = pos > 0.97;
    // The lid (anvil r9): dropped once, when it first has to come out. The piston waits `lidFall` s after the drop, so
    // the barrel does not push the falling lid (or ride down on it). A lid shot loose, or never there, does not wait.
    let held = false;
    for (const d of z.lids) {
      if (!(d.out.armed > 0.5)) continue;
      held = true;
      if (out && !(d.in.fire > 0.5)) {
        set(d.id, 'fire', 1);
        if (z.lidAt === undefined) z.lidAt = time;
      }
    }
    const lidOpen = !held && (z.lidAt === undefined || time - z.lidAt > lidFall);
    if (z.push) set(z.push.id, 'extend', out && lidOpen ? 1 : pos > 0.02 && Math.abs(ang) < 0.03 ? -1 : 0);
    const rest = self.angle - Math.PI / 2; // straight down from the slab, in the world
    const swung = wrapA(l.out.aim - rest);
    if (Math.abs(ang) > 0.05 && Math.abs(swung) > 0.03) z.sign = Math.sign(swung * ang);
    const sg = z.sign || 1;
    let want = 0;
    let off = 1;
    let dist = 1e9;
    // Burning (anvil r10) each laser has its own part (`z.aim`); finishing they all go for the core (`aim`).
    const at = z.aim && aimOf ? aimOf(z.aim) : aim;
    if (out && at && clear) {
      const bx = l.pos.x + 1.5 * Math.cos(l.out.aim);
      const by = l.pos.y + 1.5 * Math.sin(l.out.aim);
      dist = Math.hypot(at.x - bx, at.y - by);
      want = clamp(wrapA(Math.atan2(at.y - by, at.x - bx) - rest) / (sg * (Math.PI / 2)), -0.55, 0.55); // 50 degrees: past that its beam meets the slab
      off = Math.abs(wrapA(Math.atan2(at.y - by, at.x - bx) - l.out.aim));
    }
    let turn = 3 * (want - ang) - (sg * self.angVel) / 2;
    // On one part it steers by where the barrel really points: `angle` reads the aim it was told, and the arm lags that
    // (at this gain on `angle` it rang 6 degrees either way). Never past the 50 degrees.
    if (z.aim && aimOf && at && dist < 1e8) {
      // Its line to a part turns as the two move: that goes straight into the turn, or a target at 25 m/s is 5 m behind.
      const ax = at.x - l.pos.x - 1.5 * Math.cos(l.out.aim);
      const ay = at.y - l.pos.y - 1.5 * Math.sin(l.out.aim);
      const swingBy = at.vx === undefined ? 0 : (ax * (at.vy - self.vel.y) - ay * (at.vx - self.vel.x)) / Math.max(1, ax * ax + ay * ay);
      turn = sg * (2.2 * wrapA(Math.atan2(ay, ax) - l.out.aim) + swingBy / 2) - (sg * self.angVel) / 2;
      if ((ang > 0.55 && turn > 0) || (ang < -0.55 && turn < 0)) turn = 0;
    }
    set(z.rot.id, 'turn', clamp(turn, -1, 1));
    const side = l.out.sightSide;
    if (z === zaps[0]) state.zapWhy = 'first: lid ' + (held ? 'on' : lidOpen ? 'off' : 'falling') + ' out ' + (z.push ? (z.push.out.position || 0).toFixed(2) : '-') + ' off ' + off.toFixed(3) + ' sight ' + side + ' at ' + (l.out.sight || 0).toFixed(0) + ' core ' + (dist < 1e8 ? dist.toFixed(0) + ' m' : '-');
    // A beam on one part must land on it (1.5 m out at its distance) and on nothing of its own or the ground, or air.
    // (Wreckage in the way counts: a cut mast lay across a deck of guns.)
    const onIt = z.aim && aimOf ? off < Math.max(0.003, 1 / Math.max(1, dist)) && (side === 3 || side === 4) : off < 0.07 && side !== 1 && side !== 5;
    const ready = out && at && burn && clear && onIt && dist < 295;
    if (z.aim && ready && z.aim.on < 0) z.aim.on = time;
    if (ready) firing++;
    if (ready !== l.in.fire > 0.5) set(l.id, 'fire', ready ? 1 : 0);
  }
  return firing;
}

function wrapA(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Burning (anvil r10, 2026-10-30, Logan on a Juggernaut: "it never dropped its lids", "it's just using the guns, which
// ain't going to do it"). A shell does a tenth to a plate and a beam a quarter, and against anything but a plate a beam
// is 12 times a gun's whole fire, so on a target its guns have stopped breaking (or a mast in its way) the lids drop
// and each laser takes one part at a time. `burnList` makes the list once a second: what shoots first, then what drives
// it, by how long a beam needs to get through what stands in front of it (the scan's `cover`), for parts within reach
// of a laser (295 m, 50 degrees off straight down from the slab). The core stays on the list whatever the wait. A laser
// holds a part for that long and takes the next.
const BURN = { laser: 12, rotator: 12, heavyrotator: 12, cannon: 6, lance: 6, fabbay: 4, gun: 1, booster: 20, thruster: 20, propeller: 20, swivelthruster: 20, core: 30 };
const BURN_OF = Object.keys(BURN);
function burnList(main, t, sh) {
  let fx = 0;
  let fy = 0;
  for (const z of zaps) {
    fx += z.laser.pos.x;
    fy += z.laser.pos.y;
  }
  fx /= zaps.length;
  fy /= zaps.length;
  const rest = self.angle - Math.PI / 2;
  const reach = (px, py) => Math.hypot(px - fx, py - fy) < 305 && Math.abs(wrapA(Math.atan2(py - fy, px - fx) - rest)) < 0.85;
  const list = [];
  // A mast first: cut at the height it can reach, as low as it can (frames, so a beam goes through it in a moment). Before
  // that a beam still standing by it, turret and all.
  if (state.cutMast && sh) {
    const mx = t.x + sh.topX;
    if (sh.beams.some((b) => Math.abs(b.rx - sh.topX) < 60)) {
      const guard = scan(main.id, { of: ['laser', 'rotator', 'heavyrotator'] });
      if (guard) for (const p of guard) if (Math.abs(p.pos.x - mx) < 60 && reach(p.pos.x, p.pos.y)) list.push({ rx: p.pos.x - t.x, ry: p.pos.y - t.y, core: false, wait: 0.4, score: -2 });
    }
    const swing = clamp(0.75 + Math.sign(mx - fx) * self.angle, 0.2, 1.4); // its swing that way, with its floor's tilt
    const my = fy - Math.abs(mx - fx) / Math.tan(swing);
    const seen = scan(main.id, { of: 'frame', near: { x: mx, y: my }, most: 6 });
    if (seen) for (const p of seen) if (reach(p.pos.x, p.pos.y)) list.push({ rx: p.pos.x - t.x, ry: p.pos.y - t.y, core: false, wait: 0.5, score: -1 });
  }
  if (state.burnOn && !state.cutMast) {
    const seen = scan(main.id, { of: BURN_OF, from: { x: fx, y: fy }, wide: 0.5 });
    if (seen) {
      for (const p of seen) {
        if (!reach(p.pos.x, p.pos.y)) continue;
        if ((state.burnSkip[Math.round((p.pos.x - t.x) / 4) + ',' + Math.round((p.pos.y - t.y) / 4)] || 0) > time) continue;
        const wait = 0.15 + p.cover / 150; // every plate in the way takes 1.7 s of a beam, the rest far less
        const core = p.type === 'core';
        if (wait > burnTime && !core) continue;
        // Past a booster the beam goes on down the bank: it stays a moment longer for those behind it.
        const stay = (BURN[p.type] || 1) >= 20 ? 1 : 0;
        // What aims a beam at it stands first: it swings the laser, so the rotator under it is the surer mark.
        list.push({ rx: p.pos.x - t.x, ry: p.pos.y - t.y, core, wait: Math.min(wait + stay, 60), score: wait / (BURN[p.type] || 1) });
      }
    }
  }
  list.sort((a, b) => a.score - b.score);
  // A mast to cut takes all of them: far parts and a near mast have the barrels swinging to and fro.
  const first = list.length > 0 ? list[0].score : 0;
  state.burnList = list.filter((it) => first >= 0 || it.score < 0).slice(0, 24);
}
// Each laser's part: it keeps it until it has held it long enough (or 3 s if it cannot get on it), then the nearest
// of the best left. A core is shared.
function burnPick(t) {
  const list = state.burnList;
  for (const z of zaps) {
    const a = z.aim;
    if (a && !(a.on >= 0 ? time - a.on > a.wait : time - a.got > 3)) continue;
    // One it could not get onto is left alone a while.
    if (a && a.on < 0) state.burnSkip[Math.round(a.rx / 4) + ',' + Math.round(a.ry / 4)] = time + 15;
    z.aim = null;
    let best = -1;
    let bestD = 1e9;
    const top = Math.min(list.length, 8);
    for (let i = 0; i < top; i++) {
      const far = Math.hypot(list[i].rx + t.x - z.laser.pos.x, list[i].ry + t.y - z.laser.pos.y);
      const d = far + 40 * i;
      if (far < 293 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    const it = list[best];
    if (!it.core) list.splice(best, 1);
    z.aim = { rx: it.rx, ry: it.ry, wait: it.wait, got: time, on: -1, core: it.core };
  }
}

// How deep the enemy's main core sits behind each of its faces, from a scan: the parts on its row give left and
// right, the parts on its column give below and above.
function measure(main) {
  const seen = scan(main.id);
  if (!seen) return;
  const cx = main.pos.x;
  const cy = main.pos.y;
  let L = cx;
  let R = cx;
  let B = cy;
  let T = cy;
  let low = 1e9;
  let high = -1e9;
  let hullLo = 1e9;
  let hullHi = -1e9;
  let topX = cx;
  let armor = 0;
  for (const p of seen) {
    if (p.type === 'armorplate') armor++;
    const x = p.pos.x;
    const y = p.pos.y;
    if (y < low) low = y;
    if (y > high) {
      high = y;
      topX = x;
    }
    if (x < hullLo) hullLo = x;
    if (x > hullHi) hullHi = x;
    if (Math.abs(y - cy) < 1.6) {
      if (x < L) L = x;
      if (x > R) R = x;
    }
    if (Math.abs(x - cx) < 1.6) {
      if (y < B) B = y;
      if (y > T) T = y;
    }
  }
  // A ground base (titans round 6, 2026-10): how high its low layer stands (most of its columns reach no higher,
  // the base it is built on) and how high it stands over its core (what a side hit on the core meets).
  const tops = {};
  let keepTop = cy;
  let arms = 0; // what shoots or launches: guns, lasers, cannons, bays (titans round 7: worth lighting jammers for)
  for (const p of seen) {
    const k = Math.round(p.pos.x);
    if (tops[k] === undefined || p.pos.y > tops[k]) tops[k] = p.pos.y;
    if (Math.abs(p.pos.x - cx) < 12 && p.pos.y > keepTop) keepTop = p.pos.y;
    const t = p.type;
    if (t === 'gun' || t === 'laser' || t === 'cannon' || t === 'lance' || t === 'fabbay') arms++;
  }
  // Its top, column by column from its left end (titans round 7: a bombing pass follows it, see bombPass).
  const prof = [];
  const x0 = Math.round(hullLo);
  for (let k = x0; k <= Math.round(hullHi); k++) prof.push(tops[k] === undefined ? -1e9 : tops[k] - cy);
  const cols = Object.keys(tops).map((k) => tops[k]).sort((a, b) => a - b);
  // Only a low layer that something stands well over counts (a keep on a long base); a block has none, and is met
  // just over the ground.
  let baseTop = cols.length > 0 ? cols[Math.floor(0.4 * cols.length)] : low;
  if (baseTop > keepTop - 6) baseTop = low;
  // What can shoot up at it on a bombing pass (titans round 7): guns and lasers whose barrels point up now (a turret
  // aims at it, so it counts). A juggernaut's 146 guns and two lasers took 250 parts in two seconds and burnt the
  // core from below while it was bombed; a bastion's six turrets or a woodpecker's six burners do far less.
  const ws = arms > 0 ? scan(main.id, { of: ['gun', 'laser', 'cannon', 'lance'], acts: true }) : null;
  let upArms = 0;
  let upY = 0;
  const beams = []; // its lasers, from its core (see rake)
  if (ws) {
    for (const p of ws) {
      if (p.type === 'laser') beams.push({ rx: p.pos.x - cx, ry: p.pos.y - cy });
      if (Math.sin(p.acts) > 0.2) {
        upArms++;
        upY += p.pos.y - cy;
      }
    }
  }
  upY = upArms > 0 ? upY / upArms : 0; // how high its guns pointing up stand over its core, on average (see Gunnery)
  const f = faces(seen, cx, cy);
  state.shape = { L: cx - L, R: R - cx, B: cy - B, T: T - cy, low: low - cy, high: high - cy, hullLo: hullLo - cx, hullHi: hullHi - cx, topX: topX - cx, ground: low < 3, armored: armor > 0.08 * seen.length, faceL: f.L, faceR: f.R, base: baseTop - cy, keepTop: keepTop - cy, prof, profX: x0 - cx, arms, upArms, upY, beams };
  state.shapeAt = time;
  // The most guns, lasers and bays it was seen with (see Finishing).
  if (state.armsId !== main.id) {
    state.armsId = main.id;
    state.armsMax = arms;
  } else state.armsMax = Math.max(state.armsMax, arms);
  if (say > 0.5 && state.sizedId !== main.id) {
    state.sizedId = main.id;
    log('sized up', main.id, 'arms', arms, 'pointing up', upArms, 'ground', state.shape.ground, 'mass', main.mass.toFixed(0), 'top', state.shape.high.toFixed(0));
  }
}

// How far a body reaches out to each side, row by row: 1 m rows of world height from its core, `FACE` either way.
const FACE = 40;
function faces(list, cx, cy) {
  const L = [];
  const R = [];
  for (let i = 0; i <= 2 * FACE; i++) {
    L.push(-1e9);
    R.push(-1e9);
  }
  for (const p of list) {
    const i = Math.round(p.pos.y - cy) + FACE;
    if (i < 0 || i > 2 * FACE) continue;
    const dx = p.pos.x - cx;
    if (dx > R[i]) R[i] = dx;
    if (-dx > L[i]) L[i] = -dx;
  }
  return { L, R };
}

// Where a level side hit lands with its core `d` m over the target's: the rows where the two faces reach furthest
// toward each other (within 2 m of the most, weighted by how far), as a height from the target's core.
function contactAt(mine, its, d) {
  let best = -1e9;
  for (let v = -FACE; v <= FACE; v++) {
    const u = v - d;
    if (u < -FACE || u > FACE) continue;
    const s = mine[u + FACE] + its[v + FACE];
    if (s > best) best = s;
  }
  if (best < -1e8) return null;
  let w = 0;
  let sv = 0;
  for (let v = -FACE; v <= FACE; v++) {
    const u = v - d;
    if (u < -FACE || u > FACE) continue;
    const s = mine[u + FACE] + its[v + FACE];
    if (s > best - 2) {
      w += s - (best - 2);
      sv += (s - (best - 2)) * v;
    }
  }
  return sv / w;
}

// The height to meet a target from the side at (titans v3, 2026-10, Logan: decisive mirror matches). A side hit
// spins each body by the push times how far the contact is above or below its center of mass, and a brick rolled
// onto its back cannot right itself (its lift then points down, its push boosters along the ground; measured). Two
// flat faces always meet halfway between the two cores, so the spin is shared; a face worn uneven by earlier hits
// is not flat. So it tries each height within 24 m of the target's core and takes the one whose contact is far
// from the target's center and near its own: the target spins, it does not. `armMe` sets how fast it may hit.
function pickHeight(shape, toRight) {
  const mine = toRight ? state.mine.R : state.mine.L;
  const its = toRight ? shape.faceL : shape.faceR;
  let pick = null;
  for (let d = -24; d <= 24; d++) {
    const c = contactAt(mine, its, d);
    if (c === null) continue;
    const armIt = Math.abs(c);
    const armMe = Math.abs(c - d - state.comUp);
    const score = Math.min(armIt, 12) - 3 * armMe - 0.05 * Math.abs(d);
    if (!pick || score > pick.score) pick = { d, armIt, armMe, score };
  }
  return pick;
}

// A try along a way in ends: it counts against that way unless it broke enough off the enemy.
function endTry(main) {
  if (state.way === '') return;
  const lost = main && state.wayParts >= 0 ? state.wayParts - main.parts : 0;
  if (state.wayHit && lost >= hitParts) {
    state.fails[state.way] = 0;
    state.misses = 0;
  } else {
    state.fails[state.way]++;
    state.misses++;
  }
  if (say > 0.5) log('try', state.way, lost >= hitParts && state.wayHit ? 'hit' : 'missed', 'lost', lost, 'fails', state.fails[state.way]);
  state.way = '';
}

// Parts the main enemy lost in the last `s` s, or Infinity before it has watched it that long. A trickle (a gun here and
// there) counts as nothing: under it the rake that stalled 7 minutes never read as dry.
function lostOver(s) {
  const l = state.partLog;
  const n = Math.round(s);
  return l.length > n ? l[l.length - 1 - n] - l[l.length - 1] : Infinity;
}

// Threats (anvil r10, 2026-10-30, Logan: it died to a Mirage while still raking a Juggernaut, "you think you got better
// things to worry about than the rake?", and it fights like its life is on the line). Losing `threatParts` parts in
// `threatTime` s it looks for who is doing it: the lighter enemy with the most darts in the air, else the nearest
// lighter enemy within `threatNear`. That one is the main enemy until it is gone or `threatHold` s after it stopped.
// It has to be on the radar: a mirage's jammers hide it past 150 m, and flying to where it was last seen or where its
// darts first showed crossed the juggernaut and lost the core twice, so a hidden launcher is not hunted.
// Each dart goes to the enemy nearest the line back along its flight, the first time it is seen. Only one under half
// the main enemy's mass and over `threatMass`: the heavy one is already the main enemy, and a swarm's small craft are
// what its guns are for.
function threatNow(m) {
  const now = parts.length;
  if (now < state.partCount0) for (let i = now; i < state.partCount0 && state.lost.length < 400; i++) state.lost.push(time);
  state.partCount0 = now;
  while (state.lost.length > 0 && time - state.lost[0] > threatTime) state.lost.shift();
  const heavies = [];
  for (const c of contacts) if (c.side === 'enemy' && c.core && c.mass >= mainMass) heavies.push(c);
  const counts = {};
  for (const c of contacts) {
    if (c.side !== 'enemy' || !c.core || c.mass >= mainMass) continue;
    if (state.dartFrom[c.id] === undefined) {
      const sp = Math.hypot(c.vel.x, c.vel.y) || 1;
      let best = -1;
      let bestD = 1e9;
      for (const h of heavies) {
        const dx = h.pos.x - c.pos.x;
        const dy = h.pos.y - c.pos.y;
        const back = -(dx * c.vel.x + dy * c.vel.y) / sp; // how far back along its flight
        const off = Math.abs(dx * c.vel.y - dy * c.vel.x) / sp;
        const d = back > -50 ? off : Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = h.id;
        }
      }
      state.dartFrom[c.id] = best;
    }
    const from = state.dartFrom[c.id];
    counts[from] = (counts[from] || 0) + 1;
  }
  if (state.lost.length < threatParts || heavies.length < 2 || state.mainId < 0) return null;
  const lightest = state.mainMass * 0.5;
  let pick = null;
  let score = 0;
  for (const h of heavies) {
    if (h.id === state.mainId || h.mass > lightest || h.mass < threatMass) continue;
    const darts = counts[h.id] || 0;
    const s = darts >= threatDarts ? 1000 + darts : h.distance < threatNear ? 1000 - h.distance : 0;
    if (s > score) {
      score = s;
      pick = h;
    }
  }
  return pick;
}

function tick() {
  const m = self.mass;
  const x = self.pos.x;
  const y = self.pos.y;
  const vx = self.vel.x;
  const vy = self.vel.y;
  // A hit: its own speed jumped this tick (a touch of the ground does not count, it stays well above it then).
  const jolt = Math.hypot(vx - state.prevVx, vy - state.prevVy);
  state.prevVx = vx;
  state.prevVy = vy;
  if (parts.length < state.partCount) state.hurtAt = time;
  if (jolt > 4 && say > 0.5) log('hit', jolt.toFixed(0), 'at', vx.toFixed(0), vy.toFixed(0), 'y', y.toFixed(0), 'spin', self.angVel.toFixed(2));
  state.partCount = parts.length;

  // The main enemy: the one it had (unless one twice as heavy shows up), else the heaviest enemy with a live core of
  // `mainMass` or more (contacts come nearest first, so a tie goes to the nearer). One that vanished alive (a jammer's
  // bubble hides a shatter king for the whole match) stays the main enemy, since the pieces and darts around it
  // would pull the brick off it; seen as debris, it is won and forgotten, and the next enemy with a live core it sees
  // (one placed later in the sandbox) brings it back up.
  let heaviest = null;
  let kept = null;
  let threat = null;
  const hit = threatNow(m);
  for (const c of contacts) {
    if (c.id === state.threatId && c.side === 'enemy' && c.core) threat = c;
    if (c.id === state.mainId) {
      if (c.side === 'enemy' && c.core) kept = c;
      else if (!c.core) {
        state.won = true;
        state.mainId = -1;
        state.way = '';
      }
    }
    if (c.side !== 'enemy' || !c.core) continue;
    if (c.mass < mainMass && c.distance < 500) state.dartAt = time;
    if (c.mass < mainMass) state.light[c.id] = true;
    else if (!heaviest || c.mass > heaviest.mass) heaviest = c;
  }
  // With no arena there is no match to wait out: a main enemy gone from the radar that long is let go.
  if (!arena && state.mainId >= 0 && !kept && time - state.mainSeen > forget) state.mainId = -1;
  if (hit && (!threat || hit.id !== threat.id) && hit.id !== state.mainId) {
    if (say > 0.5) log('it is tearing me up: turning on', hit.id, 'mass', hit.mass.toFixed(0), 'at', hit.distance.toFixed(0), 'm');
    state.threatId = hit.id;
    threat = hit;
    state.threatUntil = time + threatHold;
    state.mainId = -1;
  }
  if (threat && hit && hit.id === threat.id) state.threatUntil = time + threatHold;
  if (state.threatId >= 0 && (time > state.threatUntil || !threat)) {
    if (time > state.threatUntil || contacts.some((c) => c.id === state.threatId && !c.core)) {
      if (say > 0.5) log('threat over: back to the main enemy');
      if (state.mainId === state.threatId) state.mainId = -1;
      state.threatId = -1;
      threat = null;
    }
  }
  const main = threat || (state.mainId < 0 || (heaviest && heaviest.mass > 2 * state.mainMass) ? heaviest : kept);
  if (main) {
    if (main.id !== state.mainId) {
      state.way = '';
      state.fails = { S: 0, L: 0, R: 0, B: 0, T: 0 };
      state.shapeAt = -100;
      state.passDir = 0;
      state.dry = 0;
      state.unmoved = 0;
    }
    state.mainId = main.id;
    state.mainMass = main.mass;
    state.mainSeen = time;
    if (state.won) {
      state.won = false;
      if (say > 0.5) log('a new enemy: taking off', main.id);
    }
  }
  if (main) {
    if (state.partLogId !== main.id) {
      state.partLogId = main.id;
      state.partLog = [];
      state.burnOn = false;
      state.burnList = [];
    }
    if (time - state.partLogAt >= 1) {
      state.partLogAt = time;
      state.partLog.push(main.parts);
      if (state.partLog.length > 130) state.partLog.shift();
    }
  }
  runGuns();
  if (main && time - state.shapeAt > 2) measure(main);
  if (time - state.mineAt > 1) {
    state.mine = faces(parts, self.pos.x, self.pos.y);
    state.mineAt = time;
  }
  while (pings.length > 0 && time - pings[0].t > pingKeep) pings.shift();

  const charge = self.energy.capacity > 0 ? self.energy.stored / self.energy.capacity : 1;
  const hoverPower = ((m * 9.81) / 400) * 60; // J/s the lift boosters draw holding its weight
  const floor = state.bottom + 0.3;
  const push = Math.min(state.pushRight, state.pushLeft);
  const brake = Math.max(1, (0.85 * state.liftForce) / m - 9.81); // m/s² the lift rows can slow a fall by
  let wantVx = 0;
  let wantH = sweepHeight;
  let ramVy = null; // a wanted climb rate when ramming (up, down, or leading a target's height)
  let land = false;
  let calm = false; // level, whatever the speed change: a hit is near
  let limit = edge; // how far from the middle the core may go this tick

  // Its own jammer bubble blinds its radar too (beyond 150 m): while a pod it lit burns, the main enemy is followed
  // where it was last seen (titans round 7).
  const blind = time - state.jamAt < 5.5;
  // What is known of the enemy's main robot: seen by radar (its core's place), or only touched by gun sights.
  let target = null;
  if (main) {
    // Its vertical acceleration, smoothed: a target that starts a dive is led down at once.
    const ay = clamp((main.vel.y - state.tvy) / Math.max(dt, 0.001), -15, 15);
    state.tay = state.tay * 0.8 + ay * 0.2;
    state.tvx = main.vel.x;
    state.tvy = main.vel.y;
    state.last = { x: main.pos.x, y: main.pos.y, vx: main.vel.x, vy: main.vel.y, ay: state.tay, m: main.mass, parts: main.parts, t: time };
    target = state.last;
  } else if (state.last && time - state.last.t < (blind ? 7 : 2)) {
    const age = time - state.last.t;
    target = { x: state.last.x + state.last.vx * age, y: Math.max(1, state.last.y + state.last.vy * age), vx: state.last.vx, vy: state.last.vy, ay: 0, m: state.last.m };
  }
  if (target || pings.length > 0) state.lostAt = time;
  const shape = (main || (blind && target)) && state.shape && time - state.shapeAt < (blind ? 12 : 6) ? state.shape : null;
  if (state.way !== '' && state.wayParts < 0 && main) state.wayParts = main.parts;
  if (state.way !== '' && jolt > 2 && target && Math.abs(target.x - x) < state.halfWidth + 120 + (shape ? Math.max(-shape.hullLo, shape.hullHi) : 0)) state.wayHit = true;
  // Anchored (titans round 7, 2026-10): a target that does not move after a hit (roped down, or far too heavy) is not
  // one to bump out of the arena, however light it reads (Woodpecker worn under 5 t was bumped at for 70 s, roped).
  if (target && jolt > 4 && Math.abs(target.x - x) < state.halfWidth + 120 + (shape ? Math.max(-shape.hullLo, shape.hullHi) : 0)) state.hitWatch = { t: time, max: 0 };
  if (state.hitWatch && target) {
    state.hitWatch.max = Math.max(state.hitWatch.max, Math.hypot(target.vx, target.vy));
    if (time - state.hitWatch.t > 1.2) {
      state.unmoved = state.hitWatch.max < 1.5 ? state.unmoved + 1 : 0;
      state.hitWatch = null;
    }
  }

  // Speeding up (measured, titans v3, 2026-10): air drag is 0.0025 N s²/m² per cell, so with F newtons on it the
  // brick tops out at sqrt(F / k), and goes from still to v in -(m / 2k) ln(1 - k v² / F) meters. Level, on the push
  // boosters alone, it reached 40 m/s in about 180 m and tops out near 88; leaning 25 degrees (the lift rows push
  // too), 60 m/s in 210 m, 80 in 400, 100 in 760, topping out near 125.
  const k = 0.0025 * parts.length;
  const weight = m * 9.81;
  const leanPush = Math.min(weight * Math.tan((tilt * Math.PI) / 180), Math.sqrt(Math.max(0, (0.9 * state.liftForce) ** 2 - weight * weight)));
  const runForce = push + leanPush;
  const vTop = Math.sqrt(runForce / k);
  const runFor = (v) => {
    const q = (k * v * v) / runForce;
    return q >= 0.98 ? 1e9 : (-m / (2 * k)) * Math.log(1 - q);
  };
  // Breaching a ground base (titans round 6, 2026-10, Logan: "it ain't ramming shit"): its core height for a side
  // hit with its underside just clear of the base's low layer, so the face it meets is the one over the target's core
  // and the contact is as low as it gets (a hit low on its face spins it, see tipSpeed). Null for a target in the air.
  // A hit pitches it forward, and its leading corner drops 0.6 m for every degree: too near the base's low layer that
  // corner was driven into it, and a notch broken in the slab locked onto a base roped down by its anchors for good.
  // A ground robot lower than that (a gun drone) is met with its underside 2 m under its top, or it would pass over.
  const breachY = (t) => (shape && shape.ground ? clamp(t.y + Math.min(shape.base + baseGap, shape.keepTop - 2) + state.bottom, floor, ceiling) : null);
  // The fastest side hit on `t` that leaves a spin of `tipSpin` (see fromSide), `baseSpin` on a ground base. The arm
  // is from the contact to its center of mass, which sits `comUp` over its core.
  const tipSpeed = (t) => {
    const bY = breachY(t);
    const tTop = t.y + (shape ? (bY !== null ? shape.keepTop : shape.high) : 5);
    const tLow = t.y + (shape ? shape.low : -5);
    const yAt = bY !== null ? bY : clamp(t.y, floor, ceiling);
    const contactY = (Math.max(yAt - state.bottom, tLow) + Math.min(yAt + state.top, tTop)) / 2;
    const tm = Math.max(t.m, 1);
    return ((bY !== null ? baseSpin : tipSpin) * state.inertia) / (Math.max(1, Math.abs(contactY - yAt - state.comUp)) * ((m * tm) / (m + tm)));
  };
  // Climbing into something from below: sink `drop` under its underside while lining up, then climb at full speed
  // until the climb stalls (the hit, or the ceiling), and start over.
  const fromBelow = (atX, underside, tvx, tvy) => {
    const start = Math.max(floor, underside - state.top - drop);
    // It lines up where the target will be when the climb reaches it (it climbs at about `uppercut`).
    const lead = state.up ? 0 : clamp((underside - y) / uppercut, 0, 4);
    const aimX = clamp(atX + tvx * lead, -edge, edge);
    wantVx = tvx + clamp(0.8 * (aimX - x), -lineUp, lineUp);
    if (!state.up) {
      wantH = start;
      if (Math.abs(aimX - x) < 8 && y - start < 8) {
        state.up = true;
        state.upAt = time;
      }
    } else {
      calm = true;
      ramVy = tvy + uppercut;
      const age = time - state.upAt;
      if ((age > 2 && vy < 4) || age > 14) {
        state.up = false;
        state.upCount++;
        return true; // the try is over
      }
    }
    return false;
  };
  // Dropping onto something from above (titans v2, 2026-10, Logan: "shut off its thrusters and drop like a rock"):
  // line up `perch` over its top, leading where it goes, then cut the lift and fall onto it. The fall is held only to
  // what the lift rows can still stop before the ground.
  const fromAbove = (atX, top, tvx, tvy) => {
    const start = Math.min(ceiling, top + state.bottom + perch);
    const tFall = Math.sqrt((2 * Math.max(0, y - state.bottom - top)) / 9.81);
    const aimX = clamp(atX + tvx * tFall, -edge, edge);
    wantVx = tvx + clamp(0.8 * (aimX - x), -lineUp, lineUp);
    if (!state.down) {
      wantH = start;
      if (Math.abs(aimX - x) < 10 && y > start - 15) {
        state.down = true;
        state.downAt = time;
      }
    } else {
      calm = true;
      ramVy = tvy - fall;
      const age = time - state.downAt;
      if ((age > 1.5 && vy > -2) || y + state.top < top - 5 || age > 10) {
        state.down = false;
        return true;
      }
    }
    return false;
  };
  // Flying through a point from the side. `prefer` (1 or -1, 0 for either) is the way it must be going when it hits:
  // going the other way it passes over the top (`over`, a core height) and comes back. Its height leads the
  // target's to the moment of contact, at up to free fall.
  // Ramming speed (titans v3, 2026-10, Logan: "it should be trying to go Mach 20"): as fast as it gets. Measured: a
  // still anvil rammed at 40 or 60 m/s loses only the guns on its face (each body changes speed by half the closing
  // speed, and armor shrugs off 24 m/s), at 80 about 210 parts, at 100 about 250 (a slab the whole 6 m reach deep). A
  // crash costs both sides the same share of the speed change for the same mass, so no closing speed is worse for it
  // than a slower one: the only limit is `sat`, the target's speed change past which a hit breaks hardly more.
  const fromSide = (t, prefer, over, fast, hard) => {
    const dx = t.x - x;
    // A hit far above or below its center of mass spins the brick (a hit low on a ground base rolled it onto its
    // back, for good: titans v2, 2026-10). The speed is held to what leaves a spin of `tipSpin` it can stop: the
    // contact is the middle of where the two overlap in height, the push is the speed times the pair's shared mass.
    // The overlap is reckoned at the height it is heading for (the target's core, as near as the ground and ceiling
    // allow), so a level hit on something in the air is never slowed, while a ground base lower than its middle is.
    const tm = Math.max(t.m, 1);
    // A peer: a target at least `peer` of its own mass (titans v3, 2026-10). The rules below marked "a peer only"
    // are for two rammers of about one weight, where a hit stops both and each backs off for its own run-up, and a
    // hit's spin is shared. A much lighter target is knocked away by the hit at most of the closing speed and spins
    // the brick hardly at all, so it is chased as it flies off and hit again on the way to the edge (without that,
    // round 4 went from 3-3-0 to 0-6-0 against a hive and from 4-1-1 to 2-0-4 against a mirage, both under a third
    // of its mass, on seeds 1 to 3 both ways round).
    const isPeer = tm >= peer * m;
    // Against a radar-seen target in the air, the height and the spin come from both faces' shapes (pickHeight).
    // Two that both pick the height chase each other's pick to the ground or the ceiling (two anvils each wanting to
    // meet the other lower dove together, each wanting higher both rolled at the ceiling). So against a target flying
    // at it, only the one with more parts left picks; the one with fewer holds its height, and even ones meet level.
    // A peer only.
    const atMe = isPeer && -t.vx * Math.sign(dx) > 10;
    const pickAll = isPeer && spinAim > 0.5 && t === state.last && shape && !shape.ground && state.mine ? pickHeight(shape, dx > 0) : null;
    const rank = !pickAll || !atMe || t.parts === undefined ? 1 : Math.sign(parts.length - t.parts);
    const pick = rank > 0 ? pickAll : null;
    const tip = pick ? (tipSpin * state.inertia) / (Math.max(1, pick.armMe) * ((m * tm) / (m + tm))) : tipSpeed(t);
    // A ground base is rammed at `breachSpeed` (titans round 6, 2026-10): it cannot dodge, that already breaks its
    // plates, and the shorter run-up means a hit every few seconds, not every minute (it backed off 700 m each time).
    const bCap = t === state.last && breachY(t) !== null ? breachSpeed : vmax;
    // `hard` (anvil r10, Logan: "a little nudge", go in hard or not at all): no holding back for the spin it takes.
    const speed = hard ? Math.min(fast, 0.95 * vTop) : Math.max(12, Math.min(fast || Math.min(bCap, vmax, (sat * (m + tm)) / m, 0.95 * vTop), tip));
    // The run-up: what its measured speeding up needs to reach that speed (leaning, against air drag), at most
    // `maxRun` before a still target and less the faster the target moves away from it, so one drifting away is
    // chased, not let go (titans v2, 2026-10: a 250 m run-up let a fleeing hive go for 20 s). Not while backing off
    // after a hit, for up to 30 s: a target going away then is mostly backing off itself (another rammer), and of two
    // anvils the one whose run-up was cut first chased the other to its edge, where every later hit was slow. A peer
    // only: a lighter target going away after a hit was knocked away by it.
    const away = isPeer && state.backing && time - state.hitAt < 30 ? 0 : Math.max(0, t.vx * Math.sign(dx));
    const runCap = clamp(maxRun - 25 * away, 80, state.finish ? 300 : maxRun);
    const runup = clamp(runFor(speed), 40, runCap);
    if (state.dir === 0) state.dir = dx >= 0 ? 1 : -1;
    const ahead = state.dir > 0 ? limit - x : x + limit; // room left before the arena's edge
    let passed = false;
    // The run-up counts from its face, not its core (titans v2, 2026-10: against a base 80 m wide it turned round
    // still touching it, and every bump was a slow one).
    const near = state.halfWidth + (shape ? Math.max(-shape.hullLo, shape.hullHi) : 0);
    // A target closing on it brings its own speed to the hit: no need to run from it, turn and meet it. Closing means
    // the gap shrinks (titans v3, 2026-10): one following it while it backs off faster is not, and turning on it threw
    // away the speed it had backing off (hits at 40 m/s). A peer only: any other target coming at it counts.
    const coming = (isPeer ? (vx - t.vx) * Math.sign(dx) : -t.vx * Math.sign(dx)) > 15 && Math.abs(dx) > near + 60;
    if (dx * state.dir < 0 && (dx * state.dir < -(runup + near) || ahead < 30 || coming)) {
      state.dir = -state.dir; // past it (or backed off far enough): come again
      // A run-up after a hit is part of the same try, timed afresh from here; flying past it ends the try (and so
      // does any turn on a target that is not a peer).
      if (state.backing && isPeer) state.wayAt = time;
      else passed = true;
      state.backing = false;
    }
    // A hit: back off for the next run-up at once. Pressed against it and going nowhere for `breakOff` s: the same.
    // A bump shoves it much further than a steady push, and a brick that sits still is an easy mark.
    if (!state.backing && !state.finish && Math.abs(dx) < near + 20 && dx * state.dir > 0 && jolt > 4) {
      state.dir = -state.dir;
      state.backing = true;
      state.stallAt = time; // the try goes on: what the hit broke off is counted next tick
      state.hitAt = time;
    }
    if (!state.backing && !state.finish && Math.abs(dx) < state.halfWidth + 30 && Math.abs(vx - t.vx) < 2) {
      if (time - state.stallAt > breakOff) {
        state.dir = dx >= 0 ? -1 : 1;
        state.backing = true;
        state.stallAt = time;
        passed = true;
      }
    } else state.stallAt = time;
    const overTop = prefer !== 0 && state.dir !== prefer && over !== null && !state.backing;
    if (dx * state.dir < 0) {
      // Going away for the run-up: as fast as still stops it (on the push boosters alone) at the run-up's end, so it
      // turns round there and the whole run-up goes into speeding up toward the target.
      // Its speed is kept up with only for a target coming after it: one going away (backing off for its own
      // run-up) adds to the gap, and following it too let the pair drift to an arena's edge (titans v3, 2026-10:
      // backing off as fast as the gap needed, whichever of two anvils was slower made the other back off faster).
      // A peer only: a lighter one going away was knocked off by the hit, and keeping up with it ends in the next hit
      // nearer the edge (round 4: a hive bumped out twice in a row this way, let go once this held for every target).
      const left = runup + near - Math.abs(dx);
      // Push boosters lost (titans v3, 2026-10): hits wear away the ones behind a face, and with those gone it backed off
      // at 8 m/s for 170 s. Then it leans instead: it backs off as fast as half its lean can stop it, and climbs clear
      // over the target first (it never leans beside one).
      const stopPush = state.dir > 0 ? state.pushLeft : state.pushRight;
      const weak = Math.min(state.pushLeft, state.pushRight) < 0.25 * Math.max(state.pushLeft, state.pushRight);
      const stopF = weak ? Math.max(0.6 * stopPush, 0.5 * leanPush) : 0.6 * push;
      wantVx = (isPeer && t.vx * Math.sign(dx) > 0 ? 0 : t.vx) + state.dir * clamp(Math.sqrt(2 * (stopF / m) * Math.max(0, left)), 8, Math.max(lineUp, speed));
      state.climbOver = weak && Math.abs(dx) < state.halfWidth + near + 60;
    } else wantVx = t.vx + state.dir * (overTop ? Math.min(speed, lineUp) : speed);
    if (overTop) wantH = over;
    // Off a ground base: clear of its roof. Else at its height, but high enough to lean into the run-up.
    else if (state.climbOver && dx * state.dir < 0) wantH = t.y + (shape ? shape.high : state.top) + state.bottom + 6;
    else if (state.backing || dx * state.dir < 0) wantH = shape && shape.ground ? t.y + shape.high + state.bottom + 3 : Math.max(t.y, floor + 30);
    else {
      const closing = Math.max(5, (vx - t.vx) * Math.sign(dx));
      const reach = shape ? (dx > 0 ? -shape.hullLo : shape.hullHi) : 0;
      const tc = clamp((Math.abs(dx) - state.halfWidth - reach) / closing, 0, 4);
      const ay = Math.abs(t.ay || 0) > 1.5 ? clamp(t.ay, -6, 6) : 0; // only a clear dive or climb
      // A target flying at it is likely matching its height too: led fully, the two would chase each other's
      // climb up to the ceiling (titans v3, 2026-10: an anvil pair met there, and the hit rolled one over). So
      // such a target's climb is led only by `lead`, which lets the pair settle at one height.
      const g = atMe ? lead : 1;
      // One flying at it is met no lower than 30 m over its own floor and no higher than 30 m under the ceiling.
      const lo = atMe ? Math.min(floor + 30, ceiling) : floor;
      const hi = atMe ? Math.max(lo, ceiling - 30) : ceiling;
      if (state.finish) ramVy = (clamp(Math.max(t.y, floor + 27), floor, Math.max(floor, t.y + (shape ? shape.high : 5) + state.bottom - 8)) - y) / Math.max(0.7, tc);
      else if (rank < 0) ramVy = (clamp(y, lo, hi) - y) / Math.max(0.7, tc);
      else {
        const bY = t === state.last ? breachY(t) : null;
        const aimY = bY !== null ? bY : clamp(t.y + (pick ? pick.d : 0) + g * (t.vy * tc + 0.5 * ay * tc * tc), lo, hi);
        ramVy = g * (t.vy + ay * tc) + (aimY - y) / Math.max(0.7, tc);
      }
      if (tc < 2.5) calm = true;
    }
    return passed;
  };
  // Starts a try along `way` (or goes on with the one under way).
  const begin = (way) => {
    if (state.way === way) return;
    if (state.way !== '') endTry(main);
    state.way = way;
    state.wayAt = time;
    state.wayParts = main ? main.parts : -1; // -1: taken from the first sight of it
    state.wayHit = false;
    state.up = false;
    state.down = false;
  };

  // A bombing pass (titans round 7, 2026-10, Logan: "fly over the top slower and more frequently, using its downward
  // guns to obliterate everything, like a bombing run"): it crosses the target from end to end at `bombSpeed`, its
  // floor guns `bombGap` over the tallest part under it (they reach 100 m, and every one fires while it is over the
  // target, sight or no sight: see volleyFaces), turns `bombOver` past the far end and comes back. It never stops
  // over the target: a dart base launches straight up, and a brick hovering over its bays sat in the launch lane
  // (Logan watched round 6 die that way over a bastion). Each pass that breaks fewer than `hitParts` parts off counts
  // toward `bombDry`, after which it rams instead (see the ground branch). `lo` and `hi` are the target's ends.
  const passEnd = () => {
    const now = main ? main.parts : state.last ? state.last.parts : -1;
    const lost = state.passParts >= 0 && now >= 0 ? state.passParts - now : 0;
    // Guns, lasers and bays it broke count too: a base whose bays are building darts grows parts while it is bombed.
    const armsNow = state.shape ? state.shape.arms : 0;
    const armsLost = state.passArms - armsNow;
    state.dry = lost >= hitParts || armsLost >= 1 ? 0 : state.dry + 1;
    if (say > 0.5) log('pass', state.passes, 'broke', lost, 'arms', armsLost, 'dry', state.dry);
    state.passes++;
    state.passParts = now;
    state.passArms = armsNow;
  };
  const bombPass = (tx, ty, sh, lo, hi, tvx) => {
    if (state.passDir === 0) {
      state.passDir = x < (lo + hi) / 2 ? 1 : -1;
      state.passParts = main ? main.parts : state.last ? state.last.parts : -1;
      state.passArms = state.shape ? state.shape.arms : 0;
    }
    const back = x - state.passDir * state.halfWidth; // its trailing edge
    const farEnd = state.passDir > 0 ? hi : lo;
    const atEdge = state.passDir > 0 ? x > limit - 15 : x < -limit + 15;
    if ((back - farEnd) * state.passDir > bombOver || atEdge) {
      passEnd();
      state.passDir = -state.passDir;
    }
    const outside = Math.max(0, lo - (x + state.halfWidth), x - state.halfWidth - hi);
    wantVx = tvx + state.passDir * clamp(bombSpeed + 0.3 * outside, bombSpeed, 40);
    // Height: the tallest part under it and a little ahead, from the scan's top profile (or the target's top).
    // It looks 4 s ahead (a climb of 15 m takes about 2), and from outside the target it comes in over its highest
    // part (titans round 7: coming in at 41 m/s it met a bastion's 31 m tower side on, and rolled over its edge).
    const look = 8 + 4 * Math.abs(vx);
    let top = -1e9;
    if (sh && sh.prof && outside > 10) for (const v of sh.prof) top = Math.max(top, v);
    else if (sh && sh.prof) {
      const a = Math.floor(x - state.halfWidth - (state.passDir < 0 ? look : 4) - (tx + sh.profX));
      const b = Math.ceil(x + state.halfWidth + (state.passDir > 0 ? look : 4) - (tx + sh.profX));
      for (let k = Math.max(0, a); k <= Math.min(sh.prof.length - 1, b); k++) if (sh.prof[k] > top) top = sh.prof[k];
    }
    top = top > -1e8 ? ty + top : ty + (sh ? sh.high : 25);
    // A tilt drops one corner (0.6 m a degree): that comes on top.
    wantH = Math.max(top, 0) + bombGap + state.bottom + state.halfWidth * Math.abs(Math.sin(self.angle));
    if (state.overSpan || outside < 60) calm = true;
    state.overSpan = x + state.halfWidth > lo - 15 && x - state.halfWidth < hi + 15;
  };

  // Finishing (anvil r8, 2026-10-29, Logan: "once it's taken out what seems to be a threat, it pops a laser out and
  // finishes the job"): a target whose guns, lasers and bays are mostly gone (`zapArms`, or `zapShare` of the most it
  // had) is not rammed or bombed any more. Passes and rams stopped breaking anything on what was left of a woodpecker
  // (its keep, plates round the core) and a hive: hits on a ground base are held slow so they do not spin the brick, and
  // a pass's shells do a tenth to plates. So it parks `zapGap` over the tallest part under it, right over the core,
  // pushes its lasers out of the slab and burns down the line to the core, every floor gun firing too. Burning from
  // one spot `zapStall` s without breaking anything, it moves to the next spot (left, then right of the core) for
  // another line in.
  const perchZap = (tx, ty, sh, tvx, tvy, nowParts) => {
    // A target lodged on it moves as it does (anvil r9: under today's crash rule a hive stuck to its face after a hit,
    // and following the hive's speed, its own, it ran away with it to 83 m/s and out at the edge). Close and moving as
    // it does, the target is not led.
    if (Math.hypot(tx - x, ty - y) < state.halfWidth + 25 && Math.hypot(tvx - vx, tvy - vy) < 6 && Math.hypot(vx, vy) > 8) {
      tvx = 0;
      tvy = 0;
    }
    if (state.zapId !== state.mainId) {
      state.zapId = state.mainId;
      state.zapOff = 0;
      state.zapProg = time;
      state.zapParts = nowParts;
      if (say > 0.5) {
        let lids = 0;
        for (const z of zaps) if (z.lids.some((d) => d.out.armed > 0.5)) lids++;
        log('finishing: lasers out, arms left', sh ? sh.arms : -1, 'of', state.armsMax, 'lasers', zaps.length, 'lids on', lids);
      }
    }
    if (nowParts >= 0 && (state.zapParts < 0 || nowParts < state.zapParts)) {
      state.zapParts = nowParts;
      state.zapProg = time;
    }
    if (state.zapFiring === 0 && time - state.zapProg > 2) state.zapProg += dt; // the stall counts only time spent burning
    if (time - state.zapProg > zapStall) {
      state.zapOff++;
      state.zapProg = time;
      if (say > 0.5) log('finishing: nothing breaks, burning from spot', state.zapOff % 3);
    }
    // One laser straight over the core: a slanted beam crosses up to half as many cells again (the one 16 m off the
    // core's column, 25 m up, cut a slot 21 cells long through 12 rows of plates).
    // The laser is picked once (two sit 8 m either side: picked afresh each tick it flipped, and the brick hunted 16 m).
    let pick = null;
    for (const z of zaps) if (z.laser.id === state.zapInner) pick = z;
    if (!pick) for (const z of zaps) if (!pick || Math.abs(z.laser.pos.x - x) < Math.abs(pick.laser.pos.x - x) - 0.5) pick = z;
    state.zapInner = pick ? pick.laser.id : '';
    const ca = Math.cos(self.angle);
    const inner = pick ? (pick.laser.pos.x - x) / Math.max(0.5, ca) : 0; // in its own frame, so a tilt does not move the spot
    const offs = [0, -0.45, 0.45];
    const aimX = clamp(tx - inner + offs[state.zapOff % 3] * state.halfWidth + tvx * 0.5, -edge + state.halfWidth, edge - state.halfWidth); // its whole width inside
    wantVx = tvx + clamp(0.6 * (aimX - x), -lineUp, lineUp);
    let top = -1e9;
    if (sh && sh.prof) {
      const a = Math.floor(x - state.halfWidth - 6 - (tx + sh.profX));
      const b = Math.ceil(x + state.halfWidth + 6 - (tx + sh.profX));
      for (let k = Math.max(0, a); k <= Math.min(sh.prof.length - 1, b); k++) if (sh.prof[k] > top) top = sh.prof[k];
    }
    top = top > -1e8 ? ty + top : ty + (sh ? sh.high : 10);
    wantH = Math.max(top, 0) + zapGap + state.bottom + state.halfWidth * Math.abs(Math.sin(self.angle)) + clamp(tvy, -10, 10);
    if (Math.abs(aimX - x) < 80) calm = true;
    state.overSpan = sh ? x + state.halfWidth > tx + sh.hullLo - 15 && x - state.halfWidth < tx + sh.hullHi + 15 : Math.abs(tx - x) < state.halfWidth;
    state.zapAim = { x: tx, y: ty };
    state.zapOut = Math.abs(aimX - x) < 150;
    state.perched = Math.abs(aimX - x) < 8 && Math.abs(wantH - y) < 8;
  };

  // Gunnery (anvil r8, 2026-10-29, Logan watching it come in from high up firing down at an angle: "that was a smart
  // strategy, I'm impressed"): a ground enemy `gunMass` times heavier with more than `bombGuns` guns up (a
  // juggernaut) is never rammed (rams on 74 t broke nothing, and it shoved the brick out of the arena at 77 to 97 s,
  // pinned between it and the edge) or bombed (its guns shot the floor away). It holds `gunRange` to one side and as
  // high as tilts its near face `gunTilt` down onto where its upward guns stand, so the guns on that face rake them
  // from out of its turrets' reach, and guns pointing up never bear. Every `gunSwap` s, or with less than `gunRoom`
  // behind it, it crosses over to the other side (Logan: "get to the other side, where it could start destroying the
  // thrusters at the back"), high: a juggernaut's mast stands 243 m over its core, plates up to about 100 m and a
  // column of frames above, so it crosses 30 m under the top of what stands there, and a mast in the way is rammed
  // through where it is frames.
  const rake = (t, sh) => {
    // `gunRange` counts from its end on that side (a juggernaut's mast and gun platform stand 108 m out from its
    // core, and at 190 m from the core the brick met them).
    const endOn = (sd) => (sd > 0 ? Math.max(0, sh.hullHi) : Math.max(0, -sh.hullLo));
    const roomOn = (sd) => (arena ? edge - (t.x + sd * (endOn(sd) + gunRange)) * sd : 1e9);
    if (!state.gunSide) {
      // Its tail side first (away from its tallest part, a juggernaut's mast: its nose and the end that drives at
      // things), whichever side it starts on: Logan, "get to the other side, where it could start destroying the
      // thrusters at the back".
      const tail = Math.abs(sh.topX) > 20 ? -Math.sign(sh.topX) : x < t.x ? -1 : 1;
      state.gunSide = gunCross < 0.5 ? (x < t.x ? -1 : 1) : roomOn(tail) > 0.5 * gunRoom ? tail : -tail;
      state.gunAt = time;
    }
    // To the other side when it has more room than this one and this one is short, or after `gunSwap` s if it has room.
    const here = roomOn(state.gunSide);
    const there = roomOn(-state.gunSide);
    // Never mid-crossing, and only 10 s after it got there (the side it starts on is kept even when short of room: the
    // first crossing, while the target is still far and slow, is the one that cuts a mast).
    const settled = !state.gunCrossing && time - (state.gunArrive || 0) > 10;
    // Only over what stands there: a juggernaut's mast cannot be rammed through (a hit is felt over all its 74.6 t, and
    // the frames held at 49 m/s), so with the mast still up it stays and shoots the mast down first (below).
    const towering = t.y + sh.high + 10 > ceiling - 10;
    const mastUp = towering && Math.abs(sh.topX) > 20 && burn > 0.5 && zaps.length > 0;
    // Only at the start (anvil r9, Logan: "cross over it only at the very start of a match"): later crossings climbed
    // within its beams' reach and they burnt up through the keel (4 of 6 contact model losses, at 42 to 46 s).
    const early = time < gunCrossBy || (gunCrossLate > 0.5 && !towering);
    if (gunCross > 0.5 && early && !towering && settled && !(state.burnOn && zaps.length > 0) && ((here < gunRoom && there > here + 100) || (time - state.gunAt > gunSwap && there > gunRoom))) {
      {
        state.gunSide = -state.gunSide;
        if (say > 0.5) log('raking: crossing over to its', state.gunSide > 0 ? 'right' : 'left');
      }
      state.gunAt = time;
    }
    // Not across by `gunCrossBy` (its mast held, or threw it back): it stays and rakes from the side it is on. Later, a
    // target that drives clear under it to the other side leaves it on that side, never crossing back over.
    const clearOf = Math.abs(x - t.x) > (x < t.x ? -sh.hullLo : sh.hullHi) + state.halfWidth;
    if (!early && (state.gunCrossing || (clearOf && (x - t.x) * state.gunSide < 0))) {
      state.gunSide = x < t.x ? -1 : 1;
      if (state.gunCrossing && say > 0.5) log('raking: not across by', gunCrossBy, 's, staying on its', state.gunSide > 0 ? 'right' : 'left');
      state.gunCrossing = false;
      state.gunArrive = time;
    }
    // Burning (anvil r10) it hangs just off an end, high, its floor tilted in (a rake's tilt would point the lasers away:
    // they hang under the floor), never over the hull: its roof guns fire on anything over them at any height, and a laser
    // out of the slab takes 8 shells. Off the tail once no beam stands there (a turret swings 90 degrees either way from
    // the end it stands on, so one cannot see past straight up, and off the other end it is in the clear): from there it
    // looks down through one row of roof plate into the thruster banks. Past the mast only once it is cut.
    const tailDir = Math.abs(sh.topX) > 20 ? -Math.sign(sh.topX) : x < t.x ? -1 : 1;
    const stance = state.burnOn && zaps.length > 0 && (!towering || (x - (t.x + sh.topX)) * tailDir > 0);
    let tailBeam = false;
    for (const b of sh.beams || []) if (b.rx * tailDir > 0) tailBeam = true;
    // Lids gone, the notch is open from straight below, so it crosses over the hull only once few guns point up.
    // With the edge close behind it, it crosses whatever is left: pinned there it would be over the guns for good.
    const mySide = x < t.x ? -1 : 1;
    if (stance) state.gunSide = arena && edge - x * mySide < burnEdge ? -mySide : tailBeam || sh.upArms > burnGuns ? mySide : tailDir;
    // Its back to an edge the hull is coming at, with nothing that can stop it (a mast cut lets it over): the other side.
    if (arena && !stance && !towering && !state.gunCrossing && roomOn(state.gunSide) < 150 && roomOn(-state.gunSide) > roomOn(state.gunSide)) {
      state.gunSide = -state.gunSide;
      state.gunAt = time;
      if (say > 0.5) log('raking: the edge is behind me, crossing over');
    }
    const sd = state.gunSide;
    const aimY = t.y + (sh.upY || 0);
    // A rake that stopped breaking things moves on (2026-10-30; anvil r10, Logan: "you're not even varying your approach
    // vector, you're just sitting there firing at this one chunk"; it hovered 7 minutes at one spot). The fire of a face
    // tilted down lands where its tilt and height say, so each spot is a tilt and a point along that end of the hull (0 at
    // the end, 1 over the core), and how far off it stands follows from them and `gunHigh`. Before, each step came closer
    // and flatter from the same height, and the shells went over the hull.
    const stn = RAKES[state.rakeStep % RAKES.length];
    const rakeTilt = Math.min(gunTilt * stn[0], 35);
    const tanT = Math.tan((rakeTilt * Math.PI) / 180);
    const sway = 25 * Math.sin(time / 6); // never quite still, so its fire walks over what is there
    const range = state.rakeStep === 0 ? gunRange : Math.max(45, (t.y + gunHigh + state.bottom - aimY) / tanT - stn[1] * endOn(sd));
    const off = stance ? BURNS[state.rakeStep % BURNS.length] : range;
    const px = t.x + sd * (endOn(sd) + state.halfWidth + off) + (stance ? 0 : sway);
    const py = stance ? t.y + burnHigh : Math.max(t.y + gunHigh + state.bottom, aimY + (range + stn[1] * endOn(sd)) * tanT); // its face tilted down onto that point
    const across = early && (x - t.x) * sd < endOn(sd) + state.halfWidth + 0.3 * off; // still on the far side, or over it
    if (state.gunCrossing && !across) state.gunArrive = time;
    state.gunCrossing = across;
    if (across) {
      // Over whatever stands there if it can; else 30 m under its top, through the frames (a mast cut once is flown over).
      const clearTop = t.y + sh.high + state.bottom + 12; // its underside over the top of what stands there
      const over = clearTop < ceiling - 10 ? Math.max(clearTop, t.y + 120, stance ? t.y + burnHigh : 0) : clamp(t.y + sh.high - 30, t.y + 150, ceiling - 10);
      wantH = over;
      calm = false;
      // A 10 s climb at 12 m/s let the juggernaut, 30 m/s behind, pin it at the edge; climbing at 25 m/s it must stop in
      // time (with the lift cut it slows by about 7 m/s², and at 1.5 times the gap it coasted 27 m past, to 249 m).
      ramVy = over > y ? Math.min(25, Math.sqrt(2 * 5 * (over - y))) : clamp(over - y, -16, 0);
      // Climb on its own side first, `cutRun` off its end, then across as fast as it goes: a mast in the way is rammed
      // through where it is frames (met at 8 m/s with no run-up, it held, spun the brick, and pinned it at the edge).
      // Hard or not at all (anvil r9, Logan: the crossing met the mast at 50 m/s, "a little nudge"): from the start it
      // climbs while it closes, as fast as it can still be up there by the time it reaches its end, so the whole run
      // from where it starts is run-up.
      const toEnd = Math.max(0, (t.x - sd * (endOn(-sd) + state.halfWidth) - x) * sd);
      const climbT = Math.max(0, over - 20 - y) / 20 + 1;
      // Over its own side and not up there yet, or just thrown back: it pulls back and climbs (2026-10-30: this read "not
      // far" as across, and ran into the hull at full push 105 m up, moved along with it, and never read as stuck,
      // pressed against the beams, until its core went at 44 s; with a mast it held on and rolled round it for 7 s, and
      // staying pressed on the mast, level, every run went out of bounds at 93 s, shoved by it).
      const past = (x - t.x) * sd > 0;
      if (jolt > 10 && !past) state.crossBack = time + crossBack;
      // A mast in the way (anvil r10): frames from over the deck up, 4 wide, and a beam goes through a frame in a tenth of
      // a second. Round 9 flew into it at 41 m/s; now it stops just short, its floor tilted forward. A laser out of the
      // slab lasts a moment against one of its beams (they took all four before one had fired, at 295 m as the brick came
      // in, lids off), so the lids stay on and every floor gun fires down the tilt onto the end past the mast until the
      // beam there is gone (every duel lost it to them at about 19 s). Then the lids drop and the lasers cut the mast. All
      // this for at most `cutWait` s from when it got there, and it goes across.
      const mastX = t.x + sh.topX;
      const toMast = (mastX - x) * sd;
      const spot = mastX - sd * (state.halfWidth + cutStand);
      let beamUp = false;
      for (const b of sh.beams || []) if (Math.abs(t.x + b.rx - mastX) < 60) beamUp = true;
      const there = Math.abs(x - spot) < 60;
      if (mastUp && !beamUp && there && state.cutBeam < 0) state.cutBeam = time;
      if (mastUp && there && y > over - 40 && state.cutFrom < 0) state.cutFrom = time;
      const holding = mastUp && toMast > 0 && (spot - x) * sd < 200 && (state.cutBeam >= 0 ? time - state.cutBeam < cutWait : state.cutFrom < 0 || time - state.cutFrom < beamWait);
      // Over the hull its lasers go in first: its roof guns fire on what is over them, and they took all four in a second.
      const stowing = stance && zaps.some((z) => z.push && (z.push.out.position || 0) > 0.1);
      if (stowing) wantVx = t.vx + (x >= t.x ? 5 : -5);
      else if (holding) {
        // Its floor guns get the first 3 s. A beam still up after that burnt through to the core by 52 s, so the lids drop
        // anyway: this close and this still, the lasers shoot it themselves, and it is not aiming at them.
        state.cutMast = !beamUp || (state.cutFrom >= 0 && time - state.cutFrom > beamGuns);
        if (there) {
          state.gunLean = beamUp ? sd * ((beamTilt * Math.PI) / 180) : 0;
          state.overSpan = true;
        }
        wantVx = t.vx + clamp(0.5 * (spot - x), -lineUp, lineUp);
        state.perched = there;
      } else if (time >= (state.crossBack || 0) && (y > over - 20 || past)) wantVx = sd * vmax;
      else if (hardCross > 0.5) wantVx = t.vx + sd * clamp(toEnd / climbT, 0, vmax);
      else wantVx = t.vx + clamp(0.5 * (t.x - sd * (endOn(-sd) + state.halfWidth + cutRun) - x), -lineUp, lineUp);
    } else {
      wantH = py;
      // Never faster than it can stop by there (it flew in at 62 m/s, past the spot and into the mast).
      wantVx = t.vx + Math.sign(px - x) * Math.min(lineUp, 0.5 * Math.abs(px - x), Math.sqrt(2 * 2.5 * Math.abs(px - x)));
      // On the side its mast stands (the end toward its tallest part) and with the mast up, level: the guns on that face
      // then fire straight into the mast's frames, a quarter of a shell each, and cut it for the crossing.
      const mastSide = Math.abs(sh.topX) > 20 && Math.sign(sh.topX) === sd;
      if (Math.abs(px - x) < 60 && Math.abs(py - y) < 40) state.gunLean = towering && mastSide ? 0 : sd * ((rakeTilt * Math.PI) / 180);
      // Its lasers do it far quicker (anvil r10): up high enough for them to reach it over the deck, floor toward it.
      let beamNear = false;
      for (const b of sh.beams || []) if ((t.x + b.rx - t.x) * sd > 0) beamNear = true;
      if (mastUp && mastSide && !beamNear) {
        state.cutMast = true;
        wantH = Math.max(py, t.y + 180);
        state.gunLean = -sd * ((cutTilt * Math.PI) / 180);
      } else if (stance) {
        state.gunLean = -sd * ((burnTilt * Math.PI) / 180);
        state.overSpan = true;
      }
      if (mastUp && mastSide && !beamNear) state.perched = Math.abs(px - x) < 40 && Math.abs(wantH - y) < 30;
      state.perched = state.perched || (Math.abs(px - x) < 10 && Math.abs(py - y) < 10);
    }
  };

  state.finish = false;
  state.overSpan = false;
  state.cutMast = false;
  state.zapAim = null;
  state.zapOut = false;
  state.perched = false;
  state.gunLean = null;
  const timeLeft = arena ? Math.max(0, match - self.age) : hold; // s of hovering it must keep in hand
  // Hidden from the radar while raking or finishing it: it goes on with that where it was last seen (see below).
  const stickyHidden = !target && state.mainId >= 0 && state.last && state.shape && time - state.last.t < 30 && (state.rakeId === state.mainId || (state.zapping && state.zapId === state.mainId));
  if (state.won && !target) {
    plan('done: landing, watching for the next enemy');
    land = true;
  } else if (charge < reserve) {
    plan('low energy: landing');
    land = true;
  } else if (target && target.m > heavy * m && shape && ((local > 0.5 && Math.min(shape.L, shape.R) <= thin) || (pushTop > 0.5 && shape.high > tall))) {
    // Too heavy to ram head on: its own speed would hardly change. Two answers, from a scan of it; with neither it is
    // rammed like any other (titans round 6, 2026-10: it used to be waited out hidden, for good, and a heavy laser
    // titan burnt it there).
    if (local > 0.5 && Math.min(shape.L, shape.R) <= thin) {
      // Its core sits just behind a side face (it lies on its side): ram that face as fast as it can fly. The
      // brick's own face pays for it; the core deep inside does not.
      // Pressed against it and going nowhere (no room for a run-up near the arena's edge), it backs off and comes
      // again: each bump shoves the enemy on, and its core loses once it is past the edge.
      plan('heavy: ramming the face its core is behind');
      const prefer = shape.L < shape.R ? 1 : -1;
      let over = target.y + shape.high + state.bottom + 10;
      if (over > ceiling) over = null;
      limit = pushEdge;
      fromSide(target, prefer, over, breach);
    } else {
      // It stands tall (a mast): a push on the top of it is a long lever against its weight, so fly into the top
      // and keep pushing until it goes over.
      // It comes up to the top gently (matching the enemy's own speed, `touch` m/s faster) so the meeting is no crash.
      plan('heavy: pushing its top over');
      const top = target.y + shape.high;
      const tx = target.x + shape.topX;
      fromSide({ x: tx, y: Math.min(top - 14, ceiling), vx: target.vx, vy: 0, ay: 0, m: 0 }, 0, null, Math.abs(tx - x) > 150 ? lineUp : touch);
    }
  } else if (target) {
    // Seen by radar: pick the way in. Each way costs how deep the core sits behind that face, plus a penalty for
    // each try along it in a row that broke nothing; ways it cannot fly are left out.
    const under = shape ? target.y - shape.B : target.y;
    const topY = shape ? target.y + shape.T : target.y;
    const cornered = edge - Math.abs(target.x) < 100 && target.y > 60; // no room for a run-up from the side
    const air = shape ? !shape.ground : target.y > 30;
    const can = {
      S: true,
      L: true,
      R: true,
      B: air && under - state.top - 30 > floor,
      // With no arena to bump it out of, one that is down is also come down on from above.
      T: (air || (!arena && shape && Math.hypot(target.vx, target.vy) < 3)) && topY + state.bottom + perch < ceiling && topY - state.top > (air ? 25 : 0),
    };
    // A ground enemy whose core is too deep is bumped out over the nearer edge (with an arena), unless it is too heavy
    // for bumps to move it that far: then it is waited out, hidden. Grinding at such a base was tried (titans v2,
    // 2026-10): an anchored dart base does not move, a hit low enough to reach its core rolls the brick over, and its
    // darts find the brick the moment it stops hiding (it lost at 138 s instead of drawing).
    // One already near the edge is bumped over it whatever its depth (titans v2, 2026-10: a palisade's core piece
    // lay 6 m inside the line, out of reach of a brick held at `edge`, while the rest of it wore the brick down).
    let pushOut = 0;
    if (shape && shape.ground) {
      const deep = Math.min(shape.L, shape.R) > 6;
      const nearEdge = arena && edge - Math.abs(target.x) < 100;
      // Only one too low to hit level (titans v3, 2026-10): another anvil passing near the ground read as a base and
      // was waited out for the rest of the match. Under 40 m/s a side hit breaks no armor (measured).
      // Too heavy to bump out (an anchored base): breached instead, by fast side hits just over its low layer
      // (breachY), again and again on the face it meets (titans round 6, 2026-10). It used to be waited out hidden,
      // for good: against a base that sends laser fliers that is waiting to be burnt (Logan: "it's not doing anything").
      if ((deep && target.m > shove) || state.unmoved >= 2) pushOut = 0;
      else if (arena && (deep || nearEdge)) pushOut = target.x >= 0 ? 1 : -1;
    }
    // Finishing one that is down (titans v3, 2026-10, Logan): on the ground and still or sliding away (an anvil rolled
    // on to its back cannot get up) and being bumped out, it is shoved on toward the edge without a break: no backing
    // off after a hit (it slid 16 s after each bump while the brick backed off, and was bumped every 40 s), short
    // run-ups when it must, no regrouping, and high enough over the ground to lean (it slides with little friction).
    // It counts as down once seen still on the ground (another anvil only passing low is not). A peer only (see
    // fromSide): one much lighter flies far from each bump, and backing off for a fast one carries it out sooner.
    if (pushOut === 0 || target.vx * pushOut < -3) state.down2 = false;
    else if (Math.hypot(target.vx, target.vy) < 3) state.down2 = true;
    state.finish = state.down2 && target.m >= peer * m;
    if (state.way !== '' && !can[state.way]) endTry(main);
    if (state.way !== '' && time - state.wayAt > tryTime) endTry(main);
    if (state.way !== '' && state.wayHit && main && state.wayParts - main.parts >= hitParts) {
      // It works: keep at it, counting a new try from here.
      state.fails[state.way] = 0;
      state.wayAt = time;
      state.wayParts = main.parts;
      state.wayHit = false;
    }
    // Nothing it tries breaks anything off a ground enemy (an anchored base with its core deep and low, where a fast
    // hit would roll the brick over): it climbs out of reach of its guns for a while, then starts over.
    // Bombing (titans round 7, 2026-10): a ground enemy that stays put and cannot be bumped out (an anchored base, a
    // heavy one with its core deep) is bombed by passes low over it while the passes break things (see bombPass);
    // once `bombDry` passes in a row break little (nothing soft is left on its top), it is rammed as before, and
    // when `giveUp` rams in a row break nothing it goes back to bombing. A ground enemy that moves, or one light
    // enough to bump out, is rammed.
    const still = Math.hypot(target.vx, target.vy) < 4;
    // Only one with few guns pointing up (`bombGuns`): over a gun titan the floor is shot away (see measure).
    const bombIt = bomb > 0.5 && shape && shape.ground && still && pushOut === 0 && !state.finish && shape.upArms <= bombGuns;
    if (bombIt && state.misses >= giveUp) {
      state.misses = 0;
      state.dry = 0;
      for (const w of WAYS) state.fails[w] = 0;
      state.passDir = 0;
      if (say > 0.5) log('rams break nothing: bombing again');
    }
    // Once at it, it keeps at it unless clearly more comes back (a woodpecker's bay holding a new burner read as 3 arms).
    const zapLimit = state.zapping && state.zapId === state.mainId ? Math.max(zapArms + 4, 0.3 * state.armsMax) : Math.max(zapArms, zapShare * state.armsMax);
    // A flier near the edge is left to the rams (anvil r9): under today's crash rule a perch that followed a hive out
    // there was thrown past the edge with it (2 of 3 hive matches not won).
    const byEdge = arena && shape && !shape.ground && Math.abs(target.x) > edge - state.halfWidth - zapEdge;
    const finishing = zap > 0.5 && zaps.length > 0 && shape && state.armsId === state.mainId && !state.finish && shape.arms <= zapLimit && !byEdge;
    state.zapping = finishing;
    if (finishing) {
      if (state.way !== '') endTry(main);
      plan('finishing: burning its core');
      perchZap(target.x, target.y, shape, target.vx, target.vy, main ? main.parts : -1);
    }
    // Gunnery: see rake.
    // Without a fresh scan (lost from the radar a moment), it goes on raking with the last one.
    const rakeSh = shape || (state.rakeId === state.mainId ? state.shape : null);
    const raking = gunnery > 0.5 && !finishing && rakeSh && rakeSh.ground && target.m > gunMass * m && rakeSh.upArms > bombGuns;
    if (shape || !raking) state.rakeId = raking ? state.mainId : -1;
    if (raking) {
      // How long since it last moved, and what it broke in that time: under `rakeParts` in `rakeDry` s is dry.
      if (state.rakeAt < 0) state.rakeAt = time;
      const dry = !state.gunCrossing && time - state.rakeAt > rakeDry && lostOver(rakeDry) < rakeParts;
      // Dry with the edge close behind it: the side it is on is the side to shove it from, and a bump does what guns no
      // longer do. It cannot pin the brick out there either: it is on the inside.
      const toEdge = target.x > x ? 1 : -1;
      const ramOut = dry && arena && zaps.length === 0 && arena.x - target.x * toEdge < rakeRam;
      if (dry && !ramOut) {
        state.rakeStep++;
        state.rakeAt = time;
        if (say > 0.5) log('rake dry: moving on, spot', state.rakeStep % RAKES.length, 'broke', lostOver(rakeDry));
      }
      if (ramOut) {
        if (state.way !== '') endTry(main);
        plan('rake dry, the edge behind it: ramming it out');
        limit = pushEdge;
        fromSide(target, toEdge, null, breach, true);
      } else {
        if (state.way !== '') endTry(main);
        plan('raking it from high up');
        rake(target, rakeSh);
      }
    } else {
      state.gunSide = 0;
      state.rakeAt = -1;
      state.rakeStep = 0;
    }
    const bombing = !finishing && !raking && bombIt && state.dry < bombDry;
    if (bombing) {
      if (state.way !== '') endTry(main);
      plan('bombing passes');
      bombPass(target.x, target.y, shape, target.x + shape.hullLo, target.x + shape.hullHi, still ? 0 : target.vx);
    } else if (!finishing && !raking && state.misses >= giveUp && shape && shape.ground && !state.finish) {
      state.regroupUntil = time + regroup;
      state.misses = 0;
      state.way = '';
      for (const w of WAYS) state.fails[w] = 0;
    }
    if (!bombing && !finishing && !raking && time < state.regroupUntil) {
      plan('regrouping out of reach');
      wantVx = clamp(0.5 * (clamp(target.x - Math.sign(target.x - x || 1) * 250, -edge, edge) - x), -sweepSpeed, sweepSpeed);
      wantH = hideHeight;
    }
    let way = state.way;
    if (bombing || finishing || raking || time < state.regroupUntil) way = '';
    else if (way === '' || state.fails[way] >= tries) {
      let best = '';
      let cost = 1e9;
      for (const w of WAYS) {
        if (!can[w]) continue;
        // Either side face counts as the deeper of the two (it may meet either).
        let depth = shape ? (w === 'S' ? Math.max(shape.L, shape.R) : shape[w]) : w === 'B' || w === 'T' ? 30 : 10;
        if (cornered && (w === 'B' || w === 'T')) depth -= 20;
        if (pushOut !== 0 && w !== 'B' && w !== 'T') depth = (w === 'L') === pushOut > 0 ? 0 : 100;
        // The face toward it needs no pass over the top first.
        const turn = (w === 'L' && target.x < x) || (w === 'R' && target.x > x) ? 4 : 0;
        // A way too slow to break what it hits (titans v3, 2026-10): the target changes speed by v m / (m + its mass),
        // and armor takes a one-hit loss only from about 32 m/s (measured: an anvil dropped on at 60 or climbed into
        // at 32 loses its guns and nothing more), anything else from about 20.
        const wv = w === 'B' ? uppercut : w === 'T' ? fall : Math.min(vmax, 0.95 * vTop, tipSpeed(target));
        const slow = (wv * m) / (m + Math.max(target.m, 1)) < (shape && shape.armored ? 32 : 20) ? 40 : 0;
        const c = depth + turn + slow + 15 * state.fails[w] + (w === state.way ? 5 : 0);
        if (c < cost) {
          cost = c;
          best = w;
        }
      }
      if (state.fails[best] >= tries) for (const w of WAYS) state.fails[w] = Math.max(0, state.fails[w] - 1); // all tried: forgive a little
      way = best;
    }
    if (way !== '') begin(way);
    if (way === '') {
      // finishing, raking, bombing or regrouping (above)
    } else if (way === 'B') {
      plan('ramming from below');
      if (fromBelow(target.x, under, target.vx, target.vy)) endTry(main);
    } else if (way === 'T') {
      plan('dropping on it from above');
      if (fromAbove(target.x, topY, target.vx, target.vy)) endTry(main);
    } else {
      plan(way === 'L' ? 'ramming its left face' : way === 'R' ? 'ramming its right face' : 'ramming a side face');
      const prefer = way === 'L' ? 1 : way === 'R' ? -1 : 0;
      let over = null;
      if (shape) {
        over = target.y + shape.high + state.bottom + 10;
        if (over > ceiling) over = shape.ground ? null : target.y + shape.low - state.top - 10;
        if (over !== null && over < floor) over = null;
        // Only as far as puts its core over the line: its core sits that face's depth behind the face it hits.
        if (pushOut !== 0) limit = Math.min(arena.x - pushGap / 2, arena.x - (pushOut > 0 ? shape.L : shape.R) - state.halfWidth + 20);
      }
      if (fromSide(target, prefer, over) && state.dir !== prefer) endTry(main); // it flew on past (or backs off): that run is over
      else if (prefer !== 0 && (target.x - x) * prefer < 0 && Math.abs(target.x) > limit - 60 && target.x * prefer > 0) state.fails[way] = tries; // on its far side with no room to come round: another way
    }
  } else if (pings.length > 0 && !stickyHidden) {
    // Hidden from radar, touched by gun sights. In the air: climb into it from below, at the middle of what the
    // sights touched, then toward each end in turn (its core is somewhere along it). On the ground: from the side.
    let lo = 1e9;
    let hi = -1e9;
    let ylo = 1e9;
    const fresh = pings[pings.length - 1].t > time - 3; // go by the last 3 s of touches when there are any
    for (const p of pings) {
      if (fresh ? time - p.t > 3 : time - p.t > 4 && pings.length > 30) continue;
      if (p.lo < lo) lo = p.lo;
      if (p.hi > hi) hi = p.hi;
      if (p.ylo < ylo) ylo = p.ylo;
    }
    const mass = state.last ? state.last.m : 0;
    if (ylo > 40 && ylo - state.top - 30 > floor) {
      plan('ramming a hidden one from below');
      const span = hi - lo;
      const step = Math.max(0, span / 2 - state.halfWidth * 0.5);
      const k = state.upCount % 3;
      fromBelow(clamp((lo + hi) / 2 + (k === 1 ? -step : k === 2 ? step : 0), -edge, edge), ylo, 0, 0);
    } else {
      // On the ground and hidden: its core is likely deep, so bump it (out over the nearer edge, with an arena).
      // A heavy one too (titans round 6, 2026-10): it used to be waited out hidden, high up, for good, where a dart
      // base's darts came up from below.
      const mid = (lo + hi) / 2;
      // A base that stays put (titans round 7): bombed where the sights touch it and where it was last seen.
      const sh = state.last && state.shape && state.shape.ground && Math.abs(state.last.x - mid) < 150 ? state.shape : null;
      if (bomb > 0.5 && (sh || mass > shove || mass === 0)) {
        plan('bombing a hidden one');
        const tx = sh ? state.last.x : mid;
        bombPass(tx, sh ? state.last.y : 0, sh, Math.min(lo, sh ? tx + sh.hullLo : lo), Math.max(hi, sh ? tx + sh.hullHi : hi), 0);
      } else {
      plan('ramming a hidden one from the side');
      if (arena) limit = pushEdge;
      fromSide({ x: mid, y: Math.max(ylo, floor), vx: 0, vy: 0, ay: 0, m: mass }, mid >= 0 ? 1 : -1, Math.min(ceiling, 60 + state.bottom));
      }
    }
  } else if (!arena && (state.won || state.mainId < 0 || time - state.lostAt > forget) && time - state.hurtAt > forget) {
    // The open sandbox with nothing to go after: rest on the ground, guns watching, until something shows up. Losing
    // parts while it rests means something it cannot see is at it (an enemy hiding in jammer bubbles): it takes off
    // and searches.
    plan('resting, watching for an enemy');
    land = true;
  } else if (stickyHidden && state.rakeId === state.mainId) {
    // Raking one hidden from the radar (its own jammer pods blind it too): where it was last seen, going its way.
    plan('raking where it was last seen');
    const age = time - state.last.t;
    rake({ x: clamp(state.last.x + state.last.vx * Math.min(age, 5), -edge, edge), y: state.last.y, vx: 0, vy: 0, m: state.last.m }, state.shape);
  } else if (stickyHidden) {
    // Finishing one that hid from the radar: it burns on where the core was last seen.
    plan('finishing: burning where its core was last seen');
    perchZap(state.last.x, state.last.y, state.shape, 0, 0, -1);
  } else if (bomb > 0.5 && state.mainId >= 0 && state.last && state.shape && state.shape.ground && Math.hypot(state.last.vx, state.last.vy) < 4) {
    // A base that hid from the radar (titans round 7, 2026-10, Logan): it has not gone anywhere. Round 6 searched for
    // one high up (where its floor guns reached nothing) and floated there, over a bastion's dart lane, until its
    // core went. Now it goes on bombing where the base was last seen, every floor gun firing over it.
    plan('bombing where it was last seen');
    const sh = state.shape;
    bombPass(state.last.x, state.last.y, sh, state.last.x + sh.hullLo, state.last.x + sh.hullHi, 0);
  } else {
    // Nothing known (it hides from the radar): fly level at a height from where the roof and floor guns' sights
    // reach from the ground to the ceiling, and sweep the enemy's half to its edge, then the whole arena (with no
    // arena, `lapEnd` either way of where it last saw the enemy).
    // The first pass is high (a hiding core mostly waits high up at its own end) and fast until the enemy's start.
    plan('searching');
    state.up = false;
    state.down = false;
    const far = state.home.x < 0 ? 1 : -1;
    const mid = arena ? 0 : state.last ? state.last.x : state.home.x;
    const reach = arena ? edge - 10 : lapEnd + 300 * Math.floor(state.leg / 2); // with no arena each sweep reaches further
    const legs = [mid + far * reach, mid, mid + far * reach, mid - far * reach];
    const to = legs[state.leg % legs.length];
    if (Math.abs(to - x) < 10) state.leg++;
    const hurry = arena && state.leg === 0 && (x + state.home.x * 0.5) * far < 0; // not yet halfway to the enemy's start
    wantVx = clamp(0.5 * (to - x), -(hurry ? lineUp : sweepSpeed), hurry ? lineUp : sweepSpeed);
    wantH = state.leg === 0 ? sweepHigh : sweepHeight;
  }

  // Jammers (titans round 7, 2026-10, Logan: "it doesn't seem to be using its jammers anymore"): round 6 lit them only
  // while hiding, and it no longer hides. A lit pod hides the brick from every sensor more than 150 m off (closer
  // ones see through), so turrets and darts that steer by sensors lose it. So a pod is lit, one after another, while
  // it is more than `jamFar` from an armed enemy (guns, lasers or bays on its scan, or darts seen lately): on the
  // way in, and on the way out after a pass or a hit. Close in, a pod does nothing and is kept.
  const foe = target || (state.mainId >= 0 && state.last ? state.last : null);
  // Not while raking (anvil r8): a lit pod blinds its own radar past 150 m (and lit with the edge behind it, 2026-10-30,
  // it went out in 4 of 6 juggernaut duels, not 2: the patrol of one that lost sight of it goes to the same corner), and raking it holds about 260 m off a
  // juggernaut that moves; going by where it last saw it, it drifted to 15 m from its end.
  if (jam > 0.5 && foe && !land && pods.length > 0 && time - state.jamAt > jamEvery && state.rakeId !== state.mainId) {
    const d = Math.hypot(foe.x - x, foe.y - y);
    const armed = (state.shape && state.shape.arms > 0) || time - (state.dartAt || -100) < 10;
    if (armed && d > jamFar && d < 1500) {
      const pod = pods.pop();
      set(pod.id, 'ignite', 1);
      state.jamAt = time;
      if (say > 0.5) log('jammer lit', d.toFixed(0), 'm off,', pods.length, 'left');
    }
  }

  // Righting (2026-10-30, Logan: "anvil flipped over and got stuck upside down immediately", and its firmest rule is
  // never idle). On its back every booster it had pushed it down or along the ground, so a roll was the end of it: a
  // mast hit at 16 s spun it, it landed on its side at 26 s and lay on its roof until the bell. Measured on the brick:
  // - In the air the two lift halves turn it at 0.17 rad/s², too slow to right a roll before the ground, and past 90
  //   degrees the half that turns it also drives it down. Now the righting boosters at the other end join in (a pure
  //   turn, about three times as fast) as soon as it is rolled, or spinning (see `endTurn`).
  // - On the ground the lift rows are off (on its back they press it down; on its side they roll it onto its back,
  //   which is how it got there: sliding on its side at 35 m/s with the lift on). One end's boosters tip it over the
  //   far corner, on to its side, and over onto its floor; the lift rows take over for the last 57 degrees.
  // Guns all fire while it is at it (volleyFaces). `rollGround`: on the ground and not yet near level.
  const sinA = Math.sin(self.angle);
  const cosA = Math.cos(self.angle);
  const lowest = y - state.halfWidth * Math.abs(sinA) + Math.min(-state.bottom * cosA, state.top * cosA);
  const absA = Math.abs(self.angle);
  if (!state.righting && (absA > 1.05 || (absA > 0.7 && self.angle * self.angVel > 0.1))) {
    state.righting = true;
    state.rollDir = 0;
    plan('rolled over: righting');
  } else if (state.righting && absA < 0.5 && Math.abs(self.angVel) < 0.35) {
    state.righting = false;
    state.rollDir = 0;
    state.plan = '';
    if (say > 0.5) log('righted', 'x', x.toFixed(0), 'y', y.toFixed(0));
  }
  const rollGround = state.righting && lowest < 1.5 && absA > 1;
  if (state.righting) {
    state.escape = null;
    state.unstick = time + 1;
  }
  if (rollGround) {
    // Flat on its back either way will do: the end with more left, and the other one if that does not move it.
    if (absA < 3) state.rollDir = self.angle > 0 ? -1 : 1;
    else if (state.rollDir === 0 || time - state.rollAt > 4) {
      if (state.rollDir === 0) state.rollTries = 0;
      else state.rollTries++;
      state.rollDir = state.rollDir === 0 ? (state.endPlus >= state.endMinus ? 1 : -1) : -state.rollDir;
      state.rollAt = time;
    }
  }

  // Stuck (titans v2, 2026-10): wedged on or into the enemy (a ground base's empty dart pits held it 20 s), it is
  // going nowhere whatever it wants. Still for `stuckTime` s while not landing: it works itself loose, and the try it
  // was on counts as failed.
  const tReach0 = target && shape ? (target.x > x ? -shape.hullLo : shape.hullHi) : 0;
  // Getting loose (titans round 7, 2026-10, Logan: "it gets stuck and then doesn't seem to be able to get out"):
  // round 6 climbed at full lift and pushed away at 15 m/s for 2.5 s, again and again, and sat 160 s with the corner
  // of its slab in a slot it had broken in a roped-down keep (plates over and under the corner: lifting pressed it
  // into the plate above). Now it cycles, 1.5 s each, until it has moved `free` m: cut the lift and drop while
  // pushing away; full lift pushing away; full lift pushing the other way; lean hard away. Every gun fires the
  // whole time (volleyFaces), on whatever holds it. Once loose it keeps going away and up for 1.5 s.
  // Going nowhere is reckoned by progress, not speed (titans round 7: rocking on a base's end at 1 to 6 m/s it never
  // read as still): it has not moved `free` m in `stuckTime` s while it wants to.
  const wants = Math.hypot(vx, vy) < 1.5 || Math.abs(wantVx - vx) > 6 || Math.abs(ramVy !== null ? ramVy : wantH - y) > 6;
  // Pressed against a target too heavy to shove, it is carried along and goes nowhere all the same (2026-10-30): beside
  // one, it is reckoned from the target. Not a lighter one: moving with that is shoving it to the edge, which is the
  // point (a hive lodged on its face was let go three times, and the win at 114 s became a draw).
  const beside = target && target.m > heavy * m && Math.abs(target.x - x) < state.halfWidth + tReach0 + 30 && Math.abs(vx - target.vx) < 3;
  const px0 = beside ? x - target.x : x;
  if (land || state.escape || state.righting || state.perched || !wants || !state.prog || state.prog.rel !== !!beside || Math.hypot(px0 - state.prog.x, y - state.prog.y) > 5) state.prog = { x: px0, y, t: time, rel: !!beside };
  if (time - state.prog.t > stuckTime) {
    {
      // Stuck again soon after: the other way first this time.
      const dir0 = target ? (target.x > x ? -1 : 1) : 1;
      const again = time - state.unstick < 10;
      state.escape = { x, y, t: time, dir: again ? -(state.escapeDir || dir0) : dir0, free: 0 };
      state.escapeDir = state.escape.dir;
      if (state.way !== '') {
        state.fails[state.way] = tries - 1;
        endTry(main);
      }
      if (say > 0.5) log('stuck: working loose', 'charge', charge.toFixed(2), 'angle', self.angle.toFixed(2), 'mass', m.toFixed(0), 'lifts', (state.liftForce / 400).toFixed(0));
    }
  }
  let cut = false; // the lift rows off (getting loose: dropping)
  let force = null; // a lean it must take (getting loose)
  if (state.escape) {
    const e = state.escape;
    const age = time - e.t;
    if (!e.free && Math.hypot(x - e.x, y - e.y) > 5) {
      e.free = time;
      if (say > 0.5) log('loose after', age.toFixed(1), 's');
    }
    if ((e.free && time - e.free > 1.5) || age > 40) {
      state.escape = null;
      state.unstick = time;
    } else {
      const ph = e.free ? 1 : Math.floor(age / 1.5) % 4;
      wantVx = (ph === 2 ? -e.dir : e.dir) * 25;
      ramVy = ph === 0 ? -10 : 20;
      cut = ph === 0;
      force = ph === 3 ? -e.dir * ((tilt * Math.PI) / 180) : null;
      calm = ph !== 3;
      state.unstick = time + 1;
    }
  }

  // Height: a wanted climb rate toward the height, never sinking faster than the lift rows can stop before the
  // ground. Ramming may sink at up to that (a free fall while far up: the lift is cut).
  if (land) {
    wantVx = 0;
    wantH = floor;
  }
  wantH = clamp(wantH, floor, ceiling);
  // What it can brake a fall by now (anvil r8): tilted, the lift rows hold up less (a lean at the start went on
  // sinking past the height it wanted and scraped the ground at 39 m/s). Room is to its lowest corner, and the sink
  // toward a wanted height is held to what it can stop by there, not only by the ground.
  const brakeNow = Math.max(0.6, Math.min(brake, (0.85 * state.liftForce * Math.cos(Math.min(1, Math.abs(self.angle)))) / m - 9.81));
  const room = Math.max(0, y - floor - state.halfWidth * Math.abs(Math.sin(self.angle)));
  const sink = Math.max(1, Math.sqrt(2 * brakeNow * 0.8 * room));
  const sinkTo = Math.max(2, Math.sqrt(2 * brakeNow * 0.8 * Math.max(0, y - wantH)));
  const rise = Math.sqrt(2 * 8 * Math.max(0, ceiling + 15 - y)); // gravity alone stops a climb before the arena's roof
  const wantVy = ramVy !== null && !land ? clamp(ramVy, -Math.min(fall, sink), Math.min(uppercut + 10, rise)) : clamp(1.0 * (wantH - y), -Math.min(16, sink, sinkTo), Math.min(12, rise));
  const ay = clamp(2.5 * (wantVy - vy), -9.81, 6);

  // Lean (titans v2, 2026-10, Logan: "tilt to accelerate faster"): when the wanted speed change is more than the
  // push boosters give, it leans the lift rows that way, up to `tilt` degrees, and levels out before a hit.
  // Leaning takes seconds (a 12 t brick turns slowly), so only big changes lean.
  if (land) wantVx = 0;
  // Never faster toward an arena's edge than it can stop before `limit` (no edge in the open sandbox).
  // Going right is stopped by the boosters that push left, and the other way round: count what is left of each.
  // Air drag helps (titans v3, 2026-10): with F on it, it stops from v in (m / 2k) ln(1 + k v² / F) meters, so in
  // `room` meters it can stop from sqrt(F / k (exp(2 k room / m) - 1)). Only 0.7 of the push is counted. Before the
  // lean, so it leans to brake, not on toward the edge (a brick backing off a chaser leaned out of the arena).
  const stopFrom = (f, room) => Math.sqrt((f / k) * (Math.exp(Math.min(30, (2 * k * Math.max(0, room)) / m)) - 1));
  // With the push boosters on one side lost, that side's braking counts a third of the lean instead (away from the
  // ground), or it could never fly toward that edge again (titans v3, 2026-10: it crept at 25 m/s into every ram).
  const leanStop = y - floor > 25 ? 0.35 * leanPush : 0;
  // A lean toward the edge pushes on until it is taken back (anvil r9: leaning 34 degrees into a ram on a hive by the
  // edge, the 12.9 t brick met 6.6 m/s² of its own lift against 3.8 of braking, and went out at x 1000). Half of what
  // the lean pushes is counted against the brake, never more than half the brake.
  const leanOn = (sg) => Math.max(0, 0.5 * m * 9.81 * Math.tan(clamp(-sg * self.angle, 0, 1)));
  const brakeR = Math.max(0.7 * state.pushLeft, state.pushLeft < 0.25 * state.pushRight ? leanStop : 0); // stops it going right
  const brakeL = Math.max(0.7 * state.pushRight, state.pushRight < 0.25 * state.pushLeft ? leanStop : 0);
  const brakeRn = Math.max(0.5 * brakeR, brakeR - leanOn(1));
  const brakeLn = Math.max(0.5 * brakeL, brakeL - leanOn(-1));
  if (limit < Infinity) wantVx = clamp(wantVx, -stopFrom(brakeLn, x + limit), stopFrom(brakeRn, limit - x));
  const dvx = wantVx - vx;
  let lean = 0;
  // Never near the ground or the target: a leaning brick that scrapes something rolls over.
  // Clear of the target's ends, not its core (titans round 7: leaning toward a bastion 106 m from its core, it dipped
  // its leading corner into the base's end, 26 m off, and rocked there for 180 s).
  const tReach = target && shape ? (target.x > x ? -shape.hullLo : shape.hullHi) : 0;
  const clear = y - floor > 25 && (!target || Math.abs(target.x - x) > state.halfWidth + tReach + 60);
  if (force !== null) lean = force;
  else if (state.gunLean !== null && !land) lean = state.gunLean;
  // Not while it climbs hard (anvil r8): the lift is all taken, only 0.12 of it is left to turn with, and a lean
  // started then went on to 35 degrees.
  else if (!land && !calm && clear && tilt > 0 && !(wantVy > 2 && wantVy > vy + 3)) {
    const pushA = (dvx > 0 ? state.pushRight : state.pushLeft) / m;
    const need = 0.25 * Math.abs(dvx) - pushA;
    // Less when low (anvil r8): under `keepLow` levelling may not cost height, so a full lean there overshot to 41
    // degrees and could not be taken back in time.
    const most = ((tilt * Math.PI) / 180) * clamp((y - floor - 25) / Math.max(1, keepLow - 25), 0.3, 1);
    if (need > 0) lean = -Math.sign(dvx) * Math.min(most, Math.atan(need / 9.81));
  }
  if (state.righting) lean = 0;
  // Upside down (past about 80 degrees) the lift rows push it toward the ground: only the difference that turns it
  // back is kept (titans round 6, 2026-10: it doubled them there, and drove itself onto its back).
  let lift = Math.cos(self.angle) > 0.2 ? (m * (9.81 + ay)) / state.liftForce / Math.max(0.5, Math.cos(self.angle)) : 0;
  if (land && room < 0.4 && Math.abs(vy) < 1) lift = 0; // sitting on the ground
  if (cut) lift = 0;

  // Level (or the lean): a spring and damper on the tilt, through the difference between the two lift halves, plus
  // what cancels the push boosters' own turning.
  const w = 1.4;
  // Where it will be in 2 / w s, wrapped: spinning past upside down, it goes on the way it is going. Rolled over it
  // has about 0.3 rad/s² to stop with: it counts that too, or it swung 47 degrees past level.
  const stopIn = state.righting ? 1.7 * Math.abs(self.angVel) : 0;
  const torque = state.inertia * -w * w * wrapA(self.angle - lean + ((2 / w) + stopIn) * self.angVel) + state.pushArm * state.push;
  // The difference between the halves comes out of spare lift only, so leaning never costs height (a level-out
  // from a big tilt may take a little more). In a free fall it keeps just enough lift on one half to steer the tilt.
  // Tipping over (a spin from a hit, or a tilt well past the lean): all it has goes into righting, height or not.
  const tipping = Math.abs(self.angle) > Math.abs(lean) + 0.2 || Math.abs(self.angVel) > 0.12;
  // Upside down the half that turns it also drives it at the ground: less of that, and the righting boosters hold it up.
  const inverted = state.righting ? clamp(-Math.cos(self.angle), 0, 1) : 0;
  const cap = tipping ? 0.5 - 0.35 * inverted : Math.abs(self.angle - lean) > 0.3 ? 0.35 : clamp(1 - lift, 0.12, 0.35);
  // Never at the cost of height when low (anvil-hard, 2026-10-29): starting a lean, or a lean it wanted going to 0
  // while tilted 0.35 rad, counted as tipping, so one lift half went to 0 and the other to full, half of what holds it
  // up, and from 60 m it fell onto the ground in 4 to 7 s (the contact crash model broke its core row in the skid).
  // Low or falling, and not past 45 degrees, the difference is held to the lift it can spare over hovering.
  const hoverNeed = (m * 9.81) / state.liftForce / Math.max(0.5, Math.cos(self.angle));
  const capped = (y - floor < keepLow || vy < -8) && Math.abs(self.angle) < 0.8 ? Math.min(cap, Math.max(0.08, 1 - hoverNeed - 0.05)) : cap;
  const diff = clamp(torque / state.leanTorque, -capped, capped);
  // Near the ceiling while still climbing, nothing is kept on: only a cut lift stops the climb in time (a kept half
  // let it coast through the arena's roof, titans v2, 2026-10).
  const keep = y > ceiling - 60 && vy > 0 && Math.cos(self.angle) > 0 ? 0 : Math.abs(diff);
  lift = clamp(lift, keep, 1 - Math.abs(diff));
  // On its side (a hit rolled it past 60 degrees) the lift rows push it along more than up: lying on the ground on
  // its side, a brick slid out of the arena on them at 84 m/s (titans v3, 2026-10). They are cut while that push
  // heads for the nearer edge and it is already going that way or near it.
  const sideways = -Math.sin(self.angle);
  // Only near the ground (titans round 6, 2026-10): in the air this cut the lift halves' turning too, and a brick
  // spun by a hit rolled on through its side onto its back.
  if (arena && Math.abs(self.angle) > 1.05 && y < state.halfWidth + 6 && sideways * x > 0 && (vx * sideways > 5 || edge - Math.abs(x) < 300)) lift = 0;
  // What the lift halves could not give comes from the righting boosters. On the ground (rolled, on a corner or a
  // face) the lift rows only press it down or roll it onto its back: one end does it alone (see Righting).
  let endTurn = state.righting || Math.abs(self.angVel) > 0.3 ? clamp((torque - diff * state.leanTorque) / Math.max(1, torque > 0 ? state.endPlus : state.endMinus), -1, 1) : 0;
  if (rollGround) {
    lift = 0;
    endTurn = state.rollDir;
  }
  const leftLift = lift > 0 ? clamp(lift - diff, 0, 1) : 0;
  const rightLift = lift > 0 ? clamp(lift + diff, 0, 1) : 0;
  set('la', 'throttle', state.laLeft ? leftLift : rightLift);
  set('lb', 'throttle', state.laLeft ? rightLift : leftLift);
  // Counterclockwise and clockwise: the end that lifts, and on the ground the end it pivots on too, for what it adds.
  const near = rollGround ? (absA > 2.2 ? nearEnd : 0) : vy < 6 ? 0.3 * inverted : 0; // upside down in the air both ends hold it up
  const endPlus = endTurn > 0 ? endTurn : near;
  const endMinus = endTurn < 0 ? -endTurn : near;
  if (endPlus > 0) set(state.raPlus ? 'ra' : 'rb', 'throttle', endPlus);
  if (endMinus > 0) set(state.raPlus ? 'rb' : 'ra', 'throttle', endMinus);

  // Sideways: the boosters on one side or the other.
  // Upside down they push the other way, and on its side up or down (titans v3, 2026-10: a brick on its back drove
  // itself out of the arena wanting to go the other way): turned over, the booster sides swap; on its side, none.
  const facing = Math.cos(self.angle);
  // Rolled over in the air, falling: on its side these are the only boosters that point up (70 kN, half its weight).
  const holdUp = state.righting && !rollGround && vy < 2 && Math.abs(Math.sin(self.angle)) > 0.4 ? Math.sign(Math.sin(self.angle)) : 0;
  // Both ends tried and it will not tip (too many of them shot off): it slides on its back at what it was after, every
  // gun firing, and goes on trying.
  const scoot = rollGround && state.rollTries >= 2 && state.rollDir !== 0 && absA > 2.9;
  const u = rollGround && !scoot ? 0 : holdUp !== 0 ? holdUp : clamp(0.6 * (wantVx - vx), -1, 1) * (facing > 0.3 ? 1 : facing < -0.3 ? -1 : 0);
  set('pa', 'throttle', clamp(u * state.paDir, 0, 1));
  set('pb', 'throttle', clamp(-u * state.paDir, 0, 1));
  state.push = u * (u > 0 ? state.pushRight : state.pushLeft);

  // The lasers: out while finishing, burning while the energy left covers hovering to the end (see runZap).
  if (zaps.length > 0) {
    const spare = self.energy.stored - zapKeep * hoverPower * timeLeft;
    const wasOut = state.zapWasOut;
    const free = !land && !state.righting;
    // Guns stopped working: see Burning.
    if (burn > 0.5 && main && !state.zapping && !state.burnOn && lostOver(burnDry) < burnParts) {
      state.burnOn = true;
      if (say > 0.5) log('guns break nothing: lids off, burning', main.id);
    }
    // Lids gone against something it rakes: guns will not do it, so the lasers stay at it. The match comes before the
    // landing here: it counts only hovering to the end, not `zapKeep` of it.
    if (burn > 0.5 && main && state.rakeId === state.mainId && !state.burnOn && shape && shape.beams.length === 0) state.burnOn = true;
    if (burn > 0.5 && main && state.rakeId === state.mainId && !state.burnOn && zaps.some((z) => z.lidAt !== undefined)) state.burnOn = true;
    const spareB = self.energy.stored - hoverPower * timeLeft;
    const burning = burn > 0.5 && main && target && shape && !state.zapOut && free && spareB > 0 && (state.cutMast || state.burnOn);
    if (burning) {
      if (time - state.burnAt > 1) {
        state.burnAt = time;
        burnList(main, target, shape);
      }
      burnPick(target);
    } else for (const z of zaps) z.aim = null;
    const aimOf = burning ? (a) => ({ x: target.x + a.rx, y: target.y + a.ry, vx: target.vx, vy: target.vy }) : null;
    // In while it crosses over the hull: see rake.
    const wantOut = state.zapOut || (burning && (state.cutMast || (!state.gunCrossing && (state.burnList.length > 0 || zaps.some((z) => z.aim)))));
    state.zapFiring = runZap(state.zapAim, wantOut && free, burning ? spareB > 0 : spare > 0, aimOf);
    if (say > 0.5 && wantOut && time - (state.zapSaid || -100) > 10) {
      state.zapSaid = time;
      log('lasers: burning', state.zapFiring, 'of', zaps.length, 'charge', charge.toFixed(2), 'spare kJ', (spare / 1000).toFixed(0), 'list', state.burnList.length, state.zapWhy || '');
    }
    state.zapWasOut = wantOut && free;
    if (say > 0.5 && wasOut !== state.zapWasOut) log(state.zapWasOut ? 'lasers out' : 'lasers stowed');
  }
}
