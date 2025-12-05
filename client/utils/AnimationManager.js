export async function animateDiceRoll(finalFaces) {
    const duration = 700;                 // total animation time
    const jitter = 12;                    // pixel shake radius
    const interval = 40;                  // texture change frequency
    const dice = this.diceSprites;

    // Make sprites visible for animation
    dice.forEach(d => d.setVisible(true));

    let elapsed = 0;

    return new Promise(resolve => {
        const timer = this.time.addEvent({
            delay: interval,
            loop: true,
            callback: () => {
                elapsed += interval;

                // Update each die with a random face & jitter
                dice.forEach(die => {
                    const temp = Phaser.Math.Between(1, 6);
                    die.setTexture("dice" + temp);

                    const ox = Phaser.Math.Between(-jitter, jitter);
                    const oy = Phaser.Math.Between(-jitter, jitter);
                    die.x += ox;
                    die.y += oy;

                    // Snap back
                    this.tweens.add({
                        targets: die,
                        x: die.originalX,
                        y: die.originalY,
                        duration: 50,
                        ease: "Quad.easeOut",
                    });
                });

                // Stop animation
                if (elapsed >= duration) {
                    timer.remove();

                    // Final settle animation
                    dice.forEach((die, i) => {
                        die.setTexture("dice" + finalFaces[i]);

                        this.tweens.add({
                            targets: die,
                            angle: Phaser.Math.Between(-90, 90),
                            scale: 1.0,
                            duration: 300,
                            ease: "Back.easeOut",
                            onStart: () => {
                                die.angle = Phaser.Math.Between(-180, 180);
                                die.setScale(0.6);
                            },
                            onComplete: () => {
                                die.angle = 0;
                            }
                        });
                    });

                    resolve();
                }
            }
        });
    });
}