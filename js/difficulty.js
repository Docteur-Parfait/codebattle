// Difficulty presets, chosen on the title screen and saved with the progress.
// hp/dmg scale enemy health and the damage Parfait takes; cool scales the pause
// between enemy attacks; length/enemyGap/group shape the generated levels.

export const DIFFICULTIES = {
  facile: {
    label: 'Facile', hp: 0.8, dmg: 0.6, cool: 1.35, sight: 0.85,
    length: 1.0, enemyGap: 620, group: 1, hearts: 0.35, hazards: 0.7,
  },
  normal: {
    label: 'Normal', hp: 1.25, dmg: 1.15, cool: 0.85, sight: 1.0,
    length: 1.3, enemyGap: 430, group: 2, hearts: 0.2, hazards: 1.0,
  },
  difficile: {
    label: 'Difficile', hp: 1.7, dmg: 1.7, cool: 0.65, sight: 1.25,
    length: 1.55, enemyGap: 330, group: 3, hearts: 0.1, hazards: 1.3,
  },
};

export function difficulty(key) {
  return DIFFICULTIES[key] || DIFFICULTIES.normal;
}
