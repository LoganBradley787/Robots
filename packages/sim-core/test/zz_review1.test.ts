import { it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const BP = { format: 1, name: 'lc', grid: ['C  F  F  F  F  F  F', 'W  .  .  .  .  .  W'] };

async function run(secondGap: number | undefined) {
  const w = await World.create({ seed: 1, gravityY: 0 }, space);
  const r = w.spawnBlueprint(BP, { x: 0, y: 20 });
  // push whole robot to vx=4 via kicks on every body over a couple of steps
  for (const g of r.groups) { const mp = w.physics.massProperties(g.bodyId); w.physics.addForceAt(g.bodyId, mp.mass * 4 * 60, 0, mp.comX, mp.comY); }
  for (let i = 0; i < 5; i++) w.step();
  const vx = () => r.groups.map((g) => w.physics.state(g.bodyId).vx.toFixed(3)).join(',');
  const out: string[] = [`before ${vx()}`];
  (r.parts.get('frame@5,1') as any).health = 0;
  w.step();
  out.push(`t0 ${vx()}`);
  if (secondGap !== undefined) {
    for (let i = 0; i < secondGap; i++) w.step();
    (r.parts.get('frame@1,1') as any).health = 0;
    w.step();
    out.push(`t1 ${vx()}`);
  }
  for (let i = 0; i < 4; i++) { w.step(); out.push(`+${i} ${w.robots.map(rr => rr.id + ':' + rr.groups.map((g) => w.physics.state(g.bodyId).vx.toFixed(3)).join('/')).join(' ')}`); }
  console.log(`gap=${secondGap}\n` + out.join('\n'));
  w.dispose();
}

it('consecutive rebuilds', async () => {
  await run(undefined);
  await run(0);
  await run(1);
  await run(3);
});
