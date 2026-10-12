/** Where the ear is: the camera (M15). `halfWidth` is half the view's width in meters. */
export interface Ear {
  x: number;
  y: number;
  zoom: number;
  halfWidth: number;
}

/** How a sound at some point reaches the ear. */
export interface Heard {
  /** Meters from the ear, its height above the scene included. */
  distance: number;
  /** 0 to 1. */
  gain: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  /** Lowpass cutoff in Hz: far sounds lose their top. */
  cutoff: number;
  /** Seconds of sim time the sound takes to arrive. */
  delay: number;
}

/** The ear's height over the scene at zoom 1, meters. Zooming out lifts it. */
export const EAR_HEIGHT = 12;
/** The distance at which a sound is half as loud, meters. */
export const HALF_GAIN_AT = 20;
/** The distance at which the lowpass has come down to half of 20 kHz, meters. */
export const DULL_AT = 60;
export const SOUND_SPEED = 343;
/** How far to a side a sound at the screen's edge sits. */
export const PAN_WIDTH = 0.8;

export function hear(ear: Ear, x: number, y: number): Heard {
  const dx = x - ear.x;
  const distance = Math.hypot(dx, y - ear.y, EAR_HEIGHT / ear.zoom);
  return {
    distance,
    gain: HALF_GAIN_AT / (HALF_GAIN_AT + distance),
    pan: Math.max(-1, Math.min(1, ear.halfWidth > 0 ? dx / ear.halfWidth : 0)) * PAN_WIDTH,
    cutoff: 20000 / (1 + distance / DULL_AT),
    delay: distance / SOUND_SPEED,
  };
}
