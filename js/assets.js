// Loads every image and data file the game needs, with progress reporting.

export const assets = {
  img: {},      // name -> HTMLImageElement
  atlas: null,  // character sprite atlas (assets/build/atlas.json)
  env: null,    // named rectangles in environment sheets (assets/build/env.json)
  levels: null, // world/level definitions (assets/levels/levels.json)
};

const WORLD_KEYS = ['w1_jungle', 'w2_desert', 'w3_neocity', 'w4_caverns', 'w5_vault'];

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null); // a missing optional image must not block the game
    im.src = src;
  });
}

async function loadJSON(src) {
  const r = await fetch(src);
  if (!r.ok) throw new Error(`${src}: ${r.status}`);
  return r.json();
}

export async function loadAll(onProgress) {
  const [atlas, env, levels] = await Promise.all([
    loadJSON('assets/build/atlas.json'),
    loadJSON('assets/build/env.json'),
    loadJSON('assets/levels/levels.json'),
  ]);
  Object.assign(assets, { atlas, env, levels });
  // The great chest is bigger than the chest drawn into open_chest's middle
  // frames, so at the last level Parfait only kneels and takes the treasure.
  const oc = atlas.parfait.anims.open_chest;
  atlas.parfait.anims.open_great = [oc[0], oc[5]];

  const jobs = {};
  for (const [name, a] of Object.entries(atlas)) jobs[`char_${name}`] = a.image;
  for (const [name, e] of Object.entries(env)) jobs[name] = e.image;
  WORLD_KEYS.forEach((k, i) => {
    jobs[`bg_${i + 1}`] = `assets/environment/${k}_bg.png`;
    jobs[`mid_${i + 1}`] = `assets/environment/${k}_mid.png`;
  });

  const entries = Object.entries(jobs);
  let done = 0;
  await Promise.all(entries.map(async ([name, src]) => {
    assets.img[name] = await loadImage(src);
    done += 1;
    onProgress?.(done / entries.length);
  }));
}

/** Frames of one character animation: [x, y, w, h, anchorX, anchorY][] */
export function frames(char, anim) {
  return assets.atlas[char]?.anims[anim] || null;
}

/** Draw a named rectangle of an environment sheet. */
export function drawEnv(ctx, sheet, item, x, y, w, h) {
  const e = assets.env[sheet];
  const r = e?.items[item];
  const im = assets.img[sheet];
  if (!r || !im) return;
  ctx.drawImage(im, r[0], r[1], r[2], r[3], x, y, w ?? r[2], h ?? r[3]);
}

export function envRect(sheet, item) {
  return assets.env[sheet]?.items[item];
}
