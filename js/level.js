// Procedural level layout, seeded by the level number so each level is stable.

export const GROUND_Y = 600;

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffffff) / 0x1000000;
  };
}

const ENEMIES_BY_WORLD = {
  1: ['guard'],
  2: ['guard', 'guard', 'sniper'],
  3: ['guard', 'sniper', 'drone', 'drone'],
  4: ['guard', 'sniper', 'drone'],
  5: ['guard', 'sniper', 'drone', 'sniper'],
};

/**
 * Returns { length, ground[], platforms[], crates[], hazards[], enemies[],
 * pickups[], decor[], chest, boss, spawn }.
 */
export function buildLevel(def, diff) {
  const id = def.id;
  const world = def.world;
  const r = rng(id * 7919);
  const boss = def.boss || null;
  // ~2.5 min for level 1 up to ~6 min for the last ones, at normal difficulty
  const length = Math.round((14000 + id * 900) * diff.length) + (boss ? 1300 : 0);
  const ground = [];
  const platforms = [];
  const crates = [];
  const hazards = [];
  const enemies = [];
  const pickups = [];
  const decor = [];
  const checkpoints = [];
  let lastCheckpoint = 0;

  const coinRow = (x, y, n, gap = 56) => {
    for (let i = 0; i < n; i++) pickups.push({ type: 'coin', x: x + i * gap, y });
  };

  let x = 0;
  let groundStart = 0;
  const safeEnd = length - (boss ? 1700 : 800);
  let lastEnemyX = 900;
  x = 1000;
  decor.push({ item: 'signpost', x: 520 });
  coinRow(680, GROUND_Y - 60, 5);

  while (x < safeEnd) {
    // Checkpoint torches: dying sends Parfait back to the last lit one.
    if (x - lastCheckpoint > 4200 && x < safeEnd - 1500) {
      checkpoints.push({ x: x - 70 });
      lastCheckpoint = x;
    }
    const roll = r();
    if (roll < 0.18 && id > 1) {
      // Gap (pit) the player must jump over.
      const gap = 130 + Math.floor(r() * (60 + world * 15) * diff.hazards);
      ground.push({ x: groundStart, w: x - groundStart });
      coinRow(x + gap / 2 - 56, GROUND_Y - 190, 3);
      x += gap;
      groundStart = x;
      x += 260;
    } else if (roll < 0.38) {
      // Floating platforms with coins / pickups.
      const n = 2 + Math.floor(r() * 3);
      const high = r() < 0.5;
      const y = GROUND_Y - (high ? 280 : 160);
      const w = 90 * n + 60;
      // A jump clears ~200px, so a high ledge always gets a stepping stone.
      if (high) {
        platforms.push({ x, y: GROUND_Y - 150, w: 170 });
        coinRow(x + 30, GROUND_Y - 200, 2);
        x += 220;
      }
      platforms.push({ x, y, w });
      coinRow(x + 30, y - 50, Math.floor(w / 60));
      if (r() < 0.4) pickups.push({ type: r() < 0.5 ? 'gem' : 'fragment', x: x + w / 2, y: y - 110 });
      if (r() < 0.35 && y > GROUND_Y - 300) {
        platforms.push({ x: x + w + 80, y: y - 120, w: 210 });
        coinRow(x + w + 110, y - 170, 3);
      }
      x += w + 220;
    } else if (roll < 0.52) {
      // Crates (breakable, may hide coins) and the odd explosive barrel.
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const kind = r() < 0.5 ? 'crate' : 'cardboard';
        crates.push({ kind, x: x + i * 78, y: GROUND_Y - 74, w: 74, h: 74 });
      }
      if (r() < 0.45) crates.push({ kind: 'barrel_explosive', x: x + n * 78 + 40, y: GROUND_Y - 86, w: 62, h: 86 });
      x += n * 78 + 260;
    } else if (roll < 0.52 + 0.12 * diff.hazards && id > 2) {
      const w = r() < diff.hazards - 0.6 ? 240 : 150;
      hazards.push({ type: 'spikes', x, y: GROUND_Y - 34, w, h: 34 });
      coinRow(x - 10, GROUND_Y - 170, 3);
      x += 420;
    } else {
      // Enemy encounter.
      // Groups grow with the difficulty and as the adventure goes on.
      if (x - lastEnemyX > diff.enemyGap) {
        const pool = ENEMIES_BY_WORLD[world];
        const max = Math.min(diff.group + (id > 10 ? 1 : 0), id <= 2 ? 2 : 4);
        const n = 1 + Math.floor(r() * max);
        for (let i = 0; i < n; i++) {
          const type = pool[Math.floor(r() * pool.length)];
          enemies.push({ type, x: x + 160 + i * 170, patrol: 160 + r() * 160 });
        }
        lastEnemyX = x + (n - 1) * 170;
        if (r() < diff.hearts) pickups.push({ type: 'heart', x: x + 420 + n * 170, y: GROUND_Y - 50 });
        x += (n - 1) * 170;
      }
      x += 560;
    }
    if (r() < 0.5) decor.push({ item: `deco_${Math.floor(r() * 8)}`, x: x - 120 - r() * 200, tile: true });
    if (r() < 0.15) decor.push({ item: r() < 0.5 ? 'rock_small' : 'rock_medium', x: x - 200 });
  }

  ground.push({ x: groundStart, w: length - groundStart + 400 });

  let chestX = length - 260;
  if (boss) {
    const arena = length - 1500;
    decor.push({ item: 'torch', x: arena + 80, wall: true });
    decor.push({ item: 'torch', x: arena + 1250, wall: true });
    enemies.push({ type: boss === 'kernel' ? 'kernel' : 'brute', x: arena + 900, patrol: 300, boss: true });
    pickups.push({ type: 'heart', x: arena - 120, y: GROUND_Y - 50 });
    pickups.push({ type: 'fragment', x: arena - 40, y: GROUND_Y - 50 });
    chestX = length - 220;
  }

  return {
    length,
    ground,
    platforms,
    checkpoints,
    crates,
    hazards,
    enemies,
    pickups,
    decor,
    chest: { x: chestX, great: id === 20 },
    boss,
    spawn: { x: 380, y: GROUND_Y },
  };
}
