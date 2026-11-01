import { Animator, hasAnim } from './sprite.js';
import { input } from './input.js';
import { GROUND_Y } from './level.js';

export const GRAVITY = 2600;
// open_chest frames: drawn at this scale, their chest sits CHEST_DX right of the feet
export const CHEST_SCALE = 1.25;
export const CHEST_DX = 36;

export const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* ------------------------------------------------------------------ */
/* Base actor: (x, y) is the middle of the feet. Body box is w x h.     */
/* ------------------------------------------------------------------ */
class Actor {
  constructor(char, x, y, w, h) {
    this.anim = new Animator(char);
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.flying = false;
    this.dead = false;
    this.remove = false;
    this.flash = 0;
    this.invuln = 0;
  }

  get body() { return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h }; }

  /** Box in front of the actor, used for melee hits. */
  reach(dist, height = 70, up = 0.62) {
    const top = this.y - this.h * up - height / 2;
    return this.facing > 0
      ? { x: this.x, y: top, w: dist, h: height }
      : { x: this.x - dist, y: top, w: dist, h: height };
  }

  /** Soft contact shadow on the ground under the actor. */
  drawShadow(ctx, width, alpha = 1) {
    if (this.onGround) this.groundY = this.y;
    const gy = this.groundY ?? this.y;
    const lift = Math.max(0, Math.min(1, (gy - this.y) / 300));
    const w = width * (1 - lift * 0.5);
    ctx.save();
    ctx.globalAlpha = 0.38 * (1 - lift * 0.6) * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, gy + 2, w / 2, w * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  draw(ctx, scale = this.kneelingAtChest ? CHEST_SCALE : 1) {
    this.drawShadow(ctx, 96);
    let alpha = 1;
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) alpha = 0.45;
    // squash (landing) / stretch (takeoff), anchored at the feet
    const q = this.squash || 0;
    const sx = 1 + q * 0.5;
    const sy = 1 - q;
    this.anim.draw(ctx, this.x, this.y + 4, this.facing, scale, alpha, sx, sy);
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.anim.draw(ctx, this.x, this.y + 4, this.facing, scale, this.flash * 0.6, sx, sy);
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Parfait                                                             */
/* ------------------------------------------------------------------ */
const ATTACKS = {
  // hit: frames that can connect; lunge: step forward as the blow lands
  jab: { fps: 18, hit: [2, 3], dmg: 9, reach: 95, knock: 160, lunge: 150, next: 'cross', key: 'punch' },
  cross: { fps: 16, hit: [2, 3], dmg: 14, reach: 120, knock: 320, lunge: 220, next: 'uppercut', key: 'punch' },
  uppercut: { fps: 14, hit: [2, 3], dmg: 20, reach: 100, knock: 260, launch: 620, lunge: 120, key: 'punch' },
  kick: { fps: 16, hit: [2, 3], dmg: 12, reach: 125, knock: 220, lunge: 170, next: 'roundhouse', key: 'kick' },
  roundhouse: { fps: 17, hit: [3, 5], dmg: 22, reach: 150, knock: 420, lunge: 200, key: 'kick' },
  sweep: { fps: 15, hit: [2, 3], dmg: 12, reach: 140, knock: 140, lunge: 100, low: true, key: 'kick' },
  blast: { fps: 13, spawnAt: 5, energy: 30 },
  takedown: { fps: 12, finisher: true },
  // right after a blocked hit: parry, sidestep, heavy punch (goes through guards)
  counter: { fps: 16, hit: [5, 6], dmg: 30, reach: 140, knock: 460, lunge: 200, pierce: true },
  air_assassination: { fps: 12 },
};
// sliding into an enemy trips it up
const SLIDE_HIT = { dmg: 8, knock: 260, launch: 380 };

export class Player extends Actor {
  constructor(x, y) {
    super('parfait', x, y, 54, 160);
    this.maxHp = 100;
    this.hp = 100;
    this.maxEnergy = 100;
    this.energy = 60;
    this.state = 'normal';
    this.attack = null;
    this.queued = null;
    this.hitTargets = new Set();
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.sneaking = false;
    this.blocking = false;
    this.lastSafe = { x, y };
    this.peakY = y;
    this.rollCool = 0;
    this.prevIx = 0;
    this.counterT = 0; // window to counter after a blocked hit
    this.ledgeCool = 0;
    this.wallCool = 0;
    this.wallJumpT = 0;
    this.anim.play('idle', { fps: 7 });
  }

  /** Back to free movement from any special state. */
  toNormal() {
    this.state = 'normal';
    this.attack = null;
    this.flying = false;
    this.h = 160;
    this.peakY = this.y;
    this.wasOnGround = this.onGround;
  }

  // dodges and finishers can't be interrupted
  get untouchable() {
    return this.state === 'roll' || this.state === 'knocked' || this.state === 'climbup'
      || (this.state === 'dash' && this.anim.index < 2)
      || (this.state === 'attack' && (this.attack === 'counter' || this.attack === 'air_assassination'));
  }

  startAttack(name, game) {
    const a = ATTACKS[name];
    if (a.energy) {
      if (this.energy < a.energy) { game.toast('Énergie insuffisante'); return; }
      this.energy -= a.energy;
    }
    this.state = 'attack';
    this.attack = name;
    this.queued = null;
    if (name !== 'blast') game.sfx('whoosh', undefined, { rate: name === 'kick' || name === 'sweep' ? 0.8 : 1.1 });
    this.hitTargets.clear();
    this.spawned = false;
    this.lunged = false;
    // attacking while holding a direction turns Parfait around first
    if (input.x) this.facing = input.x > 0 ? 1 : -1;
    this.anim.play(name, { fps: a.fps, loop: false, restart: true });
    if (this.onGround) this.vx *= 0.3;
  }

  hurt(dmg, fromX, game, knock = 280) {
    if (this.invuln > 0 || this.state === 'dead' || this.state === 'chest' || this.untouchable) return;
    dmg = Math.max(1, Math.round(dmg * game.diff.dmg));
    if (this.blocking && this.state === 'normal' && Math.sign(fromX - this.x) === this.facing) {
      dmg = Math.ceil(dmg * 0.15);
      this.vx = -this.facing * 160;
      game.spark(this.x + this.facing * 40, this.y - 110, 0.7);
      game.sfx('block');
      this.hp -= dmg;
      this.counterT = 0.6;
      if (!game.counterHint) {
        game.counterHint = true;
        game.toast('Parade ! Frappe (J) tout de suite pour contre-attaquer');
      }
      return;
    }
    this.flying = false;
    this.h = 160;
    this.hp -= dmg;
    this.flash = 0.25;
    this.invuln = 0.9;
    this.vx = Math.sign(this.x - fromX || 1) * knock;
    this.vy = -260;
    this.sneaking = false;
    game.shake(8);
    game.sfx('hit', undefined, { vol: 0.8 });
    game.sfx('hurt');
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead';
      this.anim.play('ko', { fps: 9, loop: false });
      game.onPlayerDeath();
    } else if (knock >= 420) {
      // thrown to the floor: falls, stays down a moment, gets up
      this.state = 'knocked';
      this.downT = 0;
      this.vy = -380;
      this.anim.play('ko', { fps: 12, loop: false, restart: true });
    } else {
      this.state = 'hurt';
      this.hurtTime = 0.35;
      this.anim.play('hit', { fps: 12, loop: false, restart: true });
    }
  }

  update(dt, game) {
    this.anim.update(dt);
    this.flash = Math.max(0, this.flash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 2.5);
    this.squash = (this.squash || 0) * Math.exp(-dt * 12);
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    this.jumpBuffer = input.pressed('jump') ? 0.12 : this.jumpBuffer - dt;
    this.rollCool -= dt;
    this.counterT -= dt;
    this.ledgeCool -= dt;
    this.wallCool -= dt;
    this.wallJumpT -= dt;
    if (input.pressed('stealth')) {
      this.sneaking = !this.sneaking;
      game.toast(this.sneaking ? 'Mode furtif' : 'Mode normal');
    }

    switch (this.state) {
      case 'dead':
        this.vx *= Math.exp(-dt * 6);
        return;
      case 'chest':
      case 'victory':
        this.vx = 0;
        if (this.anim.done && this.anim.name.startsWith('open_')) this.anim.play('raise_treasure', { fps: 3, loop: false });
        return;
      case 'hurt':
        this.hurtTime -= dt;
        this.vx *= Math.exp(-dt * 5);
        if (this.hurtTime <= 0) this.toNormal();
        return;
      case 'attack':
        this.updateAttack(dt, game);
        return;
      case 'roll':
      case 'dash':
        this.vx *= Math.exp(-dt * (this.state === 'roll' ? 1.2 : 5));
        if (this.anim.done) { this.toNormal(); this.rollCool = 0.25; }
        return;
      case 'land':
        this.vx *= Math.exp(-dt * 10);
        if (this.anim.done || (this.anim.index >= 2 && this.jumpBuffer > 0)) this.toNormal();
        return;
      case 'slide':
        this.vx *= Math.exp(-dt * 2.2);
        if (this.anim.index <= 1) game.meleeHit(this, this.reach(80, 50, 0.2), SLIDE_HIT);
        if (this.anim.done) this.toNormal();
        return;
      case 'charge':
        this.vx *= Math.exp(-dt * 10);
        this.energy = Math.min(this.maxEnergy, this.energy + dt * 35);
        if (!input.down('special') || this.energy >= this.maxEnergy) this.toNormal();
        return;
      case 'knocked':
        this.updateKnocked(dt);
        return;
      case 'wall':
        this.updateWall(dt, game);
        return;
      case 'ledge':
        this.updateLedge(dt, game);
        return;
      case 'climbup':
        this.updateClimbUp(dt);
        return;
      default:
        this.updateNormal(dt, game);
    }
  }

  updateNormal(dt, game) {
    const ix = input.x;
    const crouch = input.y > 0.5 && this.onGround;
    this.blocking = input.down('block') && this.onGround;
    const speed = this.sneaking ? 170 : 380;

    // ↓ at full run: slide (low, trips enemies up)
    const slide = crouch && !this.prevCrouch && Math.abs(this.vx) > 300;
    this.prevCrouch = crouch;
    if (slide) return this.startSlide(game);
    // guard while running: forward roll; while guarding, tap away: backstep
    const away = Math.abs(ix) > 0.6 && Math.sign(ix) === -this.facing;
    const wasAway = Math.abs(this.prevIx) > 0.6 && Math.sign(this.prevIx) === -this.facing;
    this.prevIx = ix;
    if (this.onGround && this.rollCool <= 0) {
      const dir = Math.sign(ix);
      if (input.pressed('block') && Math.abs(ix) > 0.3 && Math.abs(this.vx) > 150 && Math.sign(this.vx) === dir) return this.startRoll(dir, game);
      if (this.blocking && away && !wasAway) return this.startDash(game);
    }

    if (this.blocking || crouch) {
      this.vx *= 0.7;
    } else if (!(this.wallJumpT > 0 && ix === 0)) { // a wall jump keeps its push-off
      const target = ix * speed;
      this.vx += (target - this.vx) * Math.min(1, dt * (this.onGround ? 14 : this.wallJumpT > 0 ? 2 : 6));
    }
    if (ix !== 0 && !this.blocking) this.facing = ix > 0 ? 1 : -1;

    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.blocking) {
      this.vy = -1020;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.squash = -0.1;
      game.dust(this.x, this.y);
      game.sfx('jump', undefined, { vol: 0.7 });
    }
    if (!input.down('jump') && this.vy < -400 && this.wallJumpT <= 0) this.vy += GRAVITY * dt * 1.2; // short hop

    // Parkour: walls too high to jump are climbed; falling past an edge grabs it
    if (ix !== 0 && this.wallCool <= 0) {
      const dir = Math.sign(ix);
      const wall = game.wallAt(this, dir);
      const run = this.onGround && this.anim.name === 'run';
      if (wall && (run || (this.onGround ? input.y < -0.5 : this.vy > -300))) return this.grabWall(wall, dir, run, game);
    }
    if (!this.onGround && this.vy > 0 && this.ledgeCool <= 0 && input.y < 0.5) {
      const edge = game.ledgeAt(this);
      if (edge) return this.grabLedge(edge, game);
    }

    // Actions
    if (input.pressed('interact') && game.tryInteract(this)) return;
    if (input.pressed('punch')) {
      if (this.counterT > 0 && this.onGround) { this.counterT = 0; this.startAttack('counter', game); return; }
      if (!this.onGround) {
        const below = game.airTarget(this);
        if (below) { this.startAirKill(below, game); return; }
      }
      const t = game.takedownTarget(this);
      if (t) { this.doTakedown(t, game); return; }
      this.startAttack('jab', game);
      return;
    }
    if (input.pressed('kick')) { this.startAttack(crouch ? 'sweep' : 'kick', game); return; }
    if (input.pressed('special')) {
      // out of energy: hold L to focus and charge it back
      if (this.energy < ATTACKS.blast.energy && this.onGround) return this.startCharge(game);
      this.startAttack('blast', game);
      return;
    }

    // Animation
    const a = this.anim;
    const vel = Math.abs(this.vx);
    if (this.onGround && !this.wasOnGround) {
      const drop = this.y - this.peakY;
      if (drop > 330) return this.heavyLanding(ix, game);
      if (this.airTime > 0.25) {
        this.landTime = 0.12;
        this.squash = Math.min(0.14, 0.05 + this.airTime * 0.12);
        game.dust(this.x, this.y);
        game.sfx('land', undefined, { vol: Math.min(1, 0.4 + this.airTime) });
      }
    }
    this.peakY = this.onGround ? this.y : Math.min(this.peakY, this.y);
    this.wasOnGround = this.onGround;
    this.airTime = this.onGround ? 0 : (this.airTime || 0) + dt;
    this.landTime = Math.max(0, (this.landTime || 0) - dt);
    if (!this.onGround) {
      // the takeoff pose only once airborne for a moment, so small hops
      // off a ledge don't flash a jump pose
      if (this.wallJumpT > 0) a.play('wall_jump', { fps: 10, loop: false });
      else if (this.vy < -200) a.play('run_jump', { fps: 9, loop: false });
      else if (this.airTime > 0.12 || this.vy > 300) a.play('fall_loop', { fps: 9 });
    } else if (this.landTime > 0 && vel < 120) {
      a.play('land', { fps: 8, loop: false });
    } else if (this.blocking) {
      a.play(crouch ? 'crouch_block' : 'block', { fps: 8, loop: false });
    } else if (crouch) {
      a.play('crouch', { fps: 6, loop: false });
    } else if (vel > 40) {
      // frame rate follows the speed so the feet don't slide
      // run above 260, back to walk under 200: no flicker around one speed
      const running = a.name === 'run' ? vel > 200 : vel > 260;
      if (this.sneaking) { a.play('sneak'); a.fps = 4 + vel / 22; }
      // 8-frame cycles = 2 steps: ~270 px per run cycle, ~170 px per walk cycle
      else if (running) { a.play('run'); a.fps = Math.max(8, vel / 33); }
      else { a.play('walk'); a.fps = Math.max(5, vel / 21); }
    } else {
      a.play(this.sneaking ? 'crouch' : 'idle', { fps: 7, loop: !this.sneaking });
    }
    // a footstep on each contact frame (the 8-frame cycles hold two steps)
    const stepping = this.onGround && (a.name === 'run' || a.name === 'walk' || a.name === 'sneak');
    const idx = a.index;
    if (stepping && idx !== this.stepIdx && idx % 4 === 0) {
      const vol = { run: 0.55, walk: 0.38, sneak: 0.12 }[a.name];
      game.sfx('step', undefined, { vol, rate: a.name === 'run' ? 1.08 : 0.94 });
    }
    this.stepIdx = stepping ? idx : -1;
  }

  updateAttack(dt, game) {
    if (this.attack === 'air_assassination') return this.updateAirKill(dt, game);
    const def = ATTACKS[this.attack];
    const i = this.anim.index;
    this.vx *= Math.exp(-dt * (this.onGround ? 9 : 0.3));
    if (def.key && input.pressed(def.key)) this.queued = def.next || null;
    if (def.lunge && !this.lunged && def.hit && i >= def.hit[0]) {
      this.lunged = true;
      if (this.onGround) this.vx = this.facing * def.lunge;
    }

    if (def.hit && i >= def.hit[0] && i <= def.hit[1]) {
      const box = def.low ? this.reach(def.reach, 60, 0.15) : this.reach(def.reach);
      game.meleeHit(this, box, def);
    }
    if (def.spawnAt !== undefined && !this.spawned && i >= def.spawnAt) {
      this.spawned = true;
      game.spawnBlast(this.x + this.facing * 90, this.y - 110, this.facing);
    }
    if (this.anim.done) {
      if (this.attack === 'takedown') this.sneaking = true;
      const next = this.queued;
      this.toNormal();
      if (next) this.startAttack(next, game);
    }
  }

  /* ---------- parkour and evasion ---------- */

  startRoll(dir, game) {
    this.state = 'roll';
    this.facing = dir;
    this.vx = dir * Math.max(560, Math.abs(this.vx));
    this.h = 100;
    this.anim.play('roll', { fps: 18, loop: false, restart: true });
    game.sfx('whoosh', undefined, { rate: 0.7 });
    game.dust(this.x, this.y);
  }

  startDash(game) {
    this.state = 'dash';
    this.vx = -this.facing * 520;
    this.anim.play('dash_back', { fps: 14, loop: false, restart: true });
    game.sfx('whoosh', undefined, { rate: 1.3 });
  }

  startSlide(game) {
    this.state = 'slide';
    this.h = 80;
    this.vx = this.facing * Math.max(560, Math.abs(this.vx) * 1.3);
    this.hitTargets.clear();
    this.anim.play('slide', { fps: 9, loop: false, restart: true });
    game.sfx('whoosh', undefined, { rate: 0.6 });
    game.dust(this.x, this.y);
  }

  startCharge(game) {
    this.state = 'charge';
    this.anim.play('charge', { fps: 8, loop: false, restart: true });
    game.sfx('blast', undefined, { vol: 0.35, rate: 0.6 });
    if (!game.chargeHint) {
      game.chargeHint = true;
      game.toast('Plus d\'énergie : maintiens L pour te concentrer et la recharger');
    }
  }

  /** Big drop: roll out of it when running, otherwise a heavy crouching landing. */
  heavyLanding(ix, game) {
    game.dust(this.x, this.y);
    game.shake(6);
    game.sfx('land', undefined, { vol: 1 });
    if (Math.abs(this.vx) > 220 && Math.sign(ix) === Math.sign(this.vx)) return this.startRoll(Math.sign(this.vx), game);
    this.state = 'land';
    this.vx *= 0.2;
    this.anim.play('land_heavy', { fps: 11, loop: false, restart: true });
  }

  updateKnocked(dt) {
    this.vx *= Math.exp(-dt * (this.onGround ? 6 : 1));
    if (this.anim.name === 'ko' && this.anim.done && this.onGround) {
      this.downT += dt;
      if (this.downT > 0.45) this.anim.play('get_up', { fps: 6, loop: false, restart: true });
    } else if (this.anim.name === 'get_up' && this.anim.done) {
      this.toNormal();
      this.invuln = 0.6;
    }
  }

  grabWall(wall, dir, run, game) {
    this.state = 'wall';
    this.wall = wall;
    this.facing = dir;
    this.flying = true;
    this.vx = 0;
    // running into it carries Parfait a few steps up the wall
    this.wallRunT = run ? 0.32 : 0;
    this.vy = run ? -560 : 0;
    this.anim.play('climb', { fps: run ? 16 : 9, restart: true });
    game.sfx('step', undefined, { vol: 0.5 });
  }

  updateWall(dt, game) {
    const dir = this.facing;
    const toward = input.x * dir;
    this.vx = 0;
    if (this.jumpBuffer > 0) {
      // wall jump: kick off backwards
      this.jumpBuffer = 0;
      this.toNormal();
      this.facing = -dir;
      this.vx = -dir * 470;
      this.vy = -960;
      this.wallJumpT = 0.45;
      this.wallCool = 0.3;
      this.anim.play('wall_jump', { fps: 10, loop: false, restart: true });
      game.sfx('jump', undefined, { vol: 0.7 });
      game.dust(this.x + dir * 20, this.y - 40);
      return;
    }
    if (input.y > 0.5 || toward < -0.5) {
      this.toNormal();
      this.vx = -dir * 120;
      this.wallCool = 0.35;
      return;
    }
    if (this.wallRunT > 0) {
      this.wallRunT -= dt;
      if (this.wallRunT <= 0) this.anim.fps = 9;
    } else {
      const up = input.y < -0.3 || toward > 0.3;
      this.vy = up ? -190 : 0;
      this.anim.fps = up ? 9 : 0;
    }
    // hands over the top: pull up onto it
    if (this.y - 190 <= this.wall.y) this.startClimbUp(this.wall.y, dir > 0 ? this.wall.x : this.wall.x + this.wall.w);
  }

  grabLedge({ s, edgeX, dir }, game) {
    this.state = 'ledge';
    this.flying = true;
    this.vx = this.vy = 0;
    this.facing = dir;
    this.ledge = { y: s.y, edgeX };
    this.hangT = 0;
    this.anim.play('ledge_hang', { fps: 3, restart: true });
    // the hang frames have the fists at the top: hang them on the edge
    this.x = edgeX - dir * 22;
    this.y = s.y + (this.anim.frame?.[3] ?? 230) - 14;
    game.sfx('step', undefined, { vol: 0.6 });
  }

  updateLedge(dt) {
    this.hangT += dt;
    if (this.hangT < 0.25) return;
    const toward = input.x * this.facing;
    if (input.y < -0.3 || toward > 0.3 || this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.startClimbUp(this.ledge.y, this.ledge.edgeX);
    } else if (input.y > 0.5 || toward < -0.5) {
      this.toNormal();
      this.ledgeCool = 0.4;
    }
  }

  startClimbUp(topY, edgeX) {
    this.state = 'climbup';
    this.flying = true;
    this.vx = this.vy = 0;
    this.climb = { x0: this.x, y0: this.y, x1: edgeX + this.facing * 34, y1: topY, t: 0 };
    this.anim.play('climb', { fps: 18, restart: true });
  }

  updateClimbUp(dt) {
    const c = this.climb;
    c.t += dt;
    const k = Math.min(1, c.t / 0.42);
    const e = k * k * (3 - 2 * k);
    this.y = c.y0 + (c.y1 - c.y0) * e;
    // over the edge only once the body is up
    this.x = c.x0 + (c.x1 - c.x0) * Math.max(0, (e - 0.55) / 0.45);
    if (k < 1) return;
    this.onGround = true;
    this.toNormal();
    this.state = 'land';
    this.anim.play('land_heavy', { fps: 12, loop: false, restart: true });
    this.anim.pos = 1;
  }

  /** Dive onto an enemy below and finish it with a code-charged punch. */
  startAirKill(target, game) {
    this.state = 'attack';
    this.attack = 'air_assassination';
    this.airTarget = target;
    this.struck = false;
    this.diveT = 0;
    this.facing = target.x >= this.x ? 1 : -1;
    const vy0 = 900;
    const dy = Math.max(10, target.y - this.y);
    const t = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * dy)) / GRAVITY;
    this.vy = vy0;
    this.vx = Math.max(-1000, Math.min(1000, (target.x - this.facing * 60 - this.x) / Math.max(0.12, t)));
    this.anim.play('air_assassination', { fps: 12, loop: false, restart: true });
    game.sfx('whoosh', undefined, { rate: 0.8 });
  }

  updateAirKill(dt, game) {
    const a = this.anim;
    if (!this.struck) {
      this.diveT += dt;
      a.fps = a.index >= 2 ? 0 : 12; // hold the dive pose until the ground
      if (!this.onGround) {
        if (this.diveT > 1.2) this.toNormal();
        return;
      }
      this.struck = true;
      this.vx = 0;
      a.pos = 3;
      a.fps = 13;
      const t = this.airTarget;
      game.shake(12);
      game.dust(this.x, this.y);
      game.spark(this.x + this.facing * 50, this.y - 20, 2);
      game.sfx('stomp', undefined, { vol: 0.9 });
      game.sfx('takedown');
      if (t && t.state !== 'dying' && Math.abs(t.x - this.x) < 150 && Math.abs(t.y - this.y) < 60) {
        if (t.isBoss) t.hurt(45, this.x, game, 0, 0, true);
        else { t.flash = 0.3; t.takenDown(game); }
      }
      for (const e of game.enemies) {
        if (e !== t && e.state !== 'dying' && !e.flying && Math.abs(e.x - this.x) < 170 && Math.abs(e.y - this.y) < 60) e.hurt(12, this.x, game, 380, 300);
      }
      return;
    }
    this.vx *= Math.exp(-dt * 10);
    if (a.done) this.toNormal();
  }

  doTakedown(enemy, game) {
    this.state = 'attack';
    this.attack = 'takedown';
    this.facing = enemy.x > this.x ? 1 : -1;
    this.anim.play('takedown', { fps: 12, loop: false, restart: true });
    game.sfx('whoosh');
    setTimeout(() => game.sfx('takedown'), 250);
    enemy.takenDown(game);
  }

  // open_chest's middle frames draw their own chest, so Parfait kneels where
  // that chest lines up with the level's one (which is hidden meanwhile).
  openChest(chest) {
    this.state = 'chest';
    this.facing = 1;
    this.vx = 0;
    this.x = chest.great ? chest.x - 140 : chest.x - CHEST_DX;
    this.anim.play(chest.great ? 'open_great' : 'open_chest', { fps: 6, loop: false, restart: true });
  }

  // the kneeling frames are drawn larger so the chest in them is chest-sized
  get kneelingAtChest() {
    return this.state === 'chest' && this.anim.name !== 'raise_treasure';
  }
}

