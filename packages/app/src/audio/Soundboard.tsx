import { render, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AudioEngine } from './AudioEngine';
import { hear } from './listener';
import { loopGain } from './loopLevels';
import { LOOP_VOICES, placeLoop, startLoop, stopLoop, type Placed } from './loops';
import { ONE_SHOTS } from './oneShots';
import { PIXELS_PER_METER } from '../render/units';

interface LoopState {
  on: boolean;
  level: number;
  parts: number;
  grip: boolean;
}

const START: LoopState = { on: false, level: 0.6, parts: 4, grip: true };

/**
 * `?soundboard` (M15): every sound on a button, with the ear's distance and the camera's zoom on sliders, to tune by
 * ear without setting up a fight. The recipes are in `oneShots.ts` and `loops.ts`; save one and the page reloads.
 */
function Soundboard() {
  const [engine, setEngine] = useState<AudioEngine | undefined>(undefined);
  const [distance, setDistance] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [volume, setVolume] = useState(0.7);
  const [delay, setDelay] = useState(true);
  const [loops, setLoops] = useState<Record<string, LoopState>>({});
  const [peak, setPeak] = useState(0);
  const live = useRef(new Map<string, Placed>());

  // 1920 px of view, as the game's camera would show at this zoom; the source sits `distance` to the right.
  const heard = hear({ x: 0, y: 0, zoom, halfWidth: 960 / (zoom * PIXELS_PER_METER) }, distance, 0);

  const wake = (): AudioEngine => {
    if (engine) return engine;
    const made = new AudioEngine(new AudioContext());
    made.setVolume(volume, false);
    setEngine(made);
    return made;
  };

  useEffect(() => {
    engine?.setVolume(volume, false);
  }, [engine, volume]);

  useEffect(() => {
    if (!engine) return;
    let held = 0;
    const id = setInterval(() => {
      held = Math.max(engine.peak(), held * 0.9);
      setPeak(held);
    }, 50);
    return () => clearInterval(id);
  }, [engine]);

  // The loops follow the sliders.
  useEffect(() => {
    if (!engine) return;
    for (const name of Object.keys(LOOP_VOICES)) {
      const st = loops[name];
      let p = live.current.get(name);
      if (!st?.on) {
        if (p) stopLoop(p, engine.now);
        live.current.delete(name);
        continue;
      }
      if (!p) {
        p = startLoop(engine, name, 1);
        if (!p) continue;
        live.current.set(name, p);
      }
      placeLoop(p, heard, loopGain(st.level * st.parts), engine.now);
      p.voice.set(st.level, st.grip ? 1 : 0, engine.now);
    }
  });

  // The crackle flickers by being set again and again, as the game does 20 times a second.
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => live.current.get('laser.burn')?.voice.set(1, 0, engine.now), 50);
    return () => clearInterval(id);
  }, [engine]);

  const play = (name: string, variant?: number): void => {
    const e = wake();
    const go = (): void => e.play(name, heard, 0.8, delay ? heard.delay : 0, 1, variant);
    // The very first click also renders the sounds: wait for them.
    if (e.ready) go();
    else setTimeout(go, 300);
  };

  const setLoop = (name: string, next: Partial<LoopState>): void => {
    wake();
    setLoops({ ...loops, [name]: { ...(loops[name] ?? START), ...next } });
  };

  const row = { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0', flexWrap: 'wrap' } as const;
  const label = { width: '150px', font: '12px ui-monospace, Menlo, monospace' } as const;

  return (
    <div class="panel" style={{ pointerEvents: 'auto', position: 'absolute', inset: '0', overflow: 'auto', padding: '16px 24px', color: '#d8dee9' }}>
      <h2 style={{ margin: '0 0 4px' }}>Soundboard</h2>
      <div style={{ color: 'var(--muted)', marginBottom: '10px' }}>
        Every sound is made in the browser: recipes in <code>packages/app/src/audio/oneShots.ts</code> and <code>loops.ts</code>. Sound starts with your first click.
      </div>
      <div style={row}>
        <span style={label}>Distance {distance} m</span>
        <input type="range" min="0" max="800" step="5" value={distance} style={{ width: '300px' }} onInput={(e) => setDistance(Number((e.target as HTMLInputElement).value))} />
        <span style={label}>Zoom {zoom.toFixed(2)}</span>
        <input type="range" min="0.05" max="4" step="0.05" value={zoom} style={{ width: '200px' }} onInput={(e) => setZoom(Number((e.target as HTMLInputElement).value))} />
      </div>
      <div style={row}>
        <span style={label}>Volume {volume.toFixed(2)}</span>
        <input type="range" min="0" max="1" step="0.05" value={volume} style={{ width: '300px' }} onInput={(e) => setVolume(Number((e.target as HTMLInputElement).value))} />
        <label>
          <input type="checkbox" checked={delay} onChange={() => setDelay(!delay)} /> Sound delay ({heard.delay.toFixed(2)} s here)
        </label>
        <span style={{ font: '12px ui-monospace, Menlo, monospace', color: peak >= 1 ? 'var(--warning)' : 'var(--muted)' }}>
          heard at gain {heard.gain.toFixed(3)}, top cut at {Math.round(heard.cutoff)} Hz, output peak {peak.toFixed(2)}
        </span>
      </div>
      <h3 style={{ margin: '14px 0 4px' }}>One-shots</h3>
      {Object.entries(ONE_SHOTS).map(([name, shot]) => (
        <div style={row} key={name}>
          <span style={label}>{name}</span>
          <button onClick={() => play(name)}>Play</button>
          {Array.from({ length: shot.variants }, (_, v) => (
            <button key={v} onClick={() => play(name, v)} title={`take ${v + 1}`}>
              {v + 1}
            </button>
          ))}
        </div>
      ))}
      <h3 style={{ margin: '14px 0 4px' }}>Loops</h3>
      {Object.keys(LOOP_VOICES).map((name) => {
        const st = loops[name] ?? START;
        return (
          <div style={row} key={name}>
            <span style={label}>{name}</span>
            <button class={st.on ? 'on' : ''} onClick={() => setLoop(name, { on: !st.on })}>
              {st.on ? 'Stop' : 'Run'}
            </button>
            <span>level {st.level.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.01" value={st.level} style={{ width: '200px' }} onInput={(e) => setLoop(name, { level: Number((e.target as HTMLInputElement).value) })} />
            <span>parts {st.parts}</span>
            <input type="range" min="1" max="800" step="1" value={st.parts} style={{ width: '200px' }} onInput={(e) => setLoop(name, { parts: Number((e.target as HTMLInputElement).value) })} />
            {name === 'wheel' && (
              <label>
                <input type="checkbox" checked={st.grip} onChange={() => setLoop(name, { grip: !st.grip })} /> on the ground
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function mountSoundboard(el: HTMLElement): void {
  render(h(Soundboard, {}), el);
}
