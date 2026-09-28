import { describe, expect, it } from 'vitest';
import { BlueprintError, formatIssues, loadBlueprint, validateBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();
const car = { format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'], legend: { W: { part: 'wheel', tags: ['wheels'] } } };

const issuesOf = (raw: unknown) => validateBlueprint(raw, reg).issues;
const only = (raw: unknown) => {
  const issues = issuesOf(raw);
  expect(issues).toHaveLength(1);
  return issues[0];
};

describe('validateBlueprint', () => {
  it('accepts the car with no issues and returns the plan', () => {
    const r = validateBlueprint(car, reg);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.plan?.groups).toHaveLength(3);
  });

  it('passes expansion errors through and stops', () => {
    expect(only({ format: 1, name: 't', grid: ['J'] })?.code).toBe('UNKNOWN_TOKEN');
  });

  it('UNKNOWN_PART names the known parts', () => {
    const i = only({ format: 1, name: 't', grid: ['Z'], legend: { Z: { part: 'zap' } } });
    expect(i).toEqual({
      severity: 'error',
      code: 'UNKNOWN_PART',
      message: "zap@0,0 uses part 'zap', which does not exist (known: core, frame, battery, wheel, thruster, propeller, decoupler, warhead, gyro, rotator, cell, seeker, radar, booster, heavywarhead, heavygyro, densebattery, flare, fabbay, gun, mine)",
      partId: 'zap@0,0',
      cell: { x: 0, y: 0 },
    });
  });

  it('EMPTY', () => {
    expect(only({ format: 1, name: 't', grid: ['. .'] })?.code).toBe('EMPTY');
  });

  it('DUPLICATE_ID', () => {
    const i = only({ format: 1, name: 't', parts: [{ id: 'a', part: 'core', x: 0, y: 0 }, { id: 'a', part: 'frame', x: 1, y: 0 }] });
    expect(i?.code).toBe('DUPLICATE_ID');
    expect(i?.message).toBe("part id 'a' is used by more than one part");
  });

  it('OVERLAP names both parts', () => {
    const i = only({ format: 1, name: 't', parts: [{ part: 'core', x: 1, y: 2 }, { part: 'propeller', x: 1, y: 2 }] });
    expect(i?.code).toBe('OVERLAP');
    expect(i?.message).toBe('propeller@1,2 overlaps core@1,2');
  });

  it('BAD_CONTINUATION for a stray =', () => {
    const i = only({ format: 1, name: 't', grid: ['C ='] });
    expect(i?.code).toBe('BAD_CONTINUATION');
    expect(i?.message).toBe("'=' at (1, 0) does not continue a multi-cell part");
  });

  it('NO_CORE is only a warning', () => {
    const r = validateBlueprint({ format: 1, name: 'bomb', grid: ['X'] }, reg);
    expect(r.issues.map((i) => `${i.severity}:${i.code}`)).toEqual(['warning:NO_CORE']);
    expect(r.ok).toBe(true);
    expect(r.issues[0]?.message).toBe('blueprint has no core; it will spawn as debris');
  });

  it('BAD_PRIMARY_CORE', () => {
    const i = only({ format: 1, name: 't', grid: ['C F'], primaryCore: 'frame@1,0' });
    expect(i?.message).toBe("primaryCore 'frame@1,0' is not a core in this blueprint");
  });

  it('UNATTACHED names the faces that touch nothing', () => {
    const issues = issuesOf({ format: 1, name: 't', grid: ['C  .', '.  W'] });
    expect(issues.map((i) => i.code)).toEqual(['UNATTACHED']);
    expect(issues[0]?.message).toBe('wheel@1,0 has no attached face (its mount face N touches nothing)');
    const f = issuesOf({ format: 1, name: 't', grid: ['C . F'] });
    expect(f[0]?.message).toBe('frame@2,0 has no attached face (its faces N, E, S, W touch nothing)');
  });

  it('UNATTACHED reports rotated faces', () => {
    const issues = issuesOf({ format: 1, name: 't', grid: ['C . T>'] });
    expect(issues[0]?.message).toBe('thruster@2,0 has no attached face (its faces N, E, S touch nothing)');
  });

  it('DISCONNECTED lists parts not reachable from the primary core', () => {
    const issues = issuesOf({ format: 1, name: 't', grid: ['C . F F'] });
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'DISCONNECTED',
        message: '2 parts are not connected to the primary core core@0,0: frame@2,0, frame@3,0',
        partId: 'frame@2,0',
      },
    ]);
  });

  it('DISCONNECTED without a core roots at the first part', () => {
    const issues = issuesOf({ format: 1, name: 't', grid: ['F . F F'] });
    expect(issues.map((i) => i.code)).toEqual(['NO_CORE', 'DISCONNECTED']);
    expect(issues[1]?.message).toBe('2 parts are not connected to the first part frame@0,0: frame@2,0, frame@3,0');
  });

  it('binding checks', () => {
    const base = { format: 1, name: 't', grid: ['P C W>'], legend: { P: { part: 'propeller', tags: ['props'] } } };
    const codes = (bindings: unknown[], scripts: unknown[] = []) =>
      issuesOf({ ...base, bindings, scripts }).map((i) => `${i.severity}:${i.code}:${i.message}`);
    expect(codes([{ key: 'a', mode: 'hold', target: 'wheels', channel: 'speed', value: 1 }])).toEqual([
      "error:BAD_TARGET:binding key 'a' targets 'wheels' but no part has that tag or part type",
    ]);
    expect(codes([{ key: 'f', mode: 'toggle', target: 'props', channel: 'speed', value: 1 }])).toEqual([
      "error:BAD_CHANNEL:binding key 'f' writes channel 'speed' on tag 'props' but propeller has no input 'speed'",
    ]);
    expect(codes([{ key: 'h', mode: 'script', script: 'hover' }])).toEqual([
      "error:BAD_SCRIPT_REF:binding key 'h' toggles script 'hover', which is not in scripts",
    ]);
    expect(codes([{ key: 'h', mode: 'script', script: 'hover' }], [{ id: 'hover', source: 'x' }])).toEqual([]);
  });

  it('CHANNEL_SKIPPED warns when some tagged parts lack the channel', () => {
    const r = validateBlueprint(
      {
        format: 1,
        name: 't',
        grid: ['F C P'],
        legend: { F: { part: 'frame', tags: ['lift'] }, P: { part: 'propeller', tags: ['lift'] } },
        bindings: [{ key: 'w', mode: 'hold', target: 'lift', channel: 'throttle', value: 1 }],
      },
      reg,
    );
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.message)).toEqual([
      "binding key 'w' writes channel 'throttle' on tag 'lift'; frame@0,0 has no input 'throttle' and is skipped",
    ]);
  });
});

describe('loadBlueprint and formatIssues', () => {
  it('returns the blueprint and plan when valid', () => {
    expect(loadBlueprint(car, reg).blueprint.parts).toHaveLength(8);
  });

  it('throws BlueprintError carrying the issues', () => {
    try {
      loadBlueprint({ format: 1, name: 't', grid: ['C . F'] }, reg);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BlueprintError);
      expect((e as BlueprintError).issues[0]?.code).toBe('UNATTACHED');
      expect((e as BlueprintError).message).toContain('error UNATTACHED: frame@2,0');
    }
  });

  it('formats one line per issue', () => {
    expect(
      formatIssues([
        { severity: 'warning', code: 'NO_CORE', message: 'x' },
        { severity: 'error', code: 'OVERLAP', message: 'y' },
      ]),
    ).toBe('warning NO_CORE: x\nerror OVERLAP: y');
  });
});