/* ------------------------------------------------------------------ */
/* Enemies                                                             */
/* ------------------------------------------------------------------ */
export const ENEMY_TYPES = {
  guard: { hp: 45, w: 60, h: 165, speed: 100, chase: 235, sight: 520, range: 115, dmg: 10, coins: 3 },
  sniper: { hp: 32, w: 58, h: 170, speed: 90, chase: 140, sight: 760, range: 620, dmg: 12, coins: 4, ranged: true },
  drone: { hp: 24, w: 80, h: 70, speed: 90, chase: 160, sight: 560, range: 520, dmg: 9, coins: 3, flying: true },
  brute: { hp: 280, w: 120, h: 230, speed: 110, chase: 165, sight: 900, range: 170, dmg: 20, coins: 25, boss: true },
  kernel: { hp: 440, w: 80, h: 215, speed: 130, chase: 200, sight: 1100, range: 180, dmg: 18, coins: 60, boss: true },
};

export class Enemy extends Actor {
  constructor(spec, game) {
    const t = ENEMY_TYPES[spec.type];
    super(spec.type, spec.x, GROUND_Y, t.w, t.h);
    this.type = spec.type;
    this.t = t;
    this.hp = Math.round(t.hp * game.diff.hp);
    this.maxHp = this.hp;
    this.sightMul = game.diff.sight;
    this.homeX = spec.x;
    this.patrol = spec.patrol || 240;
    this.isBoss = !!spec.boss;
    this.flying = !!t.flying;
    if (this.flying) this.y = GROUND_Y - 250;
    this.baseY = this.y;
    this.state = 'patrol';
    this.facing = -1;
    this.cool = 1;
    this.aware = false;
    this.timer = 0;
    this.turnT = 0; // how long the target has been behind us
    this.pauseT = 0; // patrol: looking around before turning back
    this.engaged = false; // melee: close enough to fight (with hysteresis)
    this.rangeMode = 'hold'; // ranged: approach / hold / retreat
    this.bobT = (spec.x % 628) / 100;
    this.hitTargets = new Set();
    this.anim.play(this.flying ? 'hover' : 'walk', { fps: 9 });
    this.game = game;
  }

