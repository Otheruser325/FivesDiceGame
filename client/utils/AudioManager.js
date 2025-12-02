export function playButtonSFX(scene) {
    const settings = scene.registry.get('settings');
    if (settings?.sfx) {
        scene.sound.play('button', { volume: 0.5 });
    }
}

export function playDiceSFX(scene) {
    const settings = scene.registry.get('settings');
    if (settings?.sfx) {
        scene.sound.play('dice', { volume: 0.5 });
    }
}