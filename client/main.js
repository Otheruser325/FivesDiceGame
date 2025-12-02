import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import HelpScene from './scenes/HelpScene.js';
import PlayModeScene from './scenes/PlayModeScene.js';
import LocalConfigScene from './scenes/LocalConfigScene.js';
import LocalGameScene from './scenes/LocalGameScene.js';
import OnlineGameScene from './scenes/OnlineGameScene.js';

export let GlobalAudio = {
    settings: {
        audio: true,
        music: true
    },
    playButton(scene) {
        if (this.settings.audio) {
            scene.sound.play('button', { volume: 0.5 });
        }
    },
    playDice(scene) {
        if (this.settings.audio) {
            scene.sound.play('dice', { volume: 0.5 });
        }
    }
};

const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 900,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    scene: [
        PreloadScene,
        MenuScene,
        SettingsScene,
		HelpScene,
        PlayModeScene,
        LocalConfigScene,
        LocalGameScene,
        OnlineGameScene,
    ]
};

new Phaser.Game(config);