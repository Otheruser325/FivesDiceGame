export default class Dice {
  constructor(opts = {}) {
    this.faces = opts.faces ?? 6;
  }

  // ----------------
  // Core
  // ----------------

  roll() {
    return Math.ceil(Math.random() * this.faces);
  }

  rollMany(count = 5) {
    return Array.from({ length: count }, () => this.roll());
  }

  sortAsc(arr) {
    return [...arr].sort((a, b) => a - b);
  }

  orient(arr) {
    return this.shuffle(arr);
  }

  // ----------------
  // Junk / Low value
  // ----------------

  runt() {
    const patterns = [
      [1, 2, 4, 5, 6],
      [1, 2, 3, 5, 6]
    ];

    const pick = patterns[Math.floor(Math.random() * patterns.length)];
    return this.orient(pick);
  }

  pair() {
    const p = this.roll();
    const kickers = Array.from({ length: 3 }, () => this.roll());

    const combo = this.sortAsc([p, p, ...kickers]);
    return this.orient(combo);
  }

  twoPair() {
    let a = this.roll();
    let b = this.roll();
    while (b === a) b = this.roll();

    const high = Math.max(a, b);
    const low = Math.min(a, b);
    const kicker = this.roll();

    const combo = [high, high, low, low, kicker];
    return this.orient(combo);
  }

  // ----------------
  // Strong combos
  // ----------------

  triple() {
    const t = this.roll();
    const kickers = [this.roll(), this.roll()];

    const combo = this.sortAsc([t, t, t, ...kickers]);
    return this.orient(combo);
  }

  fullHouse() {
    const triple = this.roll();
    let pair = this.roll();
    while (pair === triple) pair = this.roll();

    const combo = [triple, triple, triple, pair, pair];
    return this.orient(combo);
  }

  fourOfAKind() {
    const quad = this.roll();
    const kicker = this.roll();

    const combo = [quad, quad, quad, quad, kicker];
    return this.orient(combo);
  }

  fiveOfAKind() {
    const a = this.roll();
    return [a, a, a, a, a];
  }

  // ----------------
  // Straights
  // ----------------

  smallStraight() {
    const starts = [1, 2, 3];
    const s = starts[Math.floor(Math.random() * starts.length)];
    const straight = [s, s + 1, s + 2, s + 3];

    let kicker = this.roll();
    while (straight.includes(kicker)) kicker = this.roll();

    const combo = this.sortAsc([...straight, kicker]);
    return this.orient(combo);
  }

  largeStraight() {
    const combo =
      Math.random() < 0.5
        ? [1, 2, 3, 4, 5]
        : [2, 3, 4, 5, 6];

    return this.orient(combo);
  }

  // ----------------
  // Utility
  // ----------------

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}