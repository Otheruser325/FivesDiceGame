import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import HelpScene from './scenes/HelpScene.js';
import ChangelogScene from './scenes/ChangelogScene.js';
import AchievementsScene from './scenes/AchievementsScene.js';
import PlayModeScene from './scenes/PlayModeScene.js';
import LocalMenuScene from './scenes/LocalMenuScene.js';
import LocalLoadoutScene from './scenes/LocalLoadoutScene.js';
import LocalConfigScene from './scenes/LocalConfigScene.js';
import LocalGameScene from './scenes/LocalGameScene.js';
import LocalPostGameScene from './scenes/LocalPostGameScene.js';
import LocalChallengesScene from './scenes/LocalChallengesScene.js';
import LocalChallengeConfigScene from './scenes/LocalChallengeConfigScene.js';
import OnlineMenuScene from './scenes/OnlineMenuScene.js';
import OnlineAccountScene from './scenes/OnlineAccountScene.js';
import OnlineLoadoutScene from './scenes/OnlineLoadoutScene.js';
import OnlineConfigScene from './scenes/OnlineConfigScene.js';
import OnlineLobbyScene from './scenes/OnlineLobbyScene.js';
import OnlineGameScene from './scenes/OnlineGameScene.js';
import OnlinePostGameScene from './scenes/OnlinePostGameScene.js';

const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 960,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    dom: {
        createContainer: true
    },
    scene: [
        PreloadScene,
        MenuScene,
        SettingsScene,
		HelpScene,
        ChangelogScene,
		AchievementsScene,
        PlayModeScene,
        LocalMenuScene,
        LocalLoadoutScene,
        LocalConfigScene,
        LocalGameScene,
        LocalPostGameScene,
		LocalChallengesScene,
		LocalChallengeConfigScene,
        OnlineMenuScene,
        OnlineAccountScene,
        OnlineLoadoutScene,
        OnlineConfigScene,
        OnlineLobbyScene,
        OnlineGameScene,
        OnlinePostGameScene,
    ]
};

new Phaser.Game(config);
