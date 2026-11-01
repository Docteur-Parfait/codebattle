import { assets, drawEnv, envRect } from './assets.js';
import { drawFrame } from './sprite.js';
import { input } from './input.js';
import { buildLevel, GROUND_Y } from './level.js';
import { Player, Enemy, GRAVITY, overlap } from './entities.js';

// The height is fixed; the width follows the screen shape (see main.js fit())
// so wide phones show more of the level instead of black bars.
export let W = 1280;
export const H = 720;
export function setViewWidth(w) { W = w; }

const COIN_FRAMES = ['coin_0', 'coin_1', 'coin_2', 'coin_3', 'coin_4', 'coin_5'];
const PICKUP_ITEM = { gem: 'gem_blue', heart: 'heart', fragment: 'code_fragment' };

export class Game {
  constructor(ctx, def, hooks, diff) {
    this.ctx = ctx;
    this.def = def;
    this.diff = diff;
    this.hooks = hooks; // { onComplete(result), onDeath(), toast(msg) }
    this.world = def.world;
    this.level = buildLevel(def, diff);
    this.tiles = `tiles_w${def.world}`;
    this.reset();
    // build the scaled parallax strips now rather than on the first frame
    this.layerStrip(`bg_${this.world}`, this.skyHeight());
    this.layerStrip(`mid_${this.world}`, 720);
  }