  get body() {
    if (!this.flying) return super.body;
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  canSee(p) {
    if (p.state === 'dead') return false;
    const dx = p.x - this.x;
    const dy = Math.abs(p.y - this.y);
    if (dy > (this.flying ? 420 : 170)) return false;
    const front = Math.sign(dx) === this.facing;
    const sight = (p.sneaking ? this.t.sight * 0.38 : this.t.sight) * this.sightMul;
    if (Math.abs(dx) < (p.sneaking ? 40 : 110)) return true;
    return front && Math.abs(dx) < sight;
  }

  hurt(dmg, fromX, game, knock = 200, launch = 0, pierce = false) {
    if (this.dead || this.state === 'dying') return;
    if (this.type === 'brute' && !pierce && this.state !== 'attack' && Math.sign(fromX - this.x) === this.facing && Math.random() < 0.35) {
      this.anim.play('block', { fps: 8, loop: false, restart: true });
      this.state = 'blocking';
      this.timer = 0.4;
      this.vx = -this.facing * 90;
      game.spark(this.x + this.facing * 50, this.y - 140, 0.8);
      game.sfx('block', this.x);
      return;
    }
    this.hp -= dmg;
    this.flash = 0.2;
    this.aware = true;
    this.engaged = true;
    this.facing = fromX > this.x ? 1 : -1;
    this.turnT = 0;
    game.spark(this.x - this.facing * 10, this.y - this.h * 0.65, 1);
    game.sfx(dmg > 15 ? 'hit_heavy' : 'hit', this.x);
    if (!this.flying) game.sfx('enemy_hurt', this.x, { vol: 0.6 });
    game.damageText(this.x, this.y - this.h - 10, dmg);
    if (!this.t.boss) {
      this.vx = Math.sign(this.x - fromX || 1) * knock;
      if (launch && !this.flying) this.vy = -launch;
    }
    if (this.hp <= 0) return this.die(game);
    if (!this.t.boss || this.state !== 'attack') {
      this.state = 'hurt';
      this.timer = this.t.boss ? 0.25 : 0.4;
      this.anim.play('hit', { fps: 10, loop: false, restart: true });
    }
  }

  takenDown(game) {
    this.hp = 0;
    this.vx = 0;
    setTimeout(() => this.die(game), 350);
  }

  die(game) {
    if (this.state === 'dying') return;
    this.state = 'dying';
    this.anim.play('death', { fps: 9, loop: false, restart: true });
    this.vx *= 0.5;
    game.sfx('enemy_die', this.x, { vol: this.t.boss ? 1.4 : 1 });
    game.onEnemyKilled(this);
  }

  update(dt, game) {
    const p = game.player;
    this.anim.update(dt);
    this.flash = Math.max(0, this.flash - dt);
    this.cool -= dt;
    this.timer -= dt;
    this.bobT += dt;
    const dx = p.x - this.x;

    if (this.state === 'dying') {
      this.vx *= Math.exp(-dt * 6);
      if (this.flying) this.vy += GRAVITY * dt * 0.5;
      if (this.anim.done) {
        this.fade = (this.fade ?? 1) - dt * 0.8;
        if (this.fade <= 0) this.remove = true;
      }
      return;
    }
    if (this.flying) this.y = this.baseY + Math.sin(this.bobT * 2.4) * 12;

    if (this.state === 'hurt' || this.state === 'blocking') {
      this.vx *= Math.exp(-dt * 7);
      if (this.timer <= 0) { this.state = 'chase'; this.aware = true; }
      return;
    }

    if (this.state === 'attack') return this.updateAttack(dt, game, dx);

    if (!this.aware && this.canSee(p)) {
      this.aware = true;
      this.state = 'alert';
      this.timer = 0.55;
      this.facing = Math.sign(dx) || 1;
      if (hasAnim(this.type, 'alert')) this.anim.play('alert', { fps: 6, loop: false, restart: true });
      game.alertMark(this);
    }

    let want = 0;
    if (this.state === 'alert') {
      if (this.timer <= 0) this.state = 'chase';
    } else if (!this.aware) {
      want = this.patrolStep(dt, game);
    } else if (p.state !== 'dead') {
      want = this.chaseStep(dt, game, dx);
      if (this.state === 'attack') return;
    }

    // Keep groups from stacking on one spot.
    if (this.aware) {
      for (const o of game.enemies) {
        if (o === this || o.state === 'dying' || o.flying !== this.flying) continue;
        const d = this.x - o.x;
        if (Math.abs(d) < 80) want += Math.sign(d || 1) * 70 * (1 - Math.abs(d) / 80);
      }
    }
    if (!this.flying && want !== 0 && !game.groundAhead(this, Math.sign(want) * 50)) want = 0;

    // Ease into the wanted speed instead of switching instantly.
    this.vx += (want - this.vx) * Math.min(1, dt * 9);
    this.animateLocomotion();
  }

  patrolStep(dt, game) {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.facing *= -1;
      return 0;
    }
    const out = (this.facing > 0 && this.x > this.homeX + this.patrol) || (this.facing < 0 && this.x < this.homeX - this.patrol);
    if (out || (!this.flying && !game.groundAhead(this, this.facing * 60))) {
      this.pauseT = 0.7 + Math.random() * 0.8;
      return 0;
    }
    return this.facing * this.t.speed;
  }

