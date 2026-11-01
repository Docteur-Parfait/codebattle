import { assets, loadAll, envRect } from './assets.js';
import { input } from './input.js';
import { save } from './save.js';
import { Game, W, H, setViewWidth } from './game.js';
import { difficulty } from './difficulty.js';
import * as audio from './audio.js';
import * as gate from './install.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const touchRoot = $('#touch');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let game = null;
let mode = 'menu'; // menu | play | pause | result
let currentLevel = 1;
let mapWorld = 1;

/* ---------------- layout ---------------- */
function fit() {
  // keep 720 px of height and widen the view to the screen's shape (16:9 up
  // to ~21:9), so Android phones are filled edge to edge
  const w = Math.round(Math.min(1720, Math.max(1280, H * innerWidth / innerHeight)));
  if (w !== W) {
    setViewWidth(w);
    canvas.width = w;
    stage.style.width = `${w}px`;
  }
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${-W / 2 * s}px, ${-H / 2 * s}px) scale(${s})`;
}
addEventListener('resize', fit);
fit();

function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  // menus keep the music low; gameplay brings it back up
  audio.duckMusic(id !== null);
  touchRoot.classList.toggle('hidden', !(isTouch && id === null));
  $('#btn-menu').classList.toggle('hidden', id !== null || !game);
}

const toastEl = document.createElement('div');
toastEl.id = 'toast';
stage.appendChild(toastEl);
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ---------------- ui_kit skins for touch buttons ---------------- */
const skinCache = {};
function uiStyle(el, name) {
  if (!skinCache[name]) {
    const r = envRect('ui_kit', name);
    const im = assets.img.ui_kit;
    if (!r || !im) return;
    const c = document.createElement('canvas');
    c.width = r[2];
    c.height = r[3];
    c.getContext('2d').drawImage(im, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
    skinCache[name] = c.toDataURL();
  }
  el.style.backgroundImage = `url(${skinCache[name]})`;
  el.style.backgroundSize = 'contain';
  el.style.backgroundPosition = 'center';
}

/* ---------------- cinematics ---------------- */
const video = $('#cinematic');
const btnSkip = $('#btn-skip');
const btnVideoPlay = $('#btn-video-play');
let afterVideo = null;

function playVideo(src, then) {
  afterVideo = then;
  show('screen-video');
  btnVideoPlay.classList.add('hidden');
  btnSkip.classList.remove('hidden');
  video.onerror = () => endVideo(); // video not generated yet: carry on
  video.src = `assets/${src}`;
  video.muted = false;
  video.play().catch(() => { video.muted = true; video.play().catch(() => endVideo()); });
}

function endVideo() {
  video.pause();
  const then = afterVideo;
  afterVideo = null;
  then?.();
}

video.addEventListener('ended', () => {
  btnSkip.classList.add('hidden');
  btnVideoPlay.classList.remove('hidden');
});
btnSkip.addEventListener('click', endVideo);
btnVideoPlay.addEventListener('click', endVideo);

/* ---------------- level map ---------------- */
function levelDef(id) { return assets.levels.levels.find((l) => l.id === id); }

function openMap(world) {
  mode = 'menu';
  game = null;
  const unlockedWorld = levelDef(save.data.unlocked).world;
  mapWorld = world || Math.min(unlockedWorld, levelDef(Math.min(currentLevel, 20)).world) || 1;
  const w = assets.levels.worlds[mapWorld - 1];
  $('#screen-map').style.backgroundImage = `url(assets/${w.background})`;
  $('#map-world-name').textContent = `Monde ${w.id} — ${w.name} · ${difficulty(save.data.difficulty).label}`;
  $('#map-coins').textContent = save.data.coins;

  const tabs = $('#world-tabs');
  tabs.innerHTML = '';
  for (const wd of assets.levels.worlds) {
    const b = document.createElement('button');
    const locked = wd.id > unlockedWorld;
    b.className = `world-tab${wd.id === mapWorld ? ' active' : ''}${locked ? ' locked' : ''}`;
    b.textContent = `${locked ? '🔒 ' : ''}${wd.id}. ${wd.name}`;
    b.onclick = () => openMap(wd.id);
    tabs.appendChild(b);
  }

  const grid = $('#level-grid');
  grid.innerHTML = '';
  for (const def of assets.levels.levels.filter((l) => l.world === mapWorld)) {
    const unlocked = save.isUnlocked(def.id);
    const stars = save.data.stars[def.id] || 0;
    const card = document.createElement('button');
    card.className = `level-card ${unlocked ? 'unlocked' : 'locked'}${def.id === save.data.unlocked ? ' current' : ''}${def.boss ? ' boss' : ''}`;
    const img = document.createElement('img');
    img.alt = def.name;
    img.onerror = () => { img.onerror = null; img.src = `assets/${w.background}`; };
    img.src = `assets/${def.thumb}`;
    card.appendChild(img);
    card.insertAdjacentHTML('beforeend', `
      ${unlocked ? '' : '<div class="lock">🔒</div>'}
      ${unlocked && stars ? `<div class="card-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>` : ''}
      <div class="info"><div class="num">Niveau ${def.id}</div><div class="name">${def.name}</div></div>`);
    card.onclick = () => (unlocked ? startLevel(def.id) : toast('Termine le niveau précédent pour débloquer celui-ci'));
    grid.appendChild(card);
  }
  show('screen-map');
}

/* ---------------- game flow ---------------- */
function startLevel(id) {
  currentLevel = id;
  const def = levelDef(id);
  game = new Game(ctx, def, {
    toast,
    onComplete: (r) => onComplete(def, r),
    onDeath: () => onDeath(),
    sfx: audio.sfx,
    music: audio.setMusic,
  }, difficulty(save.data.difficulty));
  audio.setMusic(def.world);
  mode = 'play';
  show(null);
  toast(`Niveau ${def.id} — ${def.name}`);
}

function onComplete(def, r) {
  save.complete(def.id, r.stars, r.coins);
  audio.sfx('fanfare');
  mode = 'result';
  $('#result-title').textContent = def.id === 20 ? 'Le Grand Trésor est à toi !' : 'Trésor trouvé !';
  $('#result-stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= r.stars ? '' : 'off'}">★</span>`).join('');
  const t = Math.round(r.time);
  $('#result-detail').textContent = `${r.coins} pièces · ${r.kills} ennemis vaincus · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const next = $('#result-next');
  next.classList.remove('hidden');
  next.textContent = def.id === 20 ? 'Voir la fin ▶' : def.cinematicAfter ? 'Continuer ▶' : 'Niveau suivant';
  show('screen-result');
}

function onDeath() {
  if (mode !== 'play') return;
  mode = 'result';
  audio.sfx('gameover');
  $('#result-title').textContent = 'Parfait est tombé…';
  $('#result-stars').innerHTML = '';
  $('#result-detail').textContent = 'Réessaie : utilise la garde (I) et le mode furtif (C) pour surprendre les gardes.';
  $('#result-next').classList.add('hidden');
  show('screen-result');
}

function goNext() {
  const def = levelDef(currentLevel);
  const go = currentLevel >= 20 ? () => openMap() : () => startLevel(currentLevel + 1);
  if (def.cinematicAfter) playVideo(def.cinematicAfter, go);
  else go();
}

const actions = {
  install: () => gate.install(),
  play: () => {
    if (!save.data.introSeen) {
      save.data.introSeen = true;
      save.write();
      playVideo(assets.levels.introCinematic, () => openMap(1));
    } else openMap();
  },
  intro: () => playVideo(assets.levels.introCinematic, () => show('screen-title')),
  title: () => show('screen-title'),
  map: () => openMap(),
  resume: () => { mode = 'play'; show(null); },
  pause: () => {
    if (mode !== 'play') return;
    mode = 'pause';
    show('screen-pause');
  },
  restart: () => startLevel(currentLevel),
  next: goNext,
  toggleMusic: () => { audio.setPref('music', !audio.getPrefs().music); soundLabels(); },
  toggleSfx: () => { audio.setPref('sfx', !audio.getPrefs().sfx); soundLabels(); },
};

function soundLabels() {
  const p = audio.getPrefs();
  $('#btn-music').textContent = `Musique : ${p.music ? 'ON' : 'OFF'}`;
  $('#btn-sfx').textContent = `Bruitages : ${p.sfx ? 'ON' : 'OFF'}`;
}
soundLabels();

// audio may only start after a user gesture
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(ev, () => {
    audio.unlock();
    if (!game) audio.setMusic(1);
  }, { once: true, capture: true });
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) { audio.sfx('click'); actions[a.dataset.action]?.(); }
  const d = e.target.closest('[data-diff]');
  if (d) {
    save.data.difficulty = d.dataset.diff;
    save.write();
    showDifficulty();
  }
});

function showDifficulty() {
  document.querySelectorAll('[data-diff]').forEach((b) => {
    b.classList.toggle('active', b.dataset.diff === save.data.difficulty);
    b.setAttribute('aria-checked', b.dataset.diff === save.data.difficulty);
  });
}
showDifficulty();

/* ---------------- main loop ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (game) {
    if (mode === 'play') {
      if (input.pressed('pause')) {
        mode = 'pause';
        input.endFrame();
        show('screen-pause');
      } else game.update(dt);
    } else if (mode === 'pause' && input.pressed('pause')) {
      actions.resume();
    }
    if (mode !== 'play') input.endFrame();
    game.render();
  } else input.endFrame();
  requestAnimationFrame(frame);
}

/* ---------------- boot ---------------- */
// registered first: browsers only offer to install the game once it is active
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
(async () => {
  try {
    await loadAll((p) => {
      $('#loading-fill').style.width = `${Math.round(p * 100)}%`;
      $('#loading-text').textContent = `Chargement… ${Math.round(p * 100)}%`;
    });
  } catch (err) {
    $('#loading-text').textContent = `Erreur de chargement : ${err.message}`;
    throw err;
  }
  if (isTouch) {
    input.bindTouch(touchRoot, uiStyle);
    touchRoot.classList.add('hidden');
  }
  uiStyle($('#btn-menu'), 'btn_pause');
  if (gate.gateActive()) {
    // the install screen leaves the 16:9 stage and becomes a normal responsive
    // page, so phones get it in portrait too (no "rotate your phone" first)
    document.body.classList.add('gate');
    document.body.appendChild($('#screen-install'));
    gate.initGate();
    show('screen-install');
  } else show('screen-title');
  requestAnimationFrame(frame);
})();

// Test hook, only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) window.__cb = { game: () => game, startLevel, save };
