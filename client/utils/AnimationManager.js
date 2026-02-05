export async function animateDiceRoll(scene, finalFaces) {
    const duration = 700;
    const jitter = 12;
    const interval = 40;

    const dice = scene.diceSprites; // <── use passed scene
    const diceCount = scene.diceCount || 1;

    const getEntry = (entry) => {
        if (entry === null || entry === undefined) {
            return { skip: true };
        }
        if (typeof entry === 'object') {
            const value = Number(entry.value ?? entry.face ?? entry.finalFace);
            if (!Number.isFinite(value)) return { skip: true };
            const animate = !(entry.static || entry.animate === false);
            return { value, animate };
        }
        const value = Number(entry);
        if (!Number.isFinite(value)) return { skip: true };
        return { value, animate: true };
    };

    // Determine which dice should be visible based on finalFaces array
    // For prototype re-rolls, null entries should remain hidden
    dice.forEach((d, i) => {
        if (i >= diceCount) {
            d.setVisible(false);
            return;
        }
        const info = getEntry(finalFaces[i]);
        if (!info || info.skip) {
            d.setVisible(false);
            return;
        }
        d.setVisible(true);
        if (!info.animate) {
            d.setTexture("dice" + info.value);
        }
    });

    let elapsed = 0;

    return new Promise(resolve => {
        const timer = scene.time.addEvent({
            delay: interval,
            loop: true,
            callback: () => {
                elapsed += interval;

                // Only animate dice that have valid final faces (non-null)
                dice.forEach((die, i) => {
                    const info = getEntry(finalFaces[i]);
                    if (!info || info.skip || !info.animate) return;
                    
                    const temp = Phaser.Math.Between(1, 6);
                    die.setTexture("dice" + temp);

                    const ox = Phaser.Math.Between(-jitter, jitter);
                    const oy = Phaser.Math.Between(-jitter, jitter);
                    die.x += ox;
                    die.y += oy;

                    scene.tweens.add({
                        targets: die,
                        x: die.originalX,
                        y: die.originalY,
                        duration: 50,
                        ease: "Quad.easeOut",
                    });
                });

                if (elapsed >= duration) {
                    timer.remove();

                    // Only process dice that have valid final faces
                    dice.forEach((die, i) => {
                        const info = getEntry(finalFaces[i]);
                        if (!info || info.skip) return;
                        
                        die.setTexture("dice" + info.value);

                        if (info.animate) {
                            scene.tweens.add({
                                targets: die,
                                angle: Phaser.Math.Between(-90, 90),
                                scale: 0.5,
                                duration: 300,
                                ease: "Back.easeOut",
                                onStart: () => {
                                    die.angle = Phaser.Math.Between(-180, 180);
                                    die.setScale(0.6);
                                },
                                onComplete: () => {
                                    die.angle = 0;
                                    die.setScale(0.5);
                                }
                            });
                        }
                    });

                    resolve();
                }
            }
        });
    });
}
