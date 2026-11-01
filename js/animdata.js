// How long each frame of an animation is held, as a multiple of 1/fps, and
// whether the loop plays back and forth (idles with few frames breathe instead
// of snapping back to frame 0). Attacks hold the impact pose and ease out of it,
// the way hand-made fighting game animations are timed.
// blend: cross-fade between neighbouring frames (only for slow, close poses
// like idles, where the AI sheets have too few in-betweens).
// breathe: amplitude of a slow vertical scale pulse.

export const TIMING = {
  parfait: {
    idle: { pingpong: true, blend: true, breathe: 0.006 },
    jab: { durs: [0.8, 1, 1, 2.4, 1.4] },
    cross: { durs: [0.8, 1, 1, 2.2, 1.4, 1.2] },
    uppercut: { durs: [1, 1, 1, 2.4, 1.3, 1] },
    kick: { durs: [0.8, 1, 1.4, 2, 1.4] },
    roundhouse: { durs: [0.8, 1, 1, 1, 2.2, 1.4, 1, 1] },
    sweep: { durs: [1, 1, 1.4, 2.2, 1.2, 1] },
    blast: { durs: [1, 1.2, 1.4, 1, 1.2, 2.2, 1.4] },
    takedown: { durs: [1, 1, 1, 1.6, 1.2, 1.4, 1.4] },
    hit: { durs: [0.8, 1, 1, 1.4] },
    open_chest: { durs: [1.4, 1, 1, 1.6, 1.6, 2.4] },
    open_great: { durs: [3, 4] },
    raise_treasure: { durs: [2.2, 1] },
    counter: { durs: [0.8, 0.8, 1.6, 1, 1, 2.2, 1.4, 1.2] },
    air_assassination: { durs: [1, 1, 1, 1, 2, 2.4, 1.2, 1.2] },
    land_heavy: { durs: [1.8, 1.2, 1, 1] },
    ledge_hang: { pingpong: true, blend: true },
    charge: { durs: [1, 1, 1, 1, 1.4, 1.4] },
    get_up: { durs: [1.6, 1, 1] },
  },
  guard: {
    idle: { pingpong: true, blend: true, breathe: 0.008 },
    alert: { durs: [1, 1, 2] },
    attack: { durs: [1, 1.6, 1, 0.7, 1.8, 1, 1, 1.2] },
  },
  sniper: {
    idle: { pingpong: true, blend: true, breathe: 0.004 },
    shoot: { durs: [1, 1, 1.4, 0.8, 1.6, 1, 1.2] },
  },
  drone: {
    hover: { blend: true },
    laser: { durs: [2.5, 2] },
  },
  brute: {
    idle: { pingpong: true, blend: true, breathe: 0.004 },
    block: { pingpong: true, blend: true },
    slam: { durs: [1.2, 1.6, 0.8, 1.6, 1.4, 1, 1.2] },
    bash: { durs: [1.4, 1, 1, 1, 1.2] },
  },
  kernel: {
    idle: { pingpong: true, blend: true, breathe: 0.004 },
    runes: { durs: [1, 1, 1.4, 1.4, 2] },
    combo: { durs: [1.2, 1, 1, 1, 1, 1.2, 1.4] },
  },
};
