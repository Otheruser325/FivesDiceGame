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

        case "TRIPLE!":  // Three of a kind
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
            // You used same text for small & large — but we detect color via intensity
            // Light green flash (darker for large)
            const color = 0x228833;
            comboFlash(scene, color, 600, 0.4);
            comboShake(scene, 4, 400);
            break;

        case "TWO PAIR!":
            comboShake(scene, 3, 300);
            break;

        default:
            // Pair or no combo → no FX
            break;
    }
}