  /** Turn toward the player only after he has stayed behind us a moment. */
  faceToward(dx, dt) {
    const want = Math.sign(dx);
    if (!want || want === this.facing || Math.abs(dx) < 24) { this.turnT = 0; return; }
    this.turnT += dt;
    if (this.turnT > (this.t.boss ? 0.22 : 0.14)) { this.facing = want; this.turnT = 0; }
  }

  chaseStep(dt, game, dx) {
    const t = this.t;
    const dist = Math.abs(dx);
    this.faceToward(dx, dt);
    const facingPlayer = Math.sign(dx) === this.facing;

    if (t.ranged || this.flying) {
      const ideal = this.flying ? 260 : 460;
      if (this.rangeMode === 'approach' && dist < t.range - 60) this.rangeMode = 'hold';
      else if (this.rangeMode === 'retreat' && dist > ideal) this.rangeMode = 'hold';
      else if (this.rangeMode === 'hold') {
        if (dist > t.range + 40) this.rangeMode = 'approach';
        else if (dist < ideal - 140) this.rangeMode = 'retreat';
      }
      if (dist < t.range + 60 && this.cool <= 0 && facingPlayer) {
        this.beginAttack(this.flying ? 'laser' : 'shoot');
        return 0;
      }
      const s = Math.sign(dx);
      return this.rangeMode === 'approach' ? s * t.chase : this.rangeMode === 'retreat' ? -s * t.chase * 0.7 : 0;
    }

    if (this.cool <= 0 && facingPlayer) {
      if (this.type === 'kernel') {
        if (dist > 420 && Math.random() < 0.5) { this.beginAttack('teleport'); return 0; }
        if (dist > 260) { this.beginAttack('runes'); return 0; }
      }
      if (this.type === 'brute' && dist > 260 && dist < 520) { this.beginAttack('bash'); return 0; }
    }

    // hysteresis: start fighting inside 80% of the reach, chase again past 110%
    if (this.engaged ? dist > t.range * 1.1 : dist < t.range * 0.8) this.engaged = !this.engaged;
    if (!this.engaged) return this.facing * t.chase;
    if (this.cool <= 0 && facingPlayer) {
      this.beginAttack({ guard: 'attack', brute: 'slam', kernel: 'combo' }[this.type]);
    }
    return 0;
  }

