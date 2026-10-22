import { teamTint } from '../render/teamTint';
import { teamName } from './deploySettings';

/**
 * What the left panel shows about the robot the camera follows, any robot, an enemy included (Logan, 2026-10-22: click
 * any robot to see where it is, how fast it goes, its energy and its script log; an enemy is only watched, never
 * driven). Rounded so the view changes only when a shown number does.
 */
export interface InspectView {
  name: string;
  team: number;
  /** "Yours", "Enemy", "Blue", as the toolbar says them. */
  teamName: string;
  /** The team's tint as a CSS color, the color its robots are drawn in. */
  color: string;
  /** Whether you drive it. False: you only watch it (an enemy, or one of yours without a live core). */
  driving: boolean;
  /** Its core (or the middle of a piece with none), meters, to a tenth. */
  x: number;
  y: number;
  /** Meters a second, to a tenth. */
  speed: number;
  /** Its energy in whole units, when it has a store. */
  energy?: { stored: number; capacity: number };
  parts: number;
  massKg: number;
}

export interface InspectSource {
  name: string;
  team: number;
  driving: boolean;
  x: number;
  y: number;
  speed: number;
  energy?: { stored: number; capacity: number };
  parts: number;
  massKg: number;
}

const tenth = (v: number): number => Math.round(v * 10) / 10;

export function buildInspect(src: InspectSource): InspectView {
  return {
    name: src.name,
    team: src.team,
    teamName: teamName(src.team),
    color: `#${teamTint(src.team).toString(16).padStart(6, '0')}`,
    driving: src.driving,
    x: tenth(src.x),
    y: tenth(src.y),
    speed: tenth(src.speed),
    ...(src.energy ? { energy: { stored: Math.floor(src.energy.stored), capacity: Math.round(src.energy.capacity) } } : {}),
    parts: src.parts,
    massKg: Math.round(src.massKg),
  };
}

/** "x 412.3  y 6.1 m". */
export function positionText(v: { x: number; y: number }): string {
  return `x ${v.x.toFixed(1)}  y ${v.y.toFixed(1)} m`;
}

/** "23.4 m/s". */
export function velocityText(v: { speed: number }): string {
  return `${v.speed.toFixed(1)} m/s`;
}

/** "840 kg", "12.4 t". */
export function massText(kg: number): string {
  return kg < 10_000 ? `${kg} kg` : `${(kg / 1000).toFixed(1)} t`;
}

/** "2,480 of 4,000", "none" for a store of nothing. */
export function energyText(e: { stored: number; capacity: number }, unlimited: boolean): string {
  if (unlimited) return 'no limit';
  const n = (v: number): string => v.toLocaleString('en-US');
  return e.capacity === 0 ? 'none' : `${n(e.stored)} of ${n(e.capacity)}`;
}
