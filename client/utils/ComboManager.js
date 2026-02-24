const COMBO_TEXT_COLORS = {
  triple: '#ffdd44',
  fourOfAKind: '#d14e37ff',
  fullHouse: '#ff66cc',
  straight: '#1f7a3a',
  pair: '#dddddd',
  twoPair: '#dddddd',
  fiveOfAKind: '#ffffff'
};

const RAINBOW_COLORS = [
  0xff3333,
  0xffcc33,
  0x33ff66,
  0x33ffff,
  0x3366ff,
  0xcc33ff
];

export default class ComboManager {
  static showComboText(scene, comboName, intensity = 1, comboKeyOverride = null) {
    const settings = scene?.registry?.get('settings') ?? { visualEffects: true };

    const safeName = String(comboName || '');
    const resolvedKey = comboKeyOverride || (
      safeName.includes('FIVE OF A KIND') ? 'fiveOfAKind' :
      safeName.includes('FOUR') ? 'fourOfAKind' :
      safeName.includes('FULL HOUSE') ? 'fullHouse' :
      safeName.includes('TRIPLE') ? 'triple' :
      safeName.includes('STRAIGHT') ? 'straight' :
      safeName.includes('TWO PAIR') ? 'twoPair' :
      safeName.includes('PAIR') ? 'pair' :
      null
    );

    const baseColor = COMBO_TEXT_COLORS[resolvedKey] ?? '#ffffff';
    const isRainbow = resolvedKey === 'fiveOfAKind';

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

    if (isRainbow) {
      scene.tweens.addCounter({
        from: 0,
        to: 360,
        duration: 1400,
        repeat: -1,
        onUpdate: (tween) => {
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

  static comboFlash(scene, color, duration = 500, alpha = 0.5, additive = false) {
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
      overlay.once(Phaser.GameObjects.Events.DESTROY, () => { alive = false; });

      if (isRainbow) {
        scene.tweens.addCounter({
          from: 0,
          to: RAINBOW_COLORS.length,
          duration: dur,
          onUpdate: (tween) => {
            if (!alive) return;
            overlay.fillColor =
              RAINBOW_COLORS[Math.floor(tween.getValue()) % RAINBOW_COLORS.length];
          }
        });

        const flashCount = 6;
        const flashInterval = Math.floor(dur / flashCount);

        for (let i = 0; i < flashCount; i++) {
          scene.time.delayedCall(i * flashInterval, () => {
            if (!alive) return;
            const c = Phaser.Display.Color.IntegerToRGB(
              RAINBOW_COLORS[i % RAINBOW_COLORS.length]
            );
            scene.cameras.main.flash(90, c.r, c.g, c.b, true);
          });
        }
      } else {
        const rgb = Phaser.Display.Color.IntegerToRGB(color);
        scene.cameras.main.flash(
          Math.max(80, Math.floor(dur * 0.28)),
          rgb.r,
          rgb.g,
          rgb.b,
          true
        );
      }

      scene.tweens.add({
        targets: overlay,
        alpha,
        duration: Math.max(60, Math.floor(dur * 0.35)),
        yoyo: true,
        hold: Math.max(40, Math.floor(dur * 0.25)),
        onComplete: () => alive && overlay.destroy()
      });
    } catch {
      try { scene.cameras.main.flash(120); } catch (_) {}
    }
  }

  static comboShake(scene, magnitude = 5, duration = 300) {
    const settings = scene?.registry?.get('settings') ?? { visualEffects: true };
    if (settings.visualEffects === false) return;
    scene.cameras.main.shake(duration, magnitude / 100);
  }

  static playComboFX(scene, comboName) {
    const settings = scene?.registry?.get('settings') ?? { visualEffects: true };
    if (settings.visualEffects === false) return;

    switch (comboName) {
      case 'triple':
        this.comboFlash(scene, 0xD4D45B, 600, 0.45, false);
        this.comboShake(scene, 4, 400);
        break;
      case 'fourOfAKind':
        this.comboFlash(scene, 0x550000, 1000, 0.55, false);
        this.comboShake(scene, 8, 600);
        break;
      case 'fiveOfAKind':
        this.comboFlash(scene, 'RAINBOW', 1500, 0.75, true);
        this.comboShake(scene, 12, 1000);
        break;
      case 'fullHouse':
        this.comboFlash(scene, 0xAA11BB, 800, 0.6, false);
        this.comboShake(scene, 6, 500);
        break;
      case 'straight':
        this.comboFlash(scene, 0x228833, 600, 0.4, false);
        this.comboShake(scene, 3, 300);
        break;
      case 'twoPair':
        this.comboShake(scene, 1, 200);
        break;
      default:
        break;
    }
  }

  static checkCombo(values) {
    const count = {};
    for (const v of values) {
      count[v] = (count[v] || 0) + 1;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const unique = [...new Set(sorted)];
    const occurrences = Object.values(count);

    const large1 = [1, 2, 3, 4, 5];
    const large2 = [2, 3, 4, 5, 6];

    if (JSON.stringify(unique) === JSON.stringify(large1) ||
        JSON.stringify(unique) === JSON.stringify(large2)) {
      return { type: 'STRAIGHT!', key: 'straight', multiplier: 3, intensity: 1.4 };
    }

    if (unique.length >= 4) {
      for (let i = 0; i < unique.length - 3; i++) {
        if (unique[i] + 1 === unique[i + 1] &&
            unique[i] + 2 === unique[i + 2] &&
            unique[i] + 3 === unique[i + 3]) {
          return { type: 'STRAIGHT!', key: 'straight', multiplier: 2.5, intensity: 1.2 };
        }
      }
    }

    if (occurrences.includes(5)) {
      return { type: 'FIVE OF A KIND?!!?!', key: 'fiveOfAKind', multiplier: 10, intensity: 1.8 };
    }

    if (occurrences.includes(4)) {
      return { type: 'FOUR OF A KIND!!!!', key: 'fourOfAKind', multiplier: 5, intensity: 1.5 };
    }

    if (occurrences.includes(3) && occurrences.includes(2)) {
      return { type: 'FULL HOUSE!!!', key: 'fullHouse', multiplier: 4, intensity: 1.4 };
    }

    if (occurrences.includes(3)) {
      return { type: 'TRIPLE!', key: 'triple', multiplier: 3, intensity: 1.2 };
    }

    const pairs = occurrences.filter((c) => c === 2).length;
    if (pairs === 2) {
      return { type: 'TWO PAIR!', key: 'twoPair', multiplier: 2, intensity: 1.1 };
    }

    if (occurrences.includes(2)) {
      return { type: 'PAIR!', key: 'pair', multiplier: 1.5, intensity: 1 };
    }

    return null;
  }
}