  /** Walk/run cycle whose frame rate follows the actual speed. */
  animateLocomotion() {
    const a = this.anim;
    const v = Math.abs(this.vx);
    if (this.flying) {
      a.play(this.aware ? 'hover' : 'scan', { fps: this.aware ? 12 : 7 });
      return;
    }
    if (this.state === 'alert' && a.name === 'alert' && !a.done) return;
    if (v < 25) {
      a.play('idle', { fps: this.t.boss ? 5 : 6 });
      return;
    }
    // fps = frames * speed / distance covered by one cycle (two steps, measured
    // on the atlas), so the planted foot stays put. A floor keeps slow strolls
    // from turning into a slideshow; the slight foot slip that adds is not visible.
    if (this.type === 'guard' && v > 150) { a.play('run'); a.fps = Math.max(8, v / 32); return; }
    a.play('walk');
    const cycle = { guard: [25, 5.5], sniper: [25, 5], brute: [34, 5], kernel: [25, 5] }[this.type] || [20, 6];
    a.fps = Math.max(cycle[1], v / cycle[0]);
  }

  beginAttack(move) {
    this.state = 'attack';
    this.move = move;
    this.spawned = false;
    this.hitTargets.clear();
    const fps = { attack: 12, shoot: 9, laser: 6, slam: 10, bash: 11, combo: 12, runes: 8, teleport: 8 }[move];
    this.anim.play(move, { fps, loop: false, restart: true });
  }

