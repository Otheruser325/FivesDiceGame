export function checkCombo(values) {
  const count = {};
  for (const v of values || []) {
    count[v] = (count[v] || 0) + 1;
  }

  const sorted = [...(values || [])].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  const occurrences = Object.values(count);

  // Large straight
  const large1 = [1, 2, 3, 4, 5];
  const large2 = [2, 3, 4, 5, 6];
  if (JSON.stringify(unique) === JSON.stringify(large1) ||
      JSON.stringify(unique) === JSON.stringify(large2)) {
    return { type: "STRAIGHT!", key: "straight", multiplier: 3, intensity: 1.4 };
  }

  // Small straight (4-in-a-row)
  if (unique.length >= 4) {
    for (let i = 0; i < unique.length - 3; i++) {
      if (unique[i] + 1 === unique[i + 1] &&
          unique[i] + 2 === unique[i + 2] &&
          unique[i] + 3 === unique[i + 3]) {
        return { type: "STRAIGHT!", key: "straight", multiplier: 2.5, intensity: 1.2 };
      }
    }
  }

  // Five of a kind
  if (occurrences.includes(5)) {
    return { type: "FIVE OF A KIND?!!?!", key: "fiveOfAKind", multiplier: 10, intensity: 1.8 };
  }

  // Four of a kind
  if (occurrences.includes(4)) {
    return { type: "FOUR OF A KIND!!!!", key: "fourOfAKind", multiplier: 5, intensity: 1.5 };
  }

  // Full house
  if (occurrences.includes(3) && occurrences.includes(2)) {
    return { type: "FULL HOUSE!!!", key: "fullHouse", multiplier: 4, intensity: 1.4 };
  }

  // Three of a kind
  if (occurrences.includes(3)) {
    return { type: "TRIPLE!", key: "triple", multiplier: 3, intensity: 1.2 };
  }

  // Two pair
  const pairs = occurrences.filter(c => c === 2).length;
  if (pairs === 2) {
    return { type: "TWO PAIR!", key: "twoPair", multiplier: 2, intensity: 1.1 };
  }

  // Pair
  if (occurrences.includes(2)) {
    return { type: "PAIR!", key: "pair", multiplier: 1.5, intensity: 1 };
  }

  return null;
}
