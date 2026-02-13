export async function animateDiceRoll(scene, finalFaces) {
    const duration = 700;
    const jitter = 12;
    const interval = 40;

    const dice = scene.diceSprites; // <── use passed scene

    dice.forEach(d => d.setVisible(true));

    let elapsed = 0;

    return new Promise(resolve => {
        const timer = scene.time.addEvent({
            delay: interval,
            loop: true,
            callback: () => {
                elapsed += interval;

                dice.forEach(die => {
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

                    dice.forEach((die, i) => {
                        die.setTexture("dice" + finalFaces[i]);

                        scene.tweens.add({
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