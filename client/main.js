import SplashScene from './scenes/SplashScene.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import PlayModeScene from './scenes/PlayModeScene.js';
import LocalConfigScene from './scenes/LocalConfigScene.js';
import LocalGameScene from './scenes/LocalGameScene.js';
import OnlineGameScene from './scenes/OnlineGameScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import HelpScene from './scenes/HelpScene.js';

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    scene: [
        SplashScene,
        BootScene,
        MenuScene,
        PlayModeScene,
		LocalConfigScene,
        LocalGameScene,
        OnlineGameScene,
        SettingsScene,
        HelpScene
    ]
};

new Phaser.Game(config);