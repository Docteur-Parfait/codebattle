// Unified input: keyboard (PC) and on-screen touch controls (Android).
// Game code reads `input.x` (-1..1), `input.down(key)` and `input.pressed(key)`.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', KeyZ: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump',
  KeyJ: 'punch',
  KeyK: 'kick',
  KeyL: 'special',
  KeyI: 'block', ShiftLeft: 'block',
  KeyC: 'stealth',
  KeyE: 'interact', Enter: 'interact',
  Escape: 'pause', KeyP: 'pause',
};

class Input {
  constructor() {
    this.held = new Set();
    this.justPressed = new Set();
    this.stickX = 0;
    this.stickY = 0;
    this.touchMode = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (!this.held.has(k)) this.justPressed.add(k);
      this.held.add(k);
    });
    addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.held.delete(k);
    });
    addEventListener('blur', () => this.held.clear());
  }

  get x() {
    let x = this.stickX;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    return Math.max(-1, Math.min(1, x));
  }

  get y() {
    let y = this.stickY;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    return Math.max(-1, Math.min(1, y));
  }

  down(k) { return this.held.has(k); }
  pressed(k) { return this.justPressed.has(k); }

  /** Call once per frame after the game has read its input. */
  endFrame() { this.justPressed.clear(); }

  press(k) { if (!this.held.has(k)) this.justPressed.add(k); this.held.add(k); }
  release(k) { this.held.delete(k); }

  /** Wire the touch overlay (joystick + buttons). uiStyle(el, name) skins a button. */
  bindTouch(root, uiStyle) {
    this.touchMode = true;
    root.classList.remove('hidden');
    root.querySelectorAll('[data-ui]').forEach((el) => uiStyle(el, el.dataset.ui));

    root.querySelectorAll('.tbtn').forEach((el) => {
      const k = el.dataset.key;
      const on = (e) => { e.preventDefault(); el.classList.add('pressed'); this.press(k); };
      const off = (e) => { e.preventDefault(); el.classList.remove('pressed'); this.release(k); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });

    const stick = root.querySelector('#joystick');
    const knob = root.querySelector('#joystick-knob');
    uiStyle(stick, 'joystick');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2);
      let dy = (e.clientY - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.stickX = Math.abs(dx) < 0.15 ? 0 : dx;
      this.stickY = Math.abs(dy) < 0.35 ? 0 : dy;
      knob.style.transform = `translate(${dx * 50}px, ${dy * 50}px)`;
      if (dy < -0.7) this.press('jump'); else this.release('jump');
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stickX = this.stickY = 0;
      knob.style.transform = '';
      this.release('jump');
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }
}

export const input = new Input();
