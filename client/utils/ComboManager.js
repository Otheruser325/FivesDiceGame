const COMBO_TEXT_COLORS = {
  triple: '#ffdd44',        // Yellow
  fourOfAKind: '#d14e37ff',   // Lavender-red
  fullHouse: '#ff66cc',     // Pink
  straight: '#1f7a3a',      // Dark green
  pair: '#dddddd',          // Slightly dark white
  twoPair: '#dddddd',       // Slightly dark white
  fiveOfAKind: '#ffffff'    // Rainbow handled dynamically
};

const RAINBOW_COLORS = [
  0xff3333, // red
  0xffcc33, // yellow
  0x33ff66, // green
  0x33ffff, // cyan
  0x3366ff, // blue
  0xcc33ff  // magenta
];

export function showComboText(scene, comboName, intensity = 1) {
  const settings = scene?.registry?.get('settings') ?? { visualEffects: true };

  const comboKey =
    comboName.includes('FIVE OF A KIND') ? 'fiveOfAKind' :
    comboName.includes('FOUR') ? 'fourOfAKind' :
    comboName.includes('FULL HOUSE') ? 'fullHouse' :
    comboName.includes('TRIPLE') ? 'triple' :
    comboName.includes('STRAIGHT') ? 'straight' :
    comboName.includes('TWO PAIR') ? 'twoPair' :
    comboName.includes('PAIR') ? 'pair' :
    null;

  const baseColor = COMBO_TEXT_COLORS[comboKey] ?? '#ffffff';
  const isRainbow = comboKey === 'fiveOfAKind';

  if (settings.visualEffects === false) {
    const simple = scene.add.text(600, 200, comboName, {
      fontSize: 40 * Math.max(0.8, intensity),
      fontStyle: 'bold',
      color: baseColor
    }).setOrigin(0.5);

    scene.time.delayedCall(1200, () => simple.destroy());
    return;
  }

  const text = scene.add.text(600, 200, comboName, {
    fontSize: 48 * intensity,
    fontStyle: 'bold',
    color: baseColor,
    stroke: isRainbow ? '#000000' : null,
    strokeThickness: isRainbow ? 8 : 0
  }).setOrigin(0.5);

  text.setAngle(-5);

  let alive = true;
  text.once(Phaser.GameObjects.Events.DESTROY, () => {
    alive = false;
    scene.tweens.killTweensOf(text);
  });

  // 🌈 Rainbow polish (Five of a Kind only)
  if (isRainbow) {
    scene.tweens.addCounter({
      from: 0,
      to: 360,
      duration: 1400,
      repeat: -1,
      onUpdate: tween => {
        if (!alive) return;
        const c = Phaser.Display.Color.HSLToColor(tween.getValue() / 360, 1, 0.6);
        text.setColor(
          Phaser.Display.Color.RGBToString(c.r, c.g, c.b, 255, '#')
        );
      }
    });

    scene.tweens.add({
      targets: text,
      strokeThickness: { from: 10, to: 6 },
      duration: 400,
      yoyo: true,
      repeat: -1
    });

    scene.tweens.add({
      targets: text,
      scale: { from: 1.35, to: 1.05 },
      duration: 280,
      yoyo: true,
      repeat: -1
    });
  }

  // Exit motion
  scene.tweens.add({
    targets: text,
    y: 150,
    alpha: 0,
    angle: 5,
    duration: isRainbow ? 1200 : 800,
    ease: 'Cubic.easeOut',
    onComplete: () => alive && text.destroy()
  });
}

export function comboFlash(scene, color, duration = 500, alpha = 0.5, additive = false) {
  const settings = scene?.registry?.get('settings') ?? { visualEffects: true };
  if (!scene || settings.visualEffects === false) return;

  const dur = Math.max(120, duration | 0);
  const isRainbow = color === 'RAINBOW';

  try {
    const overlay = scene.add.rectangle(
      scene.scale.width / 2,
      scene.scale.height / 2,
      scene.scale.width,
      scene.scale.height,
      isRainbow ? RAINBOW_COLORS[0] : color,
      0
    ).setDepth(9999);

    if (additive) overlay.setBlendMode(Phaser.BlendModes.ADD);

    let alive = true;
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => alive = false);

    // 🌈 Smooth overlay rainbow cycling
    if (isRainbow) {
      scene.tweens.addCounter({
        from: 0,
        to: RAINBOW_COLORS.length,
        duration: dur,
        onUpdate: tween => {
          if (!alive) return;
          overlay.fillColor =
            RAINBOW_COLORS[Math.floor(tween.getValue()) % RAINBOW_COLORS.length];
        }
      });

      // 🌈 DISCRETE rainbow camera flashes (SAFE)
      const flashCount = 6;
      const flashInterval = Math.floor(dur / flashCount);

      for (let i = 0; i < flashCount; i++) {
        scene.time.delayedCall(i * flashInterval, () => {
          if (!alive) return;
          const c = Phaser.Display.Color.IntegerToRGB(
            RAINBOW_COLORS[i % RAINBOW_COLORS.length]
          );
          scene.cameras.main.flash(
            90,
            c.r,
            c.g,
            c.b,
            true
          );
        });
      }
    } else {
      // Normal single flash
      const rgb = Phaser.Display.Color.IntegerToRGB(color);
      scene.cameras.main.flash(
        Math.max(80, Math.floor(dur * 0.28)),
        rgb.r,
        rgb.g,
        rgb.b,
        true
      );
    }

    // Overlay alpha punch
    scene.tweens.add({
      targets: overlay,
      alpha: alpha,
      duration: Math.max(60, Math.floor(dur * 0.35)),
      yoyo: true,
      hold: Math.max(40, Math.floor(dur * 0.25)),
      onComplete: () => alive && overlay.destroy()
    });

  } catch {
    try { scene.cameras.main.flash(120); } catch (_) {}
  }
}

