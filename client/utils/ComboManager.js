export function showComboText(comboName, intensity = 1) {

    // RAINBOW FIVE-OF-A-KIND EFFECT
    const isRainbow = comboName.includes("FIVE OF A KIND");

    const text = this.add.text(400, 200, comboName, {
        fontSize: 48 * intensity,
        fontStyle: "bold",
        color: isRainbow ? "#ffffff" : "#ffdd44",
        stroke: isRainbow ? "#000000" : null,
        strokeThickness: isRainbow ? 8 : 0,
    }).setOrigin(0.5);

    text.setAngle(-5);

    // If it's FIVE OF A KIND: apply rainbow tween
    if (isRainbow) {
        // Cycle through hues 0–360 continuously
        this.tweens.addCounter({
            from: 0,
            to: 360,
            duration: 1500,
            repeat: -1,
            onUpdate: (tween) => {
                const hue = tween.getValue();
                text.setColor(Phaser.Display.Color.HSLToColor(hue / 360, 1, 0.6).rgba);
            }
        });

        // Pulse scale
        this.tweens.add({
            targets: text,
            scale: { from: 1.2, to: 1.0 },
            duration: 300,
            yoyo: true,
            repeat: -1,
        });
    }

    // Move + fade animation for all combos
    this.tweens.add({
        targets: text,
        y: 150,
        alpha: 0,
        angle: 5,
        duration: isRainbow ? 1100 : 800,
        ease: 'Cubic.easeOut',
        onComplete: () => text.destroy()
    });
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
        return { type: "FIVE OF A KIND?!!?!", key: "fiveKind", multiplier: 10, intensity: 1.8 };
    }

    // ----- FOUR OF A KIND -----
    if (occurrences.includes(4)) {
        return { type: "FOUR OF A KIND!!!!", key: "fourKind", multiplier: 5, intensity: 1.5 };
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

export function comboFlash(scene, color, duration = 500, alpha = 0.5) {
    const overlay = scene.add.rectangle(
        scene.scale.width / 2,
        scene.scale.height / 2,
        scene.scale.width,
        scene.scale.height,
        color,
        0
    ).setDepth(9999);

    scene.tweens.add({
        targets: overlay,
        alpha: alpha,
        duration: duration * 0.4,
        yoyo: true,
        hold: duration * 0.2,
        ease: "Quad.easeOut",
        onComplete: () => overlay.destroy()
    });
}

export function comboShake(scene, magnitude = 5, duration = 300) {
    scene.cameras.main.shake(duration, magnitude / 100); 
}

export function playComboFX(scene, comboName) {
    switch (comboName) {

        case "TRIPLE!":
            comboFlash(scene, 0xD4D45B, 600, 0.45);  // olive-yellow
            comboShake(scene, 5, 400);
            break;

        case "FOUR OF A KIND!!!!":
            comboFlash(scene, 0x550000, 1000, 0.55); // deep maroon
            comboShake(scene, 8, 600);
            break;

        case "FIVE OF A KIND?!!?!":
            comboFlash(scene, 0xffffff, 2000, 0.75); // rainbow handled inside ComboText glow
            comboShake(scene, 14, 1000); // DiceQuake™
            break;

        case "FULL HOUSE!!!":
            comboFlash(scene, 0xAA11BB, 800, 0.6); // magenta-purple
            comboShake(scene, 6, 500);
            break;

        case "STRAIGHT!":
            const color = 0x228833;
            comboFlash(scene, color, 600, 0.4); // Light green flash (darker for large)
            comboShake(scene, 4, 400);
            break;

        case "TWO PAIR!":
            comboShake(scene, 3, 300);
            break;

        default:
            break;
    }
}