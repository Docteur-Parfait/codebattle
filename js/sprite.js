import { assets, frames } from './assets.js';
import { TIMING } from './animdata.js';

/** Draw one atlas frame with its anchor at (x, y); facing -1 mirrors it. */
export function drawFrame(ctx, char, f, x, y, facing = 1, scale = 1, alpha = 1, sx = 1, sy = 1) {
  const img = assets.img[`char_${char}`];
  if (!img || !f) return;
  const [fx, fy, w, h, ax, ay] = f;
  ctx.save();
  ctx.globalAlpha = alpha;
  // sub-pixel position: the canvas filters the sprite, so slow moves glide
  // instead of stepping one pixel at a time
  ctx.translate(x, y);
  ctx.scale(facing < 0 ? -sx : sx, sy);
  ctx.drawImage(img, fx, fy, w, h, -ax * scale, -ay * scale, w * scale, h * scale);
  ctx.restore();
}

/**
 * Plays atlas animations for one character. Frames can be held for different
 * lengths (TIMING durs) and loops can ping-pong. `pos` accumulates in frame
 * units, so changing `fps` mid-cycle never makes the animation jump.
 */
// Scratch canvas for cross-fading two frames: both are drawn with
// complementary alpha using additive blending, which on premultiplied pixels is
// an exact mix (no see-through body halfway, no ghost limbs left over).
const MIX_W = 720;
const MIX_H = 600;
const MIX_AX = MIX_W / 2;
const MIX_AY = MIX_H - 60;
let mixCanvas = null;
function mixCtx() {
  if (!mixCanvas) {
    mixCanvas = document.createElement('canvas');
    mixCanvas.width = MIX_W;
    mixCanvas.height = MIX_H;
  }
  return mixCanvas.getContext('2d');
}

const smooth = (t) => t * t * (3 - 2 * t);

export class Animator {
  constructor(char) {
    this.char = char;
    this.name = null;
    this.list = null;
    this.seq = null; // frame indices in play order
    this.durs = null; // hold of each seq entry, in frames
    this.total = 0;
    this.t = 0;
    this.pos = 0;
    this.fps = 10;
    this.loop = true;
    this.blend = false;
    this.phase = Math.random() * Math.PI * 2;
  }

  play(name, { fps = 10, loop = true, restart = false } = {}) {
    if (this.name === name && !restart) return;
    const list = frames(this.char, name);
    if (!list || !list.length) return;
    const tm = TIMING[this.char]?.[name] || {};
    let seq = list.map((_, i) => i);
    if (tm.pingpong && loop && list.length > 2) seq = seq.concat(seq.slice(1, -1).reverse());
    this.name = name;
    this.list = list;
    this.seq = seq;
    this.durs = seq.map((i) => tm.durs?.[i] ?? 1);
    this.total = this.durs.reduce((a, b) => a + b, 0);
    this.fps = fps;
    this.loop = loop;
    this.blend = !!tm.blend && loop;
    this.breathe = tm.breathe || 0;
    this.t = 0;
    this.pos = 0;
  }

  update(dt) { this.t += dt; this.pos += dt * this.fps; }

  /** Current seq slot and how far into its hold we are (0..1). */
  slot() {
    if (!this.seq) return [0, 0];
    let p = this.loop ? this.pos % this.total : Math.min(this.pos, this.total - 1e-6);
    for (let k = 0; k < this.seq.length; k++) {
      if (p < this.durs[k]) return [k, p / this.durs[k]];
      p -= this.durs[k];
    }
    return [this.seq.length - 1, 1];
  }

  get index() { return this.seq ? this.seq[this.slot()[0]] : 0; }

  get done() { return !this.loop && !!this.seq && this.pos >= this.total; }

  get frame() { return this.list ? this.list[this.index] : null; }

  draw(ctx, x, y, facing, scale = 1, alpha = 1, sx = 1, sy = 1) {
    if (!this.list) return;
    if (this.breathe) {
      // slow chest rise anchored at the feet: idles never freeze completely
      const b = Math.sin(this.t * 2.3 + this.phase) * this.breathe;
      sy *= 1 + b;
      sx *= 1 - b * 0.4;
    }
    const [k, f] = this.slot();
    const a = this.list[this.seq[k]];
    // cross-fade into the next pose over the end of each hold
    const t = this.blend ? smooth(Math.max(0, (f - 0.45) / 0.55)) : 0;
    if (t < 0.02) return drawFrame(ctx, this.char, a, x, y, facing, scale, alpha, sx, sy);
    const b = this.list[this.seq[(k + 1) % this.seq.length]];
    if (t > 0.98) return drawFrame(ctx, this.char, b, x, y, facing, scale, alpha, sx, sy);
    const m = mixCtx();
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, MIX_W, MIX_H);
    drawFrame(m, this.char, a, MIX_AX, MIX_AY, 1, scale, 1 - t);
    m.globalCompositeOperation = 'lighter';
    drawFrame(m, this.char, b, MIX_AX, MIX_AY, 1, scale, t);
    m.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(facing < 0 ? -sx : sx, sy);
    ctx.drawImage(mixCanvas, -MIX_AX, -MIX_AY);
    ctx.restore();
  }
}

export function hasAnim(char, name) {
  return !!assets.atlas[char]?.anims[name];
}
