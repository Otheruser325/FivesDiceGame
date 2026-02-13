import { checkCombo } from './ComboManager.js';

export function rollDice(count = 5, sides = 6) {
  const safeCount = Math.max(0, count | 0);
  const safeSides = Math.max(2, sides | 0);
  return Array.from({ length: safeCount }, () => Math.floor(Math.random() * safeSides) + 1);
}

export function getBaseScore(dice = [], multiplexEnabled = false) {
  if (!Array.isArray(dice) || dice.length === 0) return 0;
  if (multiplexEnabled) {
    return dice.reduce((acc, val) => acc * val, 1);
  }
  return dice.reduce((a, b) => a + b, 0);
}

export function calculateScore(dice = [], combosEnabled = false, multiplexEnabled = false) {
  const base = getBaseScore(dice, multiplexEnabled);
  const combo = checkCombo(dice);
  const points = (combo && combosEnabled) ? Math.floor(base * (combo.multiplier || 1)) : base;
  return { points, combo };
}

export function applyBonus(dice = [], baseScore = 0, combosEnabled = false) {
  if (!combosEnabled) return baseScore;
  const combo = checkCombo(dice);
  if (!combo) return baseScore;
  return Math.floor(baseScore * (combo.multiplier || 1));
}
