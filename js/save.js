// Progress saved in localStorage: unlocked level, stars per level, coins.

const KEY = 'codebattle.save.v1';

const fresh = () => ({ unlocked: 1, stars: {}, coins: 0, introSeen: false, difficulty: 'normal' });

function read() {
  try {
    return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return fresh();
  }
}

export const save = {
  data: read(),

  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  },

  isUnlocked(level) { return level <= this.data.unlocked; },

  /** Record a finished level; unlocks the next one. */
  complete(level, stars, coins) {
    const d = this.data;
    d.stars[level] = Math.max(d.stars[level] || 0, stars);
    d.unlocked = Math.max(d.unlocked, Math.min(level + 1, 20));
    d.coins += coins;
    this.write();
  },
};