  updateAttack(dt, game, dx) {
    const i = this.anim.index;
    const p = game.player;
    const t = this.t;
    let want = 0;
    switch (this.move) {
      case 'attack':
        if (i >= 3 && i <= 5) game.enemyMelee(this, this.reach(125), t.dmg);
        if (i === 3) want = this.facing * 120; // small step into the swing
        break;
      case 'combo':
        if (i >= 1 && i <= 5) game.enemyMelee(this, this.reach(175, 120), t.dmg);
        break;
      case 'bash':
        if (i >= 1 && i <= 3) want = this.facing * 520;
        if (i >= 1) game.enemyMelee(this, this.reach(110, 160), t.dmg + 4, 520);
        break;
      case 'slam':
        if (i >= 3 && !this.spawned) {
          this.spawned = true;
          game.shockwave(this.x + this.facing * 60, this.y, t.dmg);
        }
        break;
      case 'shoot':
        if (i >= 3 && !this.spawned) {
          this.spawned = true;
          game.spawnBolt(this.x + this.facing * 80, this.y - 120, this.facing, t.dmg);
        }
        break;
      case 'laser':
        if (i >= 1 && !this.spawned) {
          this.spawned = true;
          game.spawnLaser(this.x + this.facing * 40, this.y, p.x, p.y - 90, t.dmg);
        }
        break;
      case 'runes':
        if (i >= 3 && !this.spawned) {
          this.spawned = true;
          game.sfx('rune', this.x);
          for (let k = -2; k <= 2; k++) game.spawnRune(p.x + k * 110 + (Math.random() - 0.5) * 40, 0.15 * Math.abs(k), t.dmg);
        }
        break;
      case 'teleport':
        if (i >= 1 && !this.spawned) {
          this.spawned = true;
          game.puff(this.x, this.y - 100);
          game.sfx('teleport', this.x);
          const side = Math.random() < 0.5 ? -1 : 1;
          this.x = Math.max(80, Math.min(game.level.length - 80, p.x + side * 200));
          this.facing = -side;
          game.puff(this.x, this.y - 100);
        }
        break;
    }
    // the bash keeps its momentum and slides to a stop; other moves ease
    if (this.move === 'bash' && want === 0) this.vx *= Math.exp(-dt * 8);
    else this.vx += (want - this.vx) * Math.min(1, dt * 10);
    if (this.anim.done) {
      this.state = 'chase';
      const base = { attack: 1.0, shoot: 2.0, laser: 1.8, slam: 1.6, bash: 2.2, combo: 1.2, runes: 2.6, teleport: 0.6 }[this.move];
      this.cool = base * (0.8 + Math.random() * 0.5) * game.diff.cool;
      this.animateLocomotion();
    }
  }

  draw(ctx) {
    const alpha = Math.max(0, this.fade ?? 1);
    if (this.flying) {
      // a drone's shadow falls on the floor far below it
      this.groundY = GROUND_Y;
      ctx.save();
      ctx.globalAlpha = 0.22 * alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(this.x, GROUND_Y + 2, 34, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      this.drawShadow(ctx, this.w * 1.7, alpha);
    }
    // walkers stand on their feet; the drone's anchor is its body centre
    const y = this.flying ? this.y : this.y + 4;
    this.anim.draw(ctx, this.x, y, this.facing, 1, alpha);
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.anim.draw(ctx, this.x, y, this.facing, 1, this.flash * 2);
      ctx.restore();
    }
  }
}