  reset() {
    const L = this.level;
    this.time = 0;
    this.camX = 0;
    this.shakeT = 0;
    this.coins = 0;
    this.kills = 0;
    this.totalCoins = L.pickups.filter((p) => p.type === 'coin').length;
    this.player = new Player(L.spawn.x, L.spawn.y);
    this.enemies = L.enemies.map((e) => new Enemy(e, this));
    this.boss = this.enemies.find((e) => e.isBoss) || null;
    this.pickups = L.pickups.map((p) => ({ ...p, taken: false, phase: Math.random() * 6 }));
    this.crates = L.crates.map((c) => ({ ...c, broken: false }));
    this.projectiles = [];
    this.fx = [];
    this.texts = [];
    this.chestOpen = false;
    this.finished = false;
    this.checkpoints = (L.checkpoints || []).map((c) => ({ ...c, lit: false }));
    this.respawn = null;
    this.bossMusic = false;
    this.solids = [
      ...L.ground.map((g) => ({ x: g.x, y: GROUND_Y, w: g.w, h: 400, kind: 'ground' })),
      ...L.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: 34, kind: 'plat', oneWay: true })),
    ];
  }

  /* ---------------- hooks used by entities ---------------- */
  toast(msg) { this.hooks.toast?.(msg); }
  /** Sound at world position x (pans with the camera, silent far off screen). */
  sfx(name, x, opts = {}) {
    if (x !== undefined) {
      const sx = x - this.camX;
      if (sx < -500 || sx > W + 500) return;
      opts.pan = (sx - W / 2) / W;
    }
    this.hooks.sfx?.(name, opts);
  }
  shake(a) { this.shakeT = Math.max(this.shakeT, a); }

  spark(x, y, s = 1) { this.fx.push({ kind: 'spark', x, y, t: 0, dur: 0.22, s }); }
  dust(x, y) { this.fx.push({ kind: 'dust', x, y, t: 0, dur: 0.35 }); }
  puff(x, y) { this.fx.push({ kind: 'teleport', x, y, t: 0, dur: 0.45 }); }
  alertMark(e) { this.fx.push({ kind: 'alert', target: e, t: 0, dur: 0.8 }); this.sfx('alert', e.x); }
  damageText(x, y, n) { this.texts.push({ x, y, t: 0, text: String(n) }); }

  takedownTarget(p) {
    if (!p.sneaking) return null;
    return this.enemies.find((e) => !e.isBoss && !e.aware && e.state !== 'dying' && !e.flying
      && Math.abs(e.x - p.x) < 110 && Math.abs(e.y - p.y) < 40
      && Math.sign(p.x - e.x) === -e.facing) || null;
  }

  meleeHit(p, box, def) {
    for (const e of this.enemies) {
      if (e.state === 'dying' || p.hitTargets.has(e)) continue;
      if (overlap(box, e.body)) {
        p.hitTargets.add(e);
        e.hurt(def.dmg, p.x, this, def.knock, def.launch);
        p.energy = Math.min(p.maxEnergy, p.energy + 4);
        this.shake(def.dmg > 15 ? 6 : 3);
        this.hitstop = 0.05;
      }
    }
    for (const c of this.crates) {
      if (c.broken || p.hitTargets.has(c)) continue;
      if (overlap(box, c)) { p.hitTargets.add(c); this.breakCrate(c); }
    }
  }

  enemyMelee(e, box, dmg, knock) {
    const p = this.player;
    if (e.hitTargets.has(p)) return;
    if (overlap(box, p.body)) { e.hitTargets.add(p); p.hurt(dmg, e.x, this, knock); }
  }

  breakCrate(c) {
    c.broken = true;
    this.shake(4);
    this.sfx(c.kind === 'barrel_explosive' ? 'explosion' : 'crate', c.x);
    if (c.kind === 'barrel_explosive') {
      this.fx.push({ kind: 'explosion', x: c.x + c.w / 2, y: c.y + c.h / 2, t: 0, dur: 0.5 });
      this.shake(14);
      const cx = c.x + c.w / 2;
      for (const e of this.enemies) if (Math.abs(e.x - cx) < 200 && e.state !== 'dying') e.hurt(40, cx, this, 420, 400);
      if (Math.abs(this.player.x - cx) < 170) this.player.hurt(20, cx, this, 420);
      for (const o of this.crates) if (!o.broken && o !== c && Math.abs(o.x - c.x) < 180) this.breakCrate(o);
    } else {
      this.fx.push({ kind: 'dust', x: c.x + c.w / 2, y: c.y + c.h, t: 0, dur: 0.4 });
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.pickups.push({ type: 'coin', x: c.x + 10 + i * 18, y: c.y - 20, vy: -500 - Math.random() * 200, vx: (Math.random() - 0.5) * 300, taken: false, phase: 0, loose: true });
      }
    }
  }

  spawnBlast(x, y, dir) {
    this.projectiles.push({ kind: 'blast', x, y, vx: dir * 900, vy: 0, dir, t: 0, life: 1.4, dmg: 38, friendly: true, r: 46 });
    this.sfx('blast');
    this.shake(5);
  }

  spawnBolt(x, y, dir, dmg) {
    this.projectiles.push({ kind: 'bolt', x, y, vx: dir * 700, vy: 0, dir, t: 0, life: 2, dmg, r: 18 });
    this.sfx('bolt', x);
  }

  spawnLaser(x, y, tx, ty, dmg) {
    const a = Math.atan2(ty - y, tx - x);
    this.sfx('laser', x);
    this.projectiles.push({ kind: 'laser', x, y, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, t: 0, life: 1.6, dmg, r: 14, angle: a });
  }

  spawnRune(x, delay, dmg) {
    this.projectiles.push({ kind: 'rune', x, y: -60 - delay * 600, vx: 0, vy: 700, t: 0, life: 3, dmg, r: 30 });
  }

  shockwave(x, y, dmg) {
    this.shake(16);
    this.sfx('stomp', x, { vol: 1.3 });
    this.sfx('explosion', x, { vol: 0.6 });
    this.fx.push({ kind: 'explosion', x, y: y - 40, t: 0, dur: 0.5 });
    for (const d of [-1, 1]) this.projectiles.push({ kind: 'wave', x, y: y - 30, vx: d * 620, vy: 0, dir: d, t: 0, life: 0.7, dmg, r: 34 });
  }

  onEnemyKilled(e) {
    this.kills += 1;
    for (let i = 0; i < e.t.coins; i++) {
      this.pickups.push({ type: 'coin', x: e.x + (i - e.t.coins / 2) * 14, y: e.y - 120, vy: -600 - Math.random() * 300, vx: (Math.random() - 0.5) * 360, taken: false, phase: 0, loose: true });
    }
    if (e.isBoss) {
      this.shake(20);
      this.hooks.music?.(this.world);
      this.toast(e.type === 'kernel' ? 'Kernel est vaincu ! Le Grand Trésor est à toi.' : 'Gardien vaincu ! Le coffre est accessible.');
    }
  }

  onPlayerDeath() {
    if (this.respawn) setTimeout(() => this.revive(), 1600);
    else setTimeout(() => this.hooks.onDeath?.(), 1600);
  }

  /** Back to the last lit checkpoint with full health. */
  revive() {
    const p = this.player;
    const c = this.respawn;
    p.x = c.x + 40;
    p.y = GROUND_Y;
    p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.state = 'normal';
    p.invuln = 2;
    p.lastSafe = { x: p.x, y: p.y };
    p.anim.play('idle', { restart: true });
    for (const e of this.enemies) if (Math.abs(e.x - p.x) < 700) e.aware = false;
    this.puff(p.x, p.y - 80);
    this.sfx('heart');
    this.toast('Retour au point de sauvegarde');
  }

  tryInteract(p) {
    const c = this.level.chest;
    if (this.chestOpen || Math.abs(p.x - c.x) > 120) return false;
    if (this.boss && this.boss.state !== 'dying' && !this.boss.remove) { this.toast('Bats le gardien pour ouvrir le coffre !'); return true; }
    this.chestOpen = true;
    p.openChest(c);
    this.sfx('chest');
    setTimeout(() => this.finish(), 3600);
    return true;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const ratio = this.totalCoins ? this.coins / this.totalCoins : 1;
    const hpRatio = this.player.hp / this.player.maxHp;
    let stars = 1;
    if (ratio >= 0.5) stars++;
    if (ratio >= 0.8 && hpRatio >= 0.4) stars++;
    this.hooks.onComplete?.({ stars, coins: this.coins, kills: this.kills, time: this.time });
  }

  /* ---------------- physics ---------------- */
  moveActor(a, dt) {
    if (!a.flying) a.vy = Math.min(a.vy + GRAVITY * dt, 1600);
    // horizontal
    a.x += a.vx * dt;
    let b = a.body;
    for (const s of this.solids) {
      if (s.oneWay || !overlap(b, s)) continue;
      a.x = a.vx > 0 ? s.x - a.w / 2 - 0.01 : s.x + s.w + a.w / 2 + 0.01;
      a.vx = 0;
      b = a.body;
    }
    for (const c of this.crates) {
      if (c.broken || !overlap(b, c)) continue;
      a.x = a.x < c.x + c.w / 2 ? c.x - a.w / 2 - 0.01 : c.x + c.w + a.w / 2 + 0.01;
      a.vx = 0;
      b = a.body;
    }
    a.x = Math.max(a.w / 2, Math.min(this.level.length + 300, a.x));
    if (a.flying) { a.y += a.vy * dt; return; }
    // vertical
    const prevBottom = a.y;
    a.y += a.vy * dt;
    a.onGround = false;
    b = a.body;
    const tops = [...this.solids, ...this.crates.filter((c) => !c.broken)];
    for (const s of tops) {
      if (!overlap(b, s)) continue;
      if (a.vy >= 0 && prevBottom <= s.y + 6) {
        a.y = s.y;
        a.vy = 0;
        a.onGround = true;
      } else if (!s.oneWay && a.vy < 0) {
        a.y = s.y + s.h + a.h;
        a.vy = 0;
      }
      b = a.body;
    }
  }

  /** Is there solid ground `off` pixels in front of a walker's feet? */
  groundAhead(a, off) {
    const x = a.x + off;
    return this.solids.some((s) => !s.oneWay && x > s.x && x < s.x + s.w && Math.abs(s.y - a.y) < 8)
      || this.crates.some((c) => !c.broken && x > c.x && x < c.x + c.w && Math.abs(c.y - a.y) < 8);
  }

  /* ---------------- update ---------------- */
  update(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; input.endFrame(); return; }
    this.time += dt;
    const p = this.player;
    p.update(dt, this);
    this.moveActor(p, dt);
    if (p.onGround && p.state === 'normal') p.lastSafe = { x: p.x, y: p.y };
    for (const c of this.checkpoints) {
      if (c.lit || p.x < c.x || p.state === 'dead') continue;
      c.lit = true;
      this.respawn = c;
      p.hp = Math.max(p.hp, Math.min(p.maxHp, p.hp + 30));
      this.spark(c.x + 20, GROUND_Y - 120, 1.6);
      this.toast('Point de sauvegarde');
      this.sfx('checkpoint');
    }

    // fell into a pit
    if (p.y > H + 200 && p.state !== 'dead') {
      p.hp -= 25;
      if (p.hp <= 0) { p.hp = 0; p.state = 'dead'; this.onPlayerDeath(); }
      else {
        const back = p.lastSafe.x - p.facing * 120;
        p.x = back; p.y = GROUND_Y - 300; p.vx = 0; p.vy = 0; p.invuln = 1.2;
        this.sfx('hurt');
        this.toast('-25 PV');
      }
    }

    if (this.boss && !this.bossMusic && this.boss.aware && this.boss.state !== 'dying') {
      this.bossMusic = true;
      this.hooks.music?.('boss');
    }
    for (const e of this.enemies) {
      if (Math.abs(e.x - p.x) > 1800 && !e.aware) continue; // sleep far enemies
      e.update(dt, this);
      this.moveActor(e, dt);
      if (e.y > H + 300) e.remove = true;
    }
    this.enemies = this.enemies.filter((e) => !e.remove);

    // hazards
    for (const h of this.level.hazards) {
      if (overlap(p.body, h)) p.hurt(18, h.x + h.w / 2, this, 300);
    }

    this.updateProjectiles(dt);
    this.updatePickups(dt);

    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.dur);
    for (const t of this.texts) { t.t += dt; t.y -= 60 * dt; }
    this.texts = this.texts.filter((t) => t.t < 0.8);

    // camera: the look-ahead slides over when Parfait turns, then the camera
    // eases toward it (frame-rate independent)
    this.look = this.look ?? p.facing * 140;
    this.look += (p.facing * 140 - this.look) * (1 - Math.exp(-dt * 2.5));
    const target = Math.max(0, Math.min(this.level.length - W + 200, p.x - W * 0.4 + this.look));
    this.camX += (target - this.camX) * (1 - Math.exp(-dt * 6));
    this.shakeT = Math.max(0, this.shakeT - dt * 40);
    input.endFrame();
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.t += dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      const box = { x: pr.x - pr.r, y: pr.y - pr.r, w: pr.r * 2, h: pr.r * 2 };
      if (pr.friendly) {
        for (const e of this.enemies) {
          if (e.state === 'dying' || overlap(box, e.body) === false) continue;
          e.hurt(pr.dmg, pr.x - pr.dir * 50, this, 420, 300);
          pr.t = pr.life;
          this.fx.push({ kind: 'explosion', x: pr.x, y: pr.y, t: 0, dur: 0.4 });
          break;
        }
        for (const c of this.crates) if (!c.broken && overlap(box, c)) { this.breakCrate(c); pr.t = pr.life; }
      } else if (p.state !== 'dead' && overlap(box, p.body)) {
        p.hurt(pr.dmg, pr.x - (pr.vx > 0 ? 50 : -50), this);
        pr.t = pr.life;
        this.spark(pr.x, pr.y, 0.8);
      }
      if (pr.kind === 'rune' && pr.y > GROUND_Y - 10) { pr.t = pr.life; this.spark(pr.x, GROUND_Y - 20, 1.2); this.sfx('explosion', pr.x, { vol: 0.35 }); }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.t < pr.life);
  }

  updatePickups(dt) {
    const p = this.player;
    const pb = p.body;
    for (const it of this.pickups) {
      if (it.taken) continue;
      it.phase += dt;
      if (it.loose) {
        it.vy += GRAVITY * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.vx *= 0.98;
        const ground = this.solids.find((s) => it.x > s.x && it.x < s.x + s.w && it.y >= s.y && it.y - it.vy * dt <= s.y + 4);
        if (ground) { it.y = ground.y - 18; it.vy *= -0.35; if (Math.abs(it.vy) < 80) { it.vy = 0; it.loose = false; } }
        if (it.y > H + 100) it.taken = true;
      }
      const r = { x: it.x - 22, y: it.y - 22, w: 44, h: 44 };
      if (overlap(r, pb)) {
        it.taken = true;
        if (it.type === 'coin') { this.coins += 1; this.sfx('coin', undefined, { vol: 0.7 }); }
        else if (it.type === 'gem') { this.coins += 10; this.toast('+10 pièces'); this.sfx('gem'); }
        else if (it.type === 'heart') { p.hp = Math.min(p.maxHp, p.hp + 35); this.toast('+35 PV'); this.sfx('heart'); }
        else if (it.type === 'fragment') { p.energy = Math.min(p.maxEnergy, p.energy + 50); this.toast('Fragment de code : +50 énergie'); this.sfx('gem', undefined, { rate: 0.8 }); }
        this.fx.push({ kind: 'spark', x: it.x, y: it.y, t: 0, dur: 0.18, s: 0.5 });
      }
    }
    this.pickups = this.pickups.filter((it) => !it.taken);
  }

  /* ---------------- render ---------------- */
  render() {
    const ctx = this.ctx;
    const cam = this.camX + (Math.random() - 0.5) * this.shakeT;
    const camY = (Math.random() - 0.5) * this.shakeT * 0.6;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    this.drawParallax(ctx, cam);

    ctx.translate(-cam, camY);
    this.drawDecor(ctx, cam);
    this.drawCheckpoints(ctx, cam);
    this.drawGround(ctx, cam);
    this.drawChest(ctx);
    for (const c of this.crates) if (!c.broken) this.drawCrate(ctx, c);
    for (const h of this.level.hazards) drawEnv(ctx, 'props', 'spikes', h.x - 8, h.y - 30, h.w + 16, h.h + 34);
    this.drawPickups(ctx);
    for (const e of this.enemies) if (Math.abs(e.x - cam - W / 2) < W) e.draw(ctx);
    this.player.draw(ctx);
    this.drawProjectiles(ctx);
    this.drawFx(ctx);
    ctx.restore();
    this.drawHud(ctx);
  }

  /**
   * The parallax layer scaled once to its on-screen height, followed by its
   * mirror image so the strip tiles seamlessly. Drawing it is then two plain
   * copies per frame instead of scaling a 1536 px image every frame.
   */
  layerStrip(key, h) {
    this.strips = this.strips || {};
    const id = `${key}@${h}`;
    if (this.strips[id]) return this.strips[id];
    const img = assets.img[key];
    if (!img) return null;
    const w = Math.round(img.width * (h / img.height));
    const c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    g.translate(w * 2, 0);
    g.scale(-1, 1);
    g.drawImage(img, 0, 0, w, h);
    this.strips[id] = c;
    return c;
  }

  drawMirrored(ctx, key, offset, y, h) {
    const strip = this.layerStrip(key, h);
    if (!strip) return;
    const sw = strip.width;
    let x = -(((offset % sw) + sw) % sw);
    for (; x < W; x += sw) ctx.drawImage(strip, x, y);
  }

  /**
   * The far layer is one picture, slightly larger than the screen, that pans
   * across its own overflow over the whole level: no repeat, so the moon or
   * the sun never appears twice.
   */
  // tall enough that the sky stays wider than the view on wide screens
  skyHeight() {
    const img = assets.img[`bg_${this.world}`];
    if (!img) return Math.round(H * 1.25);
    return Math.max(Math.round(H * 1.25), Math.ceil((W + 80) * img.height / img.width));
  }

  drawSky(ctx, cam) {
    const key = `bg_${this.world}`;
    const img = assets.img[key];
    if (!img) return;
    const h = this.skyHeight();
    const strip = this.layerStrip(key, h);
    const w = strip.width / 2;
    const k = Math.max(0, Math.min(1, cam / Math.max(1, this.level.length - W)));
    ctx.drawImage(strip, 0, 0, w, h, -k * (w - W), -(h - H) / 2, w, h);
  }

  drawParallax(ctx, cam) {
    this.drawSky(ctx, cam);
    this.drawMirrored(ctx, `mid_${this.world}`, cam * 0.45, -40, 720);
    // push the scenery back a little so characters read clearly in front of it
    ctx.fillStyle = 'rgba(8, 10, 24, 0.16)';
    ctx.fillRect(0, 0, W, H);
    // haze to separate the play layer
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
  }

  drawTileRun(ctx, x, y, w, h, prefix) {
    const L = envRect(this.tiles, `${prefix}_l`);
    const M = envRect(this.tiles, `${prefix}_m`);
    const R = envRect(this.tiles, `${prefix}_r`);
    if (!M) { ctx.fillStyle = '#3b2b1a'; ctx.fillRect(x, y, w, h); return; }
    const tw = (r) => (r[2] * h) / r[3];
    const lw = L ? tw(L) : 0;
    const rw = R ? tw(R) : 0;
    const mw = tw(M);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - lw * 0.15, y - h, w + lw * 0.3, h * 3);
    ctx.clip();
    for (let cx = x + lw * 0.6; cx < x + w - rw * 0.6; cx += mw * 0.92) drawEnv(ctx, this.tiles, `${prefix}_m`, cx, y, mw, h);
    if (L) drawEnv(ctx, this.tiles, `${prefix}_l`, x - lw * 0.15, y, lw, h);
    if (R) drawEnv(ctx, this.tiles, `${prefix}_r`, x + w - rw * 0.85, y, rw, h);
    ctx.restore();
  }

  drawGround(ctx, cam) {
    for (const s of this.solids) {
      if (s.x > cam + W + 200 || s.x + s.w < cam - 200) continue;
      if (s.kind === 'ground') {
        this.drawTileRun(ctx, s.x, s.y - 26, s.w, 150, 'ground');
        ctx.fillStyle = 'rgba(10,6,4,0.85)';
        ctx.fillRect(s.x + 10, s.y + 115, s.w - 20, H);
      } else {
        this.drawTileRun(ctx, s.x, s.y - 22, s.w, 92, 'plat');
      }
    }
  }

  drawDecor(ctx, cam) {
    for (const d of this.level.decor) {
      if (d.x > cam + W + 300 || d.x < cam - 400) continue;
      if (d.tile) {
        const r = envRect(this.tiles, d.item);
        if (!r) continue;
        const s = Math.min(1, 150 / r[3]) * 0.8;
        drawEnv(ctx, this.tiles, d.item, d.x, GROUND_Y - r[3] * s + 8, r[2] * s, r[3] * s);
      } else {
        const r = envRect('props', d.item);
        if (!r) continue;
        const s = d.item === 'torch' ? 0.55 : d.item === 'signpost' ? 0.6 : 0.5;
        const y = d.wall ? GROUND_Y - 240 : GROUND_Y - r[3] * s + 6;
        drawEnv(ctx, 'props', d.item, d.x, y, r[2] * s, r[3] * s);
      }
    }
  }

  drawCheckpoints(ctx, cam) {
    const r = envRect('props', 'torch');
    if (!r) return;
    const s = 0.55;
    for (const c of this.checkpoints) {
      if (c.x > cam + W + 200 || c.x < cam - 200) continue;
      ctx.save();
      if (c.lit) {
        ctx.shadowColor = '#ffb347';
        ctx.shadowBlur = 26 + Math.sin(this.time * 9 + c.x) * 8;
      } else {
        ctx.filter = 'grayscale(1) brightness(0.55)';
      }
      drawEnv(ctx, 'props', 'torch', c.x, GROUND_Y - r[3] * s + 6, r[2] * s, r[3] * s);
      ctx.restore();
    }
  }

  drawCrate(ctx, c) {
    const item = c.kind === 'crate' ? 'crate' : c.kind === 'cardboard' ? 'cardboard' : 'barrel_explosive';
    drawEnv(ctx, 'props', item, c.x - 4, c.y - 4, c.w + 8, c.h + 6);
  }

  drawChest(ctx) {
    const c = this.level.chest;
    const p0 = this.player;
    const opening = p0.state === 'chest' && p0.anim.name === 'open_chest' ? p0.anim.index : 9;
    if (opening >= 1 && opening <= 4) return; // Parfait's frames draw the chest
    const item = c.great ? 'great_chest' : this.chestOpen && opening > 0 ? 'chest_open' : 'chest_closed';
    const r = envRect('props', item);
    if (!r) return;
    // sized to match the chest drawn into Parfait's open_chest frames
    const s = c.great ? 0.55 : 0.58;
    const w = r[2] * s;
    const h = r[3] * s;
    const glow = 0.5 + Math.sin(this.time * 3) * 0.2;
    ctx.save();
    ctx.shadowColor = c.great ? '#2de2ff' : '#ffd84a';
    ctx.shadowBlur = 30 * glow;
    drawEnv(ctx, 'props', item, c.x - w / 2, GROUND_Y - h + 6, w, h);
    ctx.restore();
    const p = this.player;
    if (!this.chestOpen && Math.abs(p.x - c.x) < 160) {
      ctx.font = '800 22px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      const label = input.touchMode ? 'Appuie sur ✋' : 'Appuie sur E';
      ctx.strokeText(label, c.x, GROUND_Y - h - 20);
      ctx.fillText(label, c.x, GROUND_Y - h - 20);
    }
  }

  drawPickups(ctx) {
    for (const it of this.pickups) {
      const bob = it.loose ? 0 : Math.sin(it.phase * 4) * 6;
      if (it.type === 'coin') {
        const f = COIN_FRAMES[Math.floor(it.phase * 10) % 6];
        const r = envRect('collectibles_fx', f);
        if (r) drawEnv(ctx, 'collectibles_fx', f, it.x - (r[2] * 0.42) / 2, it.y - 22 + bob, r[2] * 0.42, r[3] * 0.42);
      } else {
        const item = PICKUP_ITEM[it.type];
        const r = envRect('collectibles_fx', item);
        if (!r) continue;
        const s = 50 / r[3];
        ctx.save();
        ctx.shadowColor = it.type === 'heart' ? '#5f5' : '#2de2ff';
        ctx.shadowBlur = 18;
        drawEnv(ctx, 'collectibles_fx', item, it.x - (r[2] * s) / 2, it.y - 25 + bob, r[2] * s, r[3] * s);
        ctx.restore();
      }
    }
  }

  drawProjectiles(ctx) {
    for (const pr of this.projectiles) {
      ctx.save();
      if (pr.kind === 'blast') {
        const list = assets.atlas.parfait.anims.fx_syntax_blast;
        const f = list[Math.floor(pr.t * 14) % list.length];
        drawFrame(ctx, 'parfait', f, pr.x, pr.y, pr.dir, 0.9);
      } else if (pr.kind === 'bolt') {
        const list = assets.atlas.sniper.anims.fx_bolt;
        drawFrame(ctx, 'sniper', list[Math.floor(pr.t * 12) % list.length], pr.x, pr.y, pr.dir, 0.9);
      } else if (pr.kind === 'laser') {
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.angle);
        ctx.shadowColor = '#ff2a4a';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ff5a70';
        ctx.fillRect(-40, -4, 80, 8);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-30, -1.5, 60, 3);
      } else if (pr.kind === 'rune') {
        ctx.shadowColor = '#ffd84a';
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#ffe58a';
        ctx.font = '900 54px Cinzel, serif';
        ctx.textAlign = 'center';
        ctx.fillText('{ }', pr.x, pr.y + 18);
        ctx.globalAlpha = 0.3;
        ctx.fillRect(pr.x - 4, GROUND_Y - 6, 8, 6);
      } else if (pr.kind === 'wave') {
        ctx.shadowColor = '#ff8a2a';
        ctx.shadowBlur = 24;
        ctx.fillStyle = 'rgba(255,140,40,0.85)';
        ctx.beginPath();
        ctx.ellipse(pr.x, pr.y + 20, 46, 26, 0, Math.PI, 0);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawStrip(ctx, item, frames, k, x, y, scale) {
    const r = envRect('collectibles_fx', item);
    if (!r) return;
    const fw = r[2] / frames;
    const i = Math.min(frames - 1, Math.floor(k * frames));
    const im = assets.img.collectibles_fx;
    ctx.drawImage(im, r[0] + i * fw, r[1], fw, r[3], x - (fw * scale) / 2, y - r[3] * scale, fw * scale, r[3] * scale);
  }

  drawFx(ctx) {
    for (const f of this.fx) {
      const k = f.t / f.dur;
      if (f.kind === 'spark') {
        const item = ['spark_0', 'spark_1', 'spark_2', 'spark_3'][Math.min(3, Math.floor(k * 4))];
        const r = envRect('collectibles_fx', item);
        if (r) {
          const s = 0.7 * (f.s || 1);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          drawEnv(ctx, 'collectibles_fx', item, f.x - (r[2] * s) / 2, f.y - (r[3] * s) / 2, r[2] * s, r[3] * s);
          ctx.restore();
        }
      } else if (f.kind === 'dust') {
        ctx.globalAlpha = 1 - k * 0.5;
        this.drawStrip(ctx, 'dust_strip', 4, k, f.x, f.y + 6, 0.55);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'explosion') {
        this.drawStrip(ctx, 'explosion_strip', 3, k, f.x, f.y + 70, 0.9);
      } else if (f.kind === 'teleport') {
        ctx.globalAlpha = 1 - k;
        this.drawStrip(ctx, 'teleport_strip', 4, k, f.x, f.y + 120, 0.6);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'alert') {
        const e = f.target;
        ctx.font = '900 48px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff3b3b';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        const y = e.body.y - 20 - Math.sin(k * Math.PI) * 10;
        ctx.strokeText('!', e.x, y);
        ctx.fillText('!', e.x, y);
      }
    }
    ctx.font = '900 30px Nunito, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.t / 0.8;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#ffe14a';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  bar(ctx, x, y, w, h, ratio, c1, c2) {
    ctx.fillStyle = 'rgba(5,10,25,0.85)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, Math.max(0, (w - 6) * ratio), h - 6, (h - 6) / 2);
    ctx.fill();
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.stroke();
  }

  drawHud(ctx) {
    const p = this.player;
    drawEnv(ctx, 'ui_kit', 'portrait', 18, 14, 92, 108);
    this.bar(ctx, 118, 26, 300, 24, p.hp / p.maxHp, '#ff7a7a', '#c4142c');
    this.bar(ctx, 118, 58, 240, 18, p.energy / p.maxEnergy, '#9ff4ff', '#13a7d8');
    ctx.font = '800 15px Nunito, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.ceil(p.hp)} PV`, 128, 44);

    // coins
    const r = envRect('collectibles_fx', 'coin_0');
    if (r) drawEnv(ctx, 'collectibles_fx', 'coin_0', 120, 84, 26, 26 * (r[3] / r[2]) * 0.75);
    ctx.font = '900 24px Nunito, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText(`${this.coins}`, 154, 108);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(`${this.coins}`, 154, 108);

    ctx.textAlign = 'right';
    ctx.font = '800 18px Nunito, sans-serif';
    ctx.fillStyle = '#fff';
    const title = `${this.def.id}. ${this.def.name}`;
    // room for the menu button in the top-right corner
    ctx.strokeText(title, W - 104, 40);
    ctx.fillText(title, W - 104, 40);
    if (p.sneaking) {
      ctx.fillStyle = '#2de2ff';
      ctx.strokeText('◉ FURTIF', W - 104, 66);
      ctx.fillText('◉ FURTIF', W - 104, 66);
    }

    const b = this.boss;
    if (b && b.aware && b.state !== 'dying') {
      const bw = 560;
      const bx = (W - bw) / 2;
      ctx.textAlign = 'center';
      ctx.font = '900 20px Cinzel, serif';
      ctx.fillStyle = '#ffd84a';
      const name = b.type === 'kernel' ? 'KERNEL — Gardien du Grand Trésor' : 'FIREWALL BRUTE';
      ctx.strokeText(name, W / 2, H - 52);
      ctx.fillText(name, W / 2, H - 52);
      this.bar(ctx, bx, H - 42, bw, 22, b.hp / b.maxHp, '#ff8a3a', '#a01010');
    }
  }
}
