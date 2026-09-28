import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '@robots/sim-core';
import { formatParts, partRows } from '../src/commands/parts';

describe('parts', () => {
  const rows = partRows(defaultRegistry());

  it('has a row per part in builder order, with its key and legend tokens', () => {
    expect(rows.map((r) => r.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ';', "'", '/', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    const thruster = rows.find((r) => r.id === 'thruster');
    expect(thruster).toMatchObject({ key: '5', legend: ['T^', 'T<', 'Tv', 'T>'], mass: 1, health: 25, faces: ['N', 'E', 'W'], power: 20 });
    expect(thruster?.details.join('\n')).toContain('maxForce 160 N');
    expect(rows.find((r) => r.id === 'cell')?.legend).toEqual(['E']);
    expect(rows.find((r) => r.id === 'seeker')).toMatchObject({ key: '=', legend: ['S^', 'S<', 'Sv', 'S>'] });
    expect(rows.find((r) => r.id === 'radar')).toMatchObject({ key: ';', legend: ['O'] });
    expect(rows.find((r) => r.id === 'booster')).toMatchObject({ key: "'", legend: ['K^', 'K<', 'Kv', 'K>'], power: 60 });
    expect(rows.find((r) => r.id === 'heavywarhead')).toMatchObject({ key: '/', legend: ['H'] });
    expect(rows.find((r) => r.id === 'heavygyro')).toMatchObject({ key: '', legend: ['Y'] }); // no builder key left: picked from the palette
    expect(rows.find((r) => r.id === 'densebattery')).toMatchObject({ key: '', legend: ['Z'] });
    expect(rows.find((r) => r.id === 'fabbay')).toMatchObject({ key: '', legend: [], mass: 13, health: 150 });
    expect(rows.find((r) => r.id === 'gun')).toMatchObject({ key: '', legend: ['M^', 'M<', 'Mv', 'M>'], mass: 1, faces: ['S'], health: 25, power: 0 });
    expect(rows.find((r) => r.id === 'armorplate')).toMatchObject({ key: '', legend: ['A'], mass: 5, faces: ['N', 'E', 'S', 'W'], health: 250, power: 0 });
    expect(rows.find((r) => r.id === 'armorplate')?.details.join('\n')).toMatch(/takes 0.1 of a shell's damage \(500 hits/);
    expect(rows.find((r) => r.id === 'solar')).toMatchObject({ key: '', legend: ['So'], mass: 0.5, faces: ['S'], health: 8, power: 0 });
    expect(rows.find((r) => r.id === 'swivelthruster')).toMatchObject({ key: '', legend: ['V^', 'V<', 'Vv', 'V>'], mass: 1.5, faces: ['N', 'E', 'W'], health: 25, power: 60 });
    expect(rows.find((r) => r.id === 'fin')).toMatchObject({ key: '', legend: ['L^', 'L<', 'Lv', 'L>'], mass: 0.3, faces: ['N', 'E', 'S', 'W'], health: 10, power: 0 });
    expect(rows.find((r) => r.id === 'mine')).toMatchObject({ key: '', legend: ['Xm'], mass: 1.5, faces: ['N', 'E', 'S', 'W'], health: 60, power: 0 });
    expect(rows.find((r) => r.id === 'radio')).toMatchObject({ key: '', legend: ['N'], mass: 1, health: 30, power: 1 });
    expect(rows.find((r) => r.id === 'jammer')).toMatchObject({ key: '', legend: ['J'], mass: 0.5, faces: ['N', 'E', 'S', 'W'], health: 10, power: 0 });
    expect(rows.find((r) => r.id === 'grapple')).toMatchObject({ key: '', legend: ['Gp^', 'Gp<', 'Gpv', 'Gp>'], mass: 1, faces: ['S'], health: 30, power: 0 });
    expect(rows.find((r) => r.id === 'piston')).toMatchObject({ key: '', legend: ['I^', 'I<', 'Iv', 'I>'], mass: 2, faces: ['N', 'E', 'S', 'W'], health: 40, power: 4 });
    expect(rows.find((r) => r.id === 'flare')).toMatchObject({ key: '', legend: ['Q^', 'Q<', 'Qv', 'Q>'], mass: 0.2, faces: ['S'], health: 5 });
    expect(rows.find((r) => r.id === 'smoke')).toMatchObject({ key: '', legend: ['U'], mass: 0.4, faces: ['N', 'E', 'S', 'W'], health: 10, power: 0 });
  });

  it('describes what each part does from its definition', () => {
    const text = (id: string): string => rows.find((r) => r.id === id)?.details.join('\n') ?? '';
    expect(text('battery')).toContain('stores 1500 J');
    expect(text('warhead')).toMatch(/120 damage/);
    expect(text('warhead')).toMatch(/5 m\/s \(a fall of about 1\.3 m\)/);
    expect(text('rotator')).toMatch(/600 N m/);
    expect(text('piston')).toMatch(/sliding joint mounted by its S face.*up to 3000 N/);
    expect(text('piston')).toMatch(/stroke 2 m, extendSpeed 1.5 m\/s/);
    expect(text('gyro')).toMatch(/E \/ Q/);
    expect(text('seeker')).toMatch(/90 degree cone toward its N face out to 300 m/);
    expect(text('radar')).toMatch(/all around out to 1000 m/);
    expect(text('fabbay')).toMatch(/builds its recipe \(the part's "makes"\) in its hollow \(1 by 5 by default\): 40 J per kg plus what its containers hold, 0.6 s per kg for parts with no build time of their own \(a recipe takes the sum over its parts; longer if its draw/);
    expect(text('booster')).toMatch(/build time: 1.1 s in a fabricator/);
    expect(text('gun')).toMatch(/10 shells a second out of its N face at 300 m\/s; a shell falls under gravity, takes 5 off the first part it hits/);
    expect(text('gun')).toMatch(/looks 150 m straight out of the barrel/);
    expect(text('gun')).toMatch(/up to 0.5 degrees off the barrel's line/);
    expect(text('solar')).toMatch(/solar: adds 6 J\/s \(times the cosine of the angle between its N face and straight up.*\) to its chunk's energy pool while its N face points up/);
    expect(text('swivelthruster')).toMatch(/tilts its push up to 15 degrees counterclockwise \(positive\) or clockwise \(negative\) from its N face/);
    expect(text('swivelthruster')).toContain('swivel 15 deg');
    expect(text('fin')).toMatch(/plate along its N axis/);
    expect(text('fin')).toMatch(/up to 20 degrees/);
    expect(text('mine')).toMatch(/goes off .* when any part of a robot of another team comes within 3 m/);
    expect(text('mine')).toMatch(/destroyed any other way .* it breaks as a dud/);
    expect(text('radio')).toMatch(/shares what its robot's own sensors see with every robot of its team that has a working radio within 1500 m/);
    expect(text('jammer')).toMatch(/jams for 5 s and is then spent and gone; while it jams, within 30 m of the pod a sensor sees nothing/);
    expect(text('smoke')).toMatch(/releases a cloud 12 m in radius where it is and is used up/);
    expect(text('grapple')).toMatch(/casts a hook 60 m out of its N face and ties a rope to the first thing it hits/);
    expect(text('grapple')).toMatch(/reel \(-1 to 1, positive pulls in\) shortens it up to 5 m\/s/);
    expect(text('flare')).toMatch(/burns 2 s and is gone; while it burns, every sensor that sees it takes it for the robot/);
  });

  it('prints a table', () => {
    const t = formatParts(rows);
    expect(t).toMatch(/^key +part +legend/m);
    expect(t).toMatch(/^5 +thruster +T\^ T< Tv T> +1 +25 +N E W +20/m);
  });
});