export function comboShake(scene, magnitude = 5, duration = 300) {
    const settings = (scene && scene.registry && scene.registry.get('settings')) || { visualEffects: true };
    if (settings.visualEffects === false) return;
    scene.cameras.main.shake(duration, magnitude / 100);
}

export function playComboFX(scene, comboName) {
    const settings = (scene && scene.registry && scene.registry.get('settings')) || { visualEffects: true };
    if (settings.visualEffects === false) return;
    switch (comboName) {

        case "triple":
            comboFlash(scene, 0xD4D45B, 600, 0.45, false);  // olive-yellow
            comboShake(scene, 4, 400);
            break;

        case "fourOfAKind":
            comboFlash(scene, 0x550000, 1000, 0.55, false); // deep maroon
            comboShake(scene, 8, 600);
            break;

        case "fiveOfAKind":
            comboFlash(scene, 'RAINBOW', 1500, 0.75, true); // rainbow handled inside ComboText glow
            comboShake(scene, 12, 1000); // DiceQuake™
            break;

        case "fullHouse":
            comboFlash(scene, 0xAA11BB, 800, 0.6, false); // magenta-purple
            comboShake(scene, 6, 500);
            break;

        case "straight":
            comboFlash(scene, 0x228833, 600, 0.4, false); // Light green flash (darker for large)
            comboShake(scene, 3, 300);
            break;

        case "twoPair":
            comboShake(scene, 1, 200);
            break;

        default:
            break;
    }
}

export function checkCombo(values) {
    // Count occurrences
    const count = {};
    for (let v of values) {
        count[v] = (count[v] || 0) + 1;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const unique = [...new Set(sorted)];
    const occurrences = Object.values(count);

    // ----- LARGE STRAIGHT -----
    const large1 = [1, 2, 3, 4, 5];
    const large2 = [2, 3, 4, 5, 6];

    if (JSON.stringify(unique) === JSON.stringify(large1) ||
        JSON.stringify(unique) === JSON.stringify(large2)) {
        return { type: "STRAIGHT!", key: "straight", multiplier: 3, intensity: 1.4 };
    }

    // ----- SMALL STRAIGHT (4-in-a-row inside unique values) -----
    if (unique.length >= 4) {
        for (let i = 0; i < unique.length - 3; i++) {
            if (unique[i] + 1 === unique[i + 1] &&
                unique[i] + 2 === unique[i + 2] &&
                unique[i] + 3 === unique[i + 3]) {
                return { type: "STRAIGHT!", key: "straight", multiplier: 2.5, intensity: 1.2 };
            }
        }
    }

    // ----- FIVE OF A KIND -----
    if (occurrences.includes(5)) {
        return { type: "FIVE OF A KIND?!!?!", key: "fiveOfAKind", multiplier: 10, intensity: 1.8 };
    }

    // ----- FOUR OF A KIND -----
    if (occurrences.includes(4)) {
        return { type: "FOUR OF A KIND!!!!", key: "fourOfAKind", multiplier: 5, intensity: 1.5 };
    }

    // ----- FULL HOUSE -----
    if (occurrences.includes(3) && occurrences.includes(2)) {
        return { type: "FULL HOUSE!!!", key: "fullHouse", multiplier: 4, intensity: 1.4 };
    }

    // ----- THREE OF A KIND -----
    if (occurrences.includes(3)) {
        return { type: "TRIPLE!", key: "triple", multiplier: 3, intensity: 1.2 };
    }
	
	// ----- TWO PAIR -----
    const pairs = occurrences.filter(c => c === 2).length;
    if (pairs === 2) {
        return { type: "TWO PAIR!", key: "twoPair", multiplier: 2, intensity: 1.1 };
    }

    // ----- PAIR -----
    if (occurrences.includes(2)) {
        return { type: "PAIR!", key: "pair", multiplier: 1.5, intensity: 1 };
    }

    return null;
}