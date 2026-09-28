import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '@robots/sim-core';
import { formatParts, partRows } from '../src/commands/parts';

describe('parts', () => {
  const rows = partRows(defaultRegistry());

  it('has a row per part in builder order, with its key and legend tokens', () => {
    expect(rows.map((r) => r.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ';', "'", '/', '', '', '', '', '']);
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
    expect(rows.find((r) => r.id === 'radio')).toMatchObject({ key: '', legend: ['N'], mass: 1, health: 30, power: 1 });
    expect(rows.find((r) => r.id === 'flare')).toMatchObject({ key: '', legend: ['Q^', 'Q<', 'Qv', 'Q>'], mass: 0.2, faces: ['S'], health: 5 });
  });

  it('describes what each part does from its definition', () => {
    const text = (id: string): string => rows.find((r) => r.id === id)?.details.join('\n') ?? '';
    expect(text('battery')).toContain('stores 1500 J');
    expect(text('warhead')).toMatch(/120 damage/);
    expect(text('warhead')).toMatch(/5 m\/s \(a fall of about 1\.3 m\)/);
    expect(text('rotator')).toMatch(/600 N m/);
    expect(text('gyro')).toMatch(/E \/ Q/);
    expect(text('seeker')).toMatch(/90 degree cone toward its N face out to 300 m/);
    expect(text('radar')).toMatch(/all around out to 500 m/);
    expect(text('fabbay')).toMatch(/builds its recipe \(the part's "makes"\) in its hollow \(1 by 5 by default\): 40 J per kg plus what its containers hold, 0.6 s per kg \(longer if its draw/);
    expect(text('gun')).toMatch(/10 shells a second out of its N face at 300 m\/s; a shell falls under gravity, takes 5 off the first part it hits/);
    expect(text('gun')).toMatch(/looks 150 m straight out of the barrel/);
    expect(text('radio')).toMatch(/shares what its robot's own sensors see with every robot of its team that has a working radio within 1500 m/);
    expect(text('flare')).toMatch(/burns 2 s and is gone; while it burns, every sensor that sees it takes it for the robot/);
  });

  it('prints a table', () => {
    const t = formatParts(rows);
    expect(t).toMatch(/^key +part +legend/m);
    expect(t).toMatch(/^5 +thruster +T\^ T< Tv T> +1 +25 +N E W +20/m);
  });
});